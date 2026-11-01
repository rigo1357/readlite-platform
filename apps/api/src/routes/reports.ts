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
type Report = { id: string; targetType: 'story' | 'review' | 'comment'; targetId: string; status: string };
type User = { id: string; role: string };
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
const createSchema = z.object({ targetType: z.enum(['story', 'review', 'comment']),
  targetId: z.string().refine(validId), reason: z.string().trim().min(1).max(2000) }).strict();
const decisionSchema = z.object({ status: z.enum(['resolved', 'dismissed']),
  action: z.enum(['none', 'hide_story', 'delete_comment', 'delete_review']).default('none') }).strict()
  .refine(value => value.status === 'resolved' || value.action === 'none');
const reportFields = 'id::text AS id, target_type AS "targetType", target_id::text AS "targetId", status';
function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
async function requireUser(request: Request, response: Response, database: Queryable, admin = false): Promise<User | null> {
  const id = await readAccessUserId(request.cookies?.readlite_access);
  if (id) {
    const result = await database.query<User>('SELECT id::text AS id, role FROM users ' +
      'WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL', [id]);
    if (result.rows[0]) {
      if (admin && result.rows[0].role !== 'admin') { fail(response, 403, 'FORBIDDEN', 'Chỉ quản trị viên được xử lý báo cáo.'); return null; }
      return result.rows[0];
    }
  }
  fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
  return null;
}
async function targetStory(database: Queryable, targetType: Report['targetType'], targetId: string) {
  if (targetType === 'story') return targetId;
  const table = targetType === 'comment' ? 'comments' : 'reviews';
  const result = await database.query<{ storyId: string }>(`SELECT story_id::text AS "storyId" FROM ${table} WHERE id = $1`, [targetId]);
  return result.rows[0]?.storyId;
}

