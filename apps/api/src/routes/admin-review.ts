import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

interface QueryResult<Row> { rows: Row[] }
interface Queryable {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}
interface Database extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}
type Admin = { id: string; role: string };

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'changes_requested']),
  reason: z.string().trim().max(2000).optional(),
}).strict().refine((value) =>
  value.decision === 'approve' || Boolean(value.reason),
);
const storyIdPattern = /^[1-9]\d{0,18}$/;

function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}

async function requireAdmin(
  request: Request,
  response: Response,
  database: Queryable,
): Promise<Admin | null> {
  const userId = await readAccessUserId(request.cookies?.readlite_access);
  if (!userId) {
    fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }
  const result = await database.query<Admin>(
    'SELECT id::text AS id, role FROM users ' +
      'WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL',
    [userId],
  );
  const admin = result.rows[0];
  if (!admin) {
    fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }
  if (admin.role !== 'admin') {
    fail(response, 403, 'FORBIDDEN', 'Chỉ quản trị viên mới được duyệt truyện.');
    return null;
  }
  return admin;
}

function mapBlocks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Array<Record<string, unknown>> => {
    if (!entry || typeof entry !== 'object') return [];
    const block = entry as Record<string, unknown>;
    if (block.type === 'text') return [block];
    if (
      block.type === 'image' &&
      typeof block.mediaId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(block.mediaId)
    ) {
      return [{ ...block, url: '/api/v1/media/' + block.mediaId }];
    }
    return [];
  });
}

function hasCsrf(request: Request): boolean {
  return csrfTokensMatch(
    request.cookies?.readlite_csrf,
    request.get('x-csrf-token'),
  );
}

