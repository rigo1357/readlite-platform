import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}
interface Database extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}
function id(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
function pageNumber(value: unknown): number | null {
  return value === undefined
    ? 1
    : typeof value === 'string' && /^[1-9]\d{0,6}$/.test(value)
      ? Number(value)
      : null;
}
function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
async function requireUser(request: Request, response: Response, database: Queryable) {
  const userId = await readAccessUserId(request.cookies?.readlite_access);
  if (userId) {
    const result = await database.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL',
      [userId],
    );
    if (result.rows.length) return userId;
  }
  fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để theo dõi truyện và xem thông báo.');
  return null;
}
const published = "s.visibility = 'public' AND s.moderation_status = 'published'";
const notificationFilter = `FROM reader_notifications n JOIN stories s ON s.id = n.story_id WHERE n.user_id = $1 AND ${published}`;

export function createReaderUpdatesRouter(database: Database = pool): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      fail(response, 429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Hãy thử lại sau.');
    },
  });

  router.get('/stories/:storyId/follow', async (request, response, next) => {
    if (!id(request.params.storyId))
      return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      const result = await database.query<{ following: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM story_follows f WHERE f.story_id = s.id AND f.user_id = $2) AS following ' +
          `FROM stories s WHERE s.id = $1 AND ${published}`,
        [request.params.storyId, userId],
      );
      if (!result.rows[0]) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      return response.json(result.rows[0]);
    } catch (error) {
      return next(error);
    }
  });

  for (const method of ['put', 'delete'] as const) {
    router[method]('/stories/:storyId/follow', limiter, async (request, response, next) => {
      if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token')))
        return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      if (!id(request.params.storyId))
        return fail(response, 400, 'INVALID_REQUEST', 'Truyện không hợp lệ.');
      try {
        const userId = await requireUser(request, response, database);
        if (!userId) return;
        const client = await database.connect();
        try {
          await client.query('BEGIN');
          // Match publishing/chapter writes: serialize a follow against announcements.
          const story = await client.query<{ available: boolean }>(
            `SELECT s.id, (${published}) AS available FROM stories s WHERE s.id = $1 FOR UPDATE`,
            [request.params.storyId],
          );
          if ((!story.rows[0] || !story.rows[0].available) && method === 'put') {
            await client.query('ROLLBACK');
            return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện đã xuất bản.');
          }
          if (method === 'put')
            await client.query(
              'INSERT INTO story_follows (user_id, story_id) VALUES ($1, $2) ON CONFLICT (user_id, story_id) DO NOTHING',
              [userId, request.params.storyId],
            );
          else
            await client.query('DELETE FROM story_follows WHERE user_id = $1 AND story_id = $2', [
              userId,
              request.params.storyId,
            ]);
          await client.query('COMMIT');
          return response.json({ following: method === 'put' });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        return next(error);
      }
    });
  }

  router.get('/me/following', async (request, response, next) => {
    const page = pageNumber(request.query.page),
      limit = 20;
    if (page === null) return fail(response, 400, 'INVALID_REQUEST', 'Trang không hợp lệ.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      // Keep hidden titles in the owner's list so they can still unfollow, without exposing metadata.
      const count = await database.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM story_follows WHERE user_id = $1',
        [userId],
      );
      const result = await database.query(
        `SELECT s.id::text AS id, CASE WHEN ${published} THEN s.title ELSE 'Truyện hiện không công khai' END AS title, ` +
          `CASE WHEN ${published} THEN s.author ELSE '' END AS author, (${published}) AS available, ` +
          `CASE WHEN ${published} THEN s.total_chapters ELSE 0 END AS "totalChapters", f.created_at AS "followedAt" ` +
          'FROM story_follows f JOIN stories s ON s.id = f.story_id WHERE f.user_id = $1 ORDER BY f.created_at DESC, f.story_id DESC LIMIT $2 OFFSET $3',
        [userId, limit, (page - 1) * limit],
      );
      return response.json({
        stories: result.rows,
        pagination: { page, limit, total: count.rows[0]?.total ?? 0 },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me/notifications/unread-count', async (request, response, next) => {
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      const result = await database.query<{ unreadCount: number }>(
        `SELECT count(*)::int AS "unreadCount" ${notificationFilter} AND n.read_at IS NULL`,
        [userId],
      );
      return response.json({ unreadCount: result.rows[0]?.unreadCount ?? 0 });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me/notifications', async (request, response, next) => {
    const page = pageNumber(request.query.page),
      limit = 20;
    const unread = request.query.unread ?? 'false';
    if (page === null || (unread !== 'true' && unread !== 'false'))
      return fail(response, 400, 'INVALID_REQUEST', 'Bộ lọc không hợp lệ.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      const summary = await database.query<{ total: number; unreadCount: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE n.read_at IS NULL)::int AS "unreadCount" ${notificationFilter}`,
        [userId],
      );
      const result = await database.query(
        'SELECT n.id::text AS id, n.story_id::text AS "storyId", s.title AS "storyTitle", ' +
          'n.chapter_id::text AS "chapterId", n.chapter_title AS "chapterTitle", n.notification_kind AS kind, n.created_at AS "createdAt", n.read_at AS "readAt", ' +
          '(c.id IS NOT NULL) AS "chapterAvailable" ' +
          notificationFilter.replace(
            'WHERE n.user_id',
            'LEFT JOIN chapters c ON c.id = n.chapter_id AND c.story_id = n.story_id WHERE n.user_id',
          ) +
          (unread === 'true' ? ' AND n.read_at IS NULL' : '') +
          ' ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3',
        [userId, limit, (page - 1) * limit],
      );
      const counts = summary.rows[0] ?? { total: 0, unreadCount: 0 };
      return response.json({
        notifications: result.rows,
        unreadCount: counts.unreadCount,
        pagination: { page, limit, total: unread === 'true' ? counts.unreadCount : counts.total },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/me/notifications/read-all', limiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token')))
      return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      await database.query(
        'UPDATE reader_notifications n SET read_at = now() FROM stories s ' +
          `WHERE n.story_id = s.id AND n.user_id = $1 AND n.read_at IS NULL AND ${published}`,
        [userId],
      );
      return response.json({ read: true });
    } catch (error) {
      return next(error);
    }
  });
  router.put('/me/notifications/:notificationId/read', limiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token')))
      return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    if (!id(request.params.notificationId))
      return fail(response, 400, 'INVALID_REQUEST', 'Thông báo không hợp lệ.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      const result = await database.query(
        'UPDATE reader_notifications n SET read_at = COALESCE(n.read_at, now()) FROM stories s ' +
          `WHERE n.id = $1 AND n.user_id = $2 AND n.story_id = s.id AND ${published} RETURNING n.id::text AS id`,
        [request.params.notificationId, userId],
      );
      if (!result.rows.length)
        return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy thông báo của bạn.');
      return response.json({ read: true });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
export const readerUpdatesRouter = createReaderUpdatesRouter();
