import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';
import type { UpdateDatabase, UpdateQueryable } from '../services/content-update-import.js';

const statuses = z.enum(['ongoing', 'completed', 'paused']);
const input = z.object({ status: statuses, expectedVersion: z.number().int().min(0).max(2147483647), note: z.string().trim().max(2000).default('') }).strict()
  .refine(v => v.status !== 'paused' || v.note.length > 0);
const id = z.string().regex(/^[1-9]\d{0,18}$/u).refine(v => BigInt(v) <= 9223372036854775807n);
const fields = 'id::text AS "storyId",lifecycle_status AS status,lifecycle_version AS version,lifecycle_note AS note,lifecycle_changed_at AS "changedAt"';
type Actor = { id: string; role: string; name: string };
function fail(res: Response, status: number, code: string, message: string) { return res.status(status).json({ error: { code, message } }); }
async function contributor(req: Request, res: Response, db: UpdateQueryable): Promise<Actor | null> {
  const userId = await readAccessUserId(req.cookies?.readlite_access);
  if (!userId) { fail(res, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập.'); return null; }
  const result = await db.query<Actor>('SELECT id::text,role,display_name AS name FROM users WHERE id=$1 AND is_active=true AND email_verified_at IS NOT NULL', [userId]);
  const user = result.rows[0];
  if (!user || !['admin', 'author'].includes(user.role)) { fail(res, 403, 'FORBIDDEN', 'Chỉ tác giả và quản trị viên được quản lý trạng thái truyện.'); return null; }
  return user;
}

export function createStoryLifecycleRouter(db: UpdateDatabase = pool): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => fail(res, 429, 'RATE_LIMITED', 'Quá nhiều lần cập nhật trạng thái. Vui lòng thử lại sau.') });
  router.use('/author/stories/:storyId/lifecycle', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/author/stories/:storyId/lifecycle', async (req, res, next) => {
    try {
      const user = await contributor(req, res, db); if (!user) return;
      if (!id.safeParse(req.params.storyId).success) return fail(res, 400, 'INVALID_REQUEST', 'Mã truyện không hợp lệ.');
      const rawPage = req.query.page ?? '1';
      if (typeof rawPage !== 'string' || !/^[1-9]\d{0,5}$/u.test(rawPage)) return fail(res, 400, 'INVALID_REQUEST', 'Trang không hợp lệ.');
      const page = Number(rawPage);
      const story = await db.query('SELECT ' + fields + ' FROM stories WHERE id=$1 AND (owner_id=$2 OR submitted_by=$2 OR $3::boolean)', [req.params.storyId, user.id, user.role === 'admin']);
      if (!story.rows[0]) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      const count = await db.query<{ total: number }>('SELECT count(*)::int AS total FROM story_lifecycle_events WHERE story_id=$1', [req.params.storyId]);
      const events = await db.query('SELECT id::text,actor_id::text AS "actorId",actor_name AS "actorName",previous_status AS "previousStatus",new_status AS "newStatus",note,created_at AS "createdAt" FROM story_lifecycle_events WHERE story_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $2', [req.params.storyId, (page - 1) * 20]);
      return res.json({ lifecycle: story.rows[0], events: events.rows, pagination: { page, limit: 20, total: count.rows[0]!.total } });
    } catch (error) { return next(error); }
  });
  router.patch('/author/stories/:storyId/lifecycle', limiter, async (req, res, next) => {
    let client: Awaited<ReturnType<UpdateDatabase['connect']>> | undefined;
    try {
      const user = await contributor(req, res, db); if (!user) return;
      if (!csrfTokensMatch(req.cookies?.readlite_csrf, req.get('x-csrf-token'))) return fail(res, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      const parsed = input.safeParse(req.body);
      if (!id.safeParse(req.params.storyId).success || !parsed.success) return fail(res, 400, 'INVALID_REQUEST', 'Trạng thái chưa hợp lệ. Nhập lý do khi tạm ngưng; ghi chú tối đa 2000 ký tự.');
      client = await db.connect(); await client.query('BEGIN');
      const found = await client.query<{ status: string; version: number; moderationStatus: string }>(
        'SELECT lifecycle_status AS status,lifecycle_version AS version,moderation_status AS "moderationStatus" FROM stories WHERE id=$1 AND (owner_id=$2 OR submitted_by=$2 OR $3::boolean) FOR UPDATE', [req.params.storyId, user.id, user.role === 'admin']);
      const story = found.rows[0];
      if (!story) { await client.query('ROLLBACK'); return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy truyện.'); }
      if (story.status === parsed.data.status) {
        const current = await client.query('SELECT ' + fields + ' FROM stories WHERE id=$1', [req.params.storyId]);
        await client.query('COMMIT'); return res.json({ changed: false, lifecycle: current.rows[0] });
      }
      if (story.version !== parsed.data.expectedVersion) { await client.query('ROLLBACK'); return fail(res, 409, 'LIFECYCLE_CHANGED', 'Trạng thái đã thay đổi. Hãy tải lại trước khi lưu.'); }
      if (['ai_review_pending', 'admin_review_pending'].includes(story.moderationStatus)) { await client.query('ROLLBACK'); return fail(res, 409, 'STORY_BUSY', 'Truyện đang chờ duyệt. Hãy hoàn tất kiểm duyệt trước khi đổi trạng thái.'); }
      if (parsed.data.status === 'completed' && !(await client.query('SELECT id FROM chapters WHERE story_id=$1 LIMIT 1', [req.params.storyId])).rows.length) {
        await client.query('ROLLBACK'); return fail(res, 409, 'NO_CHAPTERS', 'Cần có ít nhất một chương trước khi đánh dấu hoàn thành.');
      }
      await client.query('INSERT INTO story_lifecycle_events(story_id,actor_id,actor_name,previous_status,new_status,note) VALUES($1,$2,$3,$4,$5,$6)', [req.params.storyId, user.id, user.name, story.status, parsed.data.status, parsed.data.note]);
      // Completion notifications are inserted by the DB trigger in this same transaction.
      const updated = await client.query('UPDATE stories SET lifecycle_status=$2,lifecycle_version=lifecycle_version+1,lifecycle_note=$3,lifecycle_changed_at=now() WHERE id=$1 RETURNING ' + fields, [req.params.storyId, parsed.data.status, parsed.data.note]);
      await client.query('COMMIT'); return res.json({ changed: true, lifecycle: updated.rows[0] });
    } catch (error) { await client?.query('ROLLBACK').catch(() => undefined); return next(error); }
    finally { client?.release(); }
  });
  return router;
}
export const storyLifecycleRouter = createStoryLifecycleRouter();
