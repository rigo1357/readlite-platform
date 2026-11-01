import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}
interface Database extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}
type Comment = { id: string; storyId: string; chapterId: string | null; parentId: string | null;
  content: string; isDeleted: boolean; userId: string; createdAt: unknown; updatedAt: unknown };
type User = { id: string; displayName: string };
const publicStory = "visibility = 'public' AND moderation_status = 'published'";
const content = z.string().trim().min(1).max(5000);
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
const idSchema = z.string().refine(validId);
const createSchema = z.object({ content, chapterId: idSchema.optional(), parentId: idSchema.optional() }).strict();
const editSchema = z.object({ content }).strict();
const returning = 'id::text AS id, story_id::text AS "storyId", chapter_id::text AS "chapterId", ' +
  'parent_id::text AS "parentId", content, is_deleted AS "isDeleted", created_at AS "createdAt", updated_at AS "updatedAt"';
function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
async function requireUser(request: Request, response: Response, database: Queryable): Promise<User | null> {
  const id = await readAccessUserId(request.cookies?.readlite_access);
  if (id) {
    const result = await database.query<User>('SELECT id::text AS id, display_name AS "displayName" FROM users ' +
      'WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL', [id]);
    if (result.rows[0]) return result.rows[0];
  }
  fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để bình luận.');
  return null;
}