export function createReportsRouter(database: Database = pool): Router {
  const router = Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
    handler: (_request, response) => { fail(response, 429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Hãy thử lại sau.'); } });
  router.post('/reports', limiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return fail(response, 400, 'INVALID_REQUEST', 'Chọn nội dung và nhập lý do từ 1 đến 2000 ký tự.');
    try {
      const user = await requireUser(request, response, database);
      if (!user) return;
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const { targetType, targetId, reason } = parsed.data;
        const storyId = await targetStory(client, targetType, targetId);
        const story = storyId ? await client.query("SELECT id FROM stories WHERE id = $1 AND visibility = 'public' AND moderation_status = 'published' FOR UPDATE", [storyId]) : { rows: [] };
        let exists = story.rows.length > 0;
        if (exists && targetType !== 'story') {
          const table = targetType === 'comment' ? 'comments' : 'reviews';
          const result = await client.query(`SELECT id FROM ${table} WHERE id = $1 AND story_id = $2` +
            (targetType === 'comment' ? ' AND is_deleted = false' : '') + ' FOR UPDATE', [targetId, storyId]);
          exists = result.rows.length > 0;
        }
        if (!exists) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Nội dung không còn hiển thị để báo cáo.'); }
        // The partial unique index permits only one open report per person and target.
        const report = await client.query('INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, $2, $3, $4) ' +
          "ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO UPDATE SET reason = reports.reason " +
          `RETURNING ${reportFields}`, [user.id, targetType, targetId, reason]);
        await client.query('COMMIT');
        return response.status(201).json({ report: report.rows[0] });
      } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
      finally { client.release(); }
    } catch (error) { return next(error); }
  });

  router.get('/admin/reports', async (request, response, next) => {
    try {
      const user = await requireUser(request, response, database, true);
      if (!user) return;
      const status = request.query.status ?? 'open', rawPage = request.query.page ?? '1';
      if (!['open', 'resolved', 'dismissed'].includes(String(status)) || typeof status !== 'string' ||
        typeof rawPage !== 'string' || !/^[1-9]\d{0,6}$/.test(rawPage)) return fail(response, 400, 'INVALID_REQUEST', 'Bộ lọc báo cáo không hợp lệ.');
      const page = Number(rawPage), limit = 10;
      const count = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM reports WHERE status = $1', [status]);
      const result = await database.query('SELECT r.id::text AS id, u.display_name AS "reporterName", r.target_type AS "targetType", ' +
        'r.target_id::text AS "targetId", r.reason, r.status, r.created_at AS "createdAt", s.title AS "targetTitle", ' +
        "CASE WHEN r.target_type = 'story' THEN left(s.summary, 2000) WHEN r.target_type = 'review' THEN rv.content " +
        'WHEN c.is_deleted = false THEN c.content ELSE NULL END AS "targetContent", ' +
        "CASE WHEN r.target_type = 'story' THEN s.id IS NOT NULL WHEN r.target_type = 'review' THEN rv.id IS NOT NULL " +
        'ELSE c.id IS NOT NULL AND c.is_deleted = false END AS "targetAvailable" ' +
        'FROM reports r JOIN users u ON u.id = r.reporter_id ' +
        "LEFT JOIN reviews rv ON r.target_type = 'review' AND rv.id = r.target_id " +
        "LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id " +
        "LEFT JOIN stories s ON s.id = CASE WHEN r.target_type = 'story' THEN r.target_id ELSE COALESCE(rv.story_id, c.story_id) END " +
        'WHERE r.status = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2 OFFSET $3', [status, limit, (page - 1) * limit]);
      return response.json({ reports: result.rows, pagination: { page, limit, total: count.rows[0]?.total ?? 0 } });
    } catch (error) { return next(error); }
  });

  router.patch('/admin/reports/:reportId', limiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const reportId = request.params.reportId, parsed = decisionSchema.safeParse(request.body);
    if (!validId(reportId) || !parsed.success) return fail(response, 400, 'INVALID_REQUEST', 'Quyết định xử lý không hợp lệ.');
    try {
      const user = await requireUser(request, response, database, true);
      if (!user) return;
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        // Derive the story without locking the report, so all writes take story locks first.
        const initial = await client.query<Report>(`SELECT ${reportFields} FROM reports WHERE id = $1`, [reportId]);
        if (!initial.rows[0]) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy báo cáo.'); }
        const storyId = await targetStory(client, initial.rows[0].targetType, initial.rows[0].targetId);
        const story = storyId ? await client.query<{ id: string; moderationStatus: string }>('SELECT id::text AS id, moderation_status AS "moderationStatus" FROM stories WHERE id = $1 FOR UPDATE', [storyId]) : { rows: [] };
        const locked = await client.query<Report>(`SELECT ${reportFields} FROM reports WHERE id = $1 FOR UPDATE`, [reportId]);
        const report = locked.rows[0];
        if (!report) { await client.query('ROLLBACK'); return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy báo cáo.'); }
        if (report.status !== 'open') { await client.query('ROLLBACK'); return fail(response, 409, 'REPORT_CLOSED', 'Báo cáo đã được xử lý.'); }
        const { action, status } = parsed.data;
        const requiredType = action === 'hide_story' ? 'story' : action === 'delete_comment' ? 'comment' : action === 'delete_review' ? 'review' : null;
        if (requiredType && requiredType !== report.targetType) { await client.query('ROLLBACK'); return fail(response, 400, 'INVALID_ACTION', 'Thao tác không phù hợp loại nội dung.'); }
        if (action !== 'none' && !story.rows[0]) { await client.query('ROLLBACK'); return fail(response, 409, 'TARGET_UNAVAILABLE', 'Nội dung đã bị xóa; bạn có thể đóng báo cáo mà không thao tác nội dung.'); }
        if (action === 'hide_story') {
          if (['ai_review_pending', 'admin_review_pending'].includes(story.rows[0]!.moderationStatus)) { await client.query('ROLLBACK'); return fail(response, 409, 'STORY_BUSY', 'Truyện đang được duyệt.'); }
          await client.query("UPDATE stories SET visibility = 'private', moderation_status = 'draft', ai_review_status = 'not_started' WHERE id = $1", [storyId]);
          await client.query("INSERT INTO story_review_events (story_id, actor_id, action, details) VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
            [storyId, user.id, JSON.stringify({ action: 'hidden_from_report', reportId })]);
        } else if (action === 'delete_comment') {
          const result = await client.query("UPDATE comments SET is_deleted = true, content = '[Đã xóa]' WHERE id = $1 AND story_id = $2 RETURNING id", [report.targetId, storyId]);
          if (!result.rows.length) { await client.query('ROLLBACK'); return fail(response, 409, 'TARGET_UNAVAILABLE', 'Bình luận đã bị xóa.'); }
        } else if (action === 'delete_review') {
          // The existing review trigger refreshes the story's rating aggregates.
          const result = await client.query('DELETE FROM reviews WHERE id = $1 AND story_id = $2 RETURNING id', [report.targetId, storyId]);
          if (!result.rows.length) { await client.query('ROLLBACK'); return fail(response, 409, 'TARGET_UNAVAILABLE', 'Đánh giá đã bị xóa.'); }
        }
        const updated = await client.query(`UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now() WHERE id = $1 RETURNING ${reportFields}`, [reportId, status, user.id]);
        await client.query('COMMIT');
        return response.json({ report: updated.rows[0], action });
      } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
      finally { client.release(); }
    } catch (error) { return next(error); }
  });
  return router;
}
export const reportsRouter = createReportsRouter();