export function createAdminReviewRouter(database: Database = pool): Router {
  const router = Router();

  router.get('/admin/story-submissions', async (request, response, next) => {
    const admin = await requireAdmin(request, response, database);
    if (!admin) return;
    const status = request.query.status ?? 'admin_review_pending';
    if (status !== 'admin_review_pending') {
      return fail(response, 400, 'INVALID_REQUEST', 'Trạng thái hàng đợi không hợp lệ.');
    }
    try {
      const result = await database.query(
        "SELECT s.id::text AS id, s.title, s.author, s.summary, s.language, " +
          's.publication_date AS "publicationDate", ' +
          's.ai_review_status AS "aiReviewStatus", ' +
          's.ai_review_warnings AS "aiReviewWarnings", ' +
          's.total_chapters AS "totalChapters", ' +
          'u.display_name AS "submittedByName", s.submitted_by::text AS "submittedBy", ' +
          's.created_at AS "createdAt" ' +
          'FROM stories s LEFT JOIN users u ON u.id = s.submitted_by ' +
          "WHERE s.moderation_status = 'admin_review_pending' " +
          "AND s.ai_review_status IN ('passed', 'warnings', 'skipped') " +
          'ORDER BY s.created_at ASC, s.id ASC',
      );
      return response.status(200).json({ submissions: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/admin/story-submissions/:storyId', async (request, response, next) => {
    const admin = await requireAdmin(request, response, database);
    if (!admin) return;
    const storyId = request.params.storyId;
    if (typeof storyId !== 'string' || !storyIdPattern.test(storyId)) {
      return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện cần duyệt.');
    }

    try {
      const storyResult = await database.query(
        "SELECT s.id::text AS id, s.title, s.author, s.summary, s.language, " +
          's.cover_url AS "coverUrl", s.cover_media_id::text AS "coverMediaId", ' +
          's.publication_date AS "publicationDate", ' +
          's.moderation_status AS "moderationStatus", ' +
          's.ai_review_status AS "aiReviewStatus", ' +
          's.ai_review_warnings AS "aiReviewWarnings", ' +
          's.submitted_by::text AS "submittedBy", u.display_name AS "submittedByName" ' +
          'FROM stories s LEFT JOIN users u ON u.id = s.submitted_by ' +
          "WHERE s.id = $1 AND s.moderation_status = 'admin_review_pending' " +
          "AND s.ai_review_status IN ('passed', 'warnings', 'skipped')",
        [storyId],
      );
      const story = storyResult.rows[0];
      if (!story) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện cần duyệt.');

      const result = await database.query(
        'SELECT c.id::text AS id, c.title, c.chapter_order AS "chapterOrder", ' +
          'c.content, c.content_blocks AS "contentBlocks", ' +
          'v.id::text AS "volumeId", v.title AS "volumeTitle", ' +
          'v.volume_order AS "volumeOrder" ' +
          'FROM chapters c LEFT JOIN volumes v ON v.id = c.volume_id AND v.story_id = c.story_id ' +
          'WHERE c.story_id = $1 ORDER BY COALESCE(v.volume_order, 0), c.chapter_order',
        [storyId],
      );
      const chapters = result.rows.map((valueRow) => {
        const row = valueRow as Record<string, unknown>;
        const { contentBlocks, ...chapter } = row;
        return { ...chapter, blocks: mapBlocks(contentBlocks) };
      });
      return response.status(200).json({ story, chapters });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/admin/story-submissions/:storyId/decision', async (request, response, next) => {
    const admin = await requireAdmin(request, response, database);
    if (!admin) return;
    if (!hasCsrf(request)) {
      return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    }
    const storyId = request.params.storyId;
    const parsed = decisionSchema.safeParse(request.body);
    if (typeof storyId !== 'string' || !storyIdPattern.test(storyId) || !parsed.success) {
      return fail(response, 400, 'INVALID_REQUEST', 'Quyết định duyệt chưa hợp lệ.');
    }

    const client = await database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const locked = await client.query<{
        id: string;
        submittedBy: string | null;
        moderationStatus: string;
        aiReviewStatus: string;
      }>(
        'SELECT id::text AS id, submitted_by::text AS "submittedBy", ' +
          'moderation_status AS "moderationStatus", ai_review_status AS "aiReviewStatus" ' +
          'FROM stories WHERE id = $1 FOR UPDATE',
        [storyId],
      );
      const story = locked.rows[0];
      if (
        !story ||
        story.moderationStatus !== 'admin_review_pending' ||
        (story.aiReviewStatus !== 'passed' && story.aiReviewStatus !== 'warnings' && story.aiReviewStatus !== 'skipped')
      ) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return fail(response, 409, 'STORY_NOT_REVIEWABLE', 'Truyện chưa sẵn sàng để quản trị viên duyệt.');
      }


      const nextStatus = parsed.data.decision === 'approve'
        ? 'published'
        : parsed.data.decision === 'reject'
          ? 'rejected'
          : 'changes_requested';
      const visibility = parsed.data.decision === 'approve' ? 'public' : 'private';
      await client.query(
        'UPDATE stories SET moderation_status = $2, visibility = $3, ' +
          'reviewed_by = $4, reviewed_at = now(), review_reason = $5 ' +
          'WHERE id = $1',
        [storyId, nextStatus, visibility, admin.id, parsed.data.reason ?? null],
      );
      const action = parsed.data.decision === 'approve'
        ? 'approved'
        : parsed.data.decision;
      await client.query(
        'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
          'VALUES ($1, $2, $3, $4::jsonb)',
        [storyId, admin.id, action, JSON.stringify({ reason: parsed.data.reason ?? null })],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return response.status(200).json({
        storyId,
        moderationStatus: nextStatus,
        visibility,
      });
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally {
      client.release();
    }
  });

  // The inventory uses the same stories as the Android catalog; hiding keeps reader progress.
  router.post('/admin/stories/:storyId/hide', async (request, response, next) => {
    const admin = await requireAdmin(request, response, database);
    if (!admin) return;
    if (!hasCsrf(request)) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const storyId = request.params.storyId;
    if (typeof storyId !== 'string' || !storyIdPattern.test(storyId)) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        "UPDATE stories SET visibility = 'private', moderation_status = 'draft', ai_review_status = 'not_started' " +
        "WHERE id = $1 AND moderation_status NOT IN ('ai_review_pending', 'admin_review_pending') RETURNING id",
        [storyId],
      );
      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return fail(response, 409, 'STORY_BUSY', 'Không tìm thấy truyện hoặc truyện đang được duyệt.');
      }
      await client.query("INSERT INTO story_review_events (story_id, actor_id, action, details) VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
        [storyId, admin.id, JSON.stringify({ action: 'hidden_from_catalog' })]);
      await client.query('COMMIT');
      return response.json({ storyId, moderationStatus: 'draft', visibility: 'private' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally { client.release(); }
  });

  router.delete('/admin/stories/:storyId', async (request, response, next) => {
    const admin = await requireAdmin(request, response, database);
    if (!admin) return;
    if (!hasCsrf(request)) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const storyId = request.params.storyId;
    if (typeof storyId !== 'string' || !storyIdPattern.test(storyId)) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ moderationStatus: string }>(
        'SELECT moderation_status AS "moderationStatus" FROM stories WHERE id = $1 FOR UPDATE', [storyId]);
      if (!locked.rows[0]) {
        await client.query('ROLLBACK');
        return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      }
      if (locked.rows[0].moderationStatus === 'ai_review_pending') {
        await client.query('ROLLBACK');
        return fail(response, 409, 'STORY_BUSY', 'Hãy đợi lượt rà soát đang chạy kết thúc trước khi xóa.');
      }
      // Clear the circular cover reference before the story's children cascade.
      await client.query('UPDATE stories SET cover_media_id = NULL WHERE id = $1', [storyId]);
      await client.query('DELETE FROM stories WHERE id = $1', [storyId]);
      await client.query('COMMIT');
      return response.json({ storyId, deleted: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally { client.release(); }
  });

  return router;
}

export const adminReviewRouter = createAdminReviewRouter();