export function createCommentsRouter(database: Database = pool): Router {
  const router = Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
    handler: (_request, response) => { fail(response, 429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Hãy thử lại sau.'); } });
  router.get('/stories/:storyId/comments', async (request, response, next) => {
    const storyId = request.params.storyId;
    const { chapterId, parentId } = request.query;
    const rawPage = request.query.page ?? '1';
    if (!validId(storyId)) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    if (chapterId !== undefined && !validId(chapterId) || parentId !== undefined && !validId(parentId) ||
      typeof rawPage !== 'string' || !/^[1-9]\d{0,6}$/.test(rawPage)) {
      return fail(response, 400, 'INVALID_REQUEST', 'Bộ lọc bình luận không hợp lệ.');
    }
    const page = Number(rawPage), limit = 10;
    try {
      const story = await database.query(`SELECT id FROM stories WHERE id = $1 AND ${publicStory}`, [storyId]);
      if (!story.rows.length) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      if (chapterId) {
        const chapter = await database.query('SELECT id FROM chapters WHERE id = $1 AND story_id = $2', [chapterId, storyId]);
        if (!chapter.rows.length) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy chương.');
      }
      if (parentId) {
        const parent = await database.query('SELECT id FROM comments WHERE id = $1 AND story_id = $2 ' +
          'AND chapter_id IS NOT DISTINCT FROM $3::bigint AND parent_id IS NULL', [parentId, storyId, chapterId ?? null]);
        if (!parent.rows.length) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy bình luận gốc.');
      }
      const userId = await readAccessUserId(request.cookies?.readlite_access);
      const filter = "FROM comments c JOIN stories s ON s.id = c.story_id WHERE c.story_id = $1 " +
        'AND c.chapter_id IS NOT DISTINCT FROM $2::bigint AND c.parent_id IS NOT DISTINCT FROM $3::bigint ' +
        "AND s.visibility = 'public' AND s.moderation_status = 'published'";
      const values = [storyId, chapterId ?? null, parentId ?? null];
      const count = await database.query<{ total: number }>('SELECT count(*)::int AS total ' + filter, values);
      const result = await database.query(
        'SELECT c.id::text AS id, c.story_id::text AS "storyId", c.chapter_id::text AS "chapterId", ' +
        'c.parent_id::text AS "parentId", CASE WHEN c.is_deleted THEN \'\' ELSE c.content END AS content, ' +
        'c.is_deleted AS "isDeleted", u.display_name AS "displayName", COALESCE(c.user_id = $4::uuid, false) AS "isMine", ' +
        'c.created_at AS "createdAt", c.updated_at AS "updatedAt", ' +
        '(SELECT count(*)::int FROM comments replies WHERE replies.parent_id = c.id AND replies.is_deleted = false) AS "replyCount" ' +
        filter.replace('WHERE c.story_id', 'JOIN users u ON u.id = c.user_id WHERE c.story_id') +
        ' ORDER BY c.created_at DESC, c.id DESC LIMIT $5 OFFSET $6', [...values, userId, limit, (page - 1) * limit]);
      return response.json({ comments: result.rows, pagination: { page, limit, total: count.rows[0]?.total ?? 0 } });
    } catch (error) { return next(error); }
  });

  router.post('/stories/:storyId/comments', limiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const storyId = request.params.storyId;
    const parsed = createSchema.safeParse(request.body);
    if (!validId(storyId) || !parsed.success) return fail(response, 400, 'INVALID_REQUEST', 'Bình luận cần từ 1 đến 5000 ký tự.');
    try {
      const user = await requireUser(request, response, database);
      if (!user) return;
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const story = await client.query(`SELECT id FROM stories WHERE id = $1 AND ${publicStory} FOR UPDATE`, [storyId]);
        if (!story.rows.length) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.'); }
        const { chapterId, parentId } = parsed.data;
        if (chapterId) {
          const chapter = await client.query('SELECT id FROM chapters WHERE id = $1 AND story_id = $2 FOR KEY SHARE', [chapterId, storyId]);
          if (!chapter.rows.length) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy chương.'); }
        }
        if (parentId) {
          const parent = await client.query('SELECT id FROM comments WHERE id = $1 AND story_id = $2 ' +
            'AND chapter_id IS NOT DISTINCT FROM $3::bigint AND parent_id IS NULL AND is_deleted = false FOR UPDATE',
          [parentId, storyId, chapterId ?? null]);
          if (!parent.rows.length) { await client.query('ROLLBACK'); return fail(response, 400, 'INVALID_PARENT', 'Chỉ được trả lời bình luận gốc còn hiển thị trong cùng truyện và chương.'); }
        }
        const result = await client.query('INSERT INTO comments (story_id, chapter_id, user_id, parent_id, content) ' +
          `VALUES ($1, $2, $3, $4, $5) RETURNING ${returning}`,
        [storyId, chapterId ?? null, user.id, parentId ?? null, parsed.data.content]);
        await client.query('COMMIT');
        return response.status(201).json({ comment: { ...result.rows[0], displayName: user.displayName, isMine: true, replyCount: 0 } });
      } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
      finally { client.release(); }
    } catch (error) { return next(error); }
  });

  for (const method of ['put', 'delete'] as const) {
    router[method]('/comments/:commentId', limiter, async (request, response, next) => {
      if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      const commentId = request.params.commentId;
      const parsed = editSchema.safeParse(request.body);
      if (!validId(commentId) || method === 'put' && !parsed.success) return fail(response, 400, 'INVALID_REQUEST', 'Bình luận cần từ 1 đến 5000 ký tự.');
      try {
        const user = await requireUser(request, response, database);
        if (!user) return;
        const client = await database.connect();
        try {
          await client.query('BEGIN');
          // Lock the story first, as publication and moderation also lock it before a comment.
          const target = await client.query<{ storyId: string }>('SELECT story_id::text AS "storyId" FROM comments WHERE id = $1 AND user_id = $2', [commentId, user.id]);
          const storyId = target.rows[0]?.storyId;
          const story = storyId ? await client.query(`SELECT id FROM stories WHERE id = $1 AND ${publicStory} FOR UPDATE`, [storyId]) : { rows: [] };
          if (!story.rows.length) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy bình luận của bạn.'); }
          const locked = await client.query<Comment>(`SELECT ${returning}, user_id::text AS "userId" FROM comments WHERE id = $1 AND user_id = $2 FOR UPDATE`, [commentId, user.id]);
          if (!locked.rows[0] || method === 'put' && locked.rows[0].isDeleted) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy bình luận của bạn.'); }
          let comment = null;
          if (method === 'put' && parsed.success) {
            const result = await client.query(`UPDATE comments SET content = $3 WHERE id = $1 AND user_id = $2 RETURNING ${returning}`, [commentId, user.id, parsed.data.content]);
            const replies = await client.query<{ total: number }>('SELECT count(*)::int AS total FROM comments WHERE parent_id = $1 AND is_deleted = false', [commentId]);
            comment = { ...result.rows[0], displayName: user.displayName, isMine: true, replyCount: replies.rows[0]?.total ?? 0 };
          } else {
            // Keep a nonempty placeholder to satisfy the existing database length constraint.
            await client.query("UPDATE comments SET is_deleted = true, content = '[Đã xóa]' WHERE id = $1 AND user_id = $2", [commentId, user.id]);
          }
          await client.query('COMMIT');
          return response.json(method === 'put' ? { comment } : { commentId, deleted: true });
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
        finally { client.release(); }
      } catch (error) { return next(error); }
    });
  }
  return router;
}
export const commentsRouter = createCommentsRouter();
