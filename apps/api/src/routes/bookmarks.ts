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
type Chapter = { id: string; chapterTitle: string; chapterOrder: number };
type Bookmark = {
  id: string;
  storyId: string;
  chapterId: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
  positionPermille: number;
  note: string;
  createdAt: unknown;
};
function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
const note = z.string().trim().max(2000);
const createSchema = z
  .object({
    chapterId: z.string().refine(validId),
    positionPermille: z.number().int().min(0).max(1000),
    note: note.default(''),
  })
  .strict();
const editSchema = z.object({ note }).strict();
const publicStory = "visibility = 'public' AND moderation_status = 'published'";
const fields =
  'b.id::text AS id, b.story_id::text AS "storyId", b.chapter_id::text AS "chapterId", ' +
  'c.title AS "chapterTitle", c.chapter_order AS "chapterOrder", b.position_permille AS "positionPermille", b.note, b.created_at AS "createdAt"';
const returning =
  'id::text AS id, story_id::text AS "storyId", chapter_id::text AS "chapterId", ' +
  'position_permille AS "positionPermille", note, created_at AS "createdAt"';
function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
async function requireUser(request: Request, response: Response, database: Queryable) {
  const userId = await readAccessUserId(request.cookies?.readlite_access);
  if (userId) {
    const user = await database.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL',
      [userId],
    );
    if (user.rows.length) return userId;
  }
  fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để dùng dấu trang.');
  return null;
}

export function createBookmarksRouter(database: Database = pool): Router {
  const router = Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      fail(response, 429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Hãy thử lại sau.');
    },
  });

  router.get('/stories/:storyId/bookmarks', async (request, response, next) => {
    const storyId = request.params.storyId,
      rawPage = request.query.page ?? '1';
    if (!validId(storyId)) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    if (typeof rawPage !== 'string' || !/^[1-9]\d{0,6}$/.test(rawPage))
      return fail(response, 400, 'INVALID_REQUEST', 'Trang không hợp lệ.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      const story = await database.query(
        `SELECT id FROM stories WHERE id = $1 AND ${publicStory}`,
        [storyId],
      );
      if (!story.rows.length) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      const page = Number(rawPage),
        limit = 20;
      const filter =
        "FROM bookmarks b JOIN stories s ON s.id = b.story_id WHERE b.story_id = $1 AND b.user_id = $2 AND s.visibility = 'public' AND s.moderation_status = 'published'";
      const count = await database.query<{ total: number }>(
        'SELECT count(*)::int AS total ' + filter,
        [storyId, userId],
      );
      const result = await database.query<Bookmark>(
        `SELECT ${fields} ` +
          filter.replace(
            'WHERE b.story_id',
            'LEFT JOIN chapters c ON c.id = b.chapter_id AND c.story_id = b.story_id WHERE b.story_id',
          ) +
          ' ORDER BY b.created_at DESC, b.id DESC LIMIT $3 OFFSET $4',
        [storyId, userId, limit, (page - 1) * limit],
      );
      return response.json({
        bookmarks: result.rows,
        pagination: { page, limit, total: count.rows[0]?.total ?? 0 },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/stories/:storyId/bookmarks', limiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token')))
      return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const storyId = request.params.storyId,
      parsed = createSchema.safeParse(request.body);
    if (!validId(storyId) || !parsed.success)
      return fail(response, 400, 'INVALID_REQUEST', 'Dấu trang hoặc ghi chú chưa hợp lệ.');
    try {
      const userId = await requireUser(request, response, database);
      if (!userId) return;
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const story = await client.query(
          `SELECT id FROM stories WHERE id = $1 AND ${publicStory} FOR UPDATE`,
          [storyId],
        );
        if (!story.rows.length) {
          await client.query('ROLLBACK');
          return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
        }
        const chapter = await client.query<Chapter>(
          'SELECT id::text AS id, title AS "chapterTitle", chapter_order AS "chapterOrder" ' +
            'FROM chapters WHERE id = $1 AND story_id = $2 FOR KEY SHARE',
          [parsed.data.chapterId, storyId],
        );
        if (!chapter.rows[0]) {
          await client.query('ROLLBACK');
          return fail(response, 404, 'NOT_FOUND', 'Chương không thuộc truyện hoặc đã bị xóa.');
        }
        const inserted = await client.query(
          'INSERT INTO bookmarks (user_id, story_id, chapter_id, position_permille, note) ' +
            `VALUES ($1, $2, $3, $4, $5) RETURNING ${returning}`,
          [userId, storyId, parsed.data.chapterId, parsed.data.positionPermille, parsed.data.note],
        );
        await client.query('COMMIT');
        return response
          .status(201)
          .json({
            bookmark: {
              ...inserted.rows[0],
              chapterTitle: chapter.rows[0].chapterTitle,
              chapterOrder: chapter.rows[0].chapterOrder,
            },
          });
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

  for (const method of ['put', 'delete'] as const) {
    router[method]('/bookmarks/:bookmarkId', limiter, async (request, response, next) => {
      if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token')))
        return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      const bookmarkId = request.params.bookmarkId,
        parsed = editSchema.safeParse(request.body);
      if (!validId(bookmarkId) || (method === 'put' && !parsed.success))
        return fail(response, 400, 'INVALID_REQUEST', 'Ghi chú tối đa 2000 ký tự.');
      try {
        const userId = await requireUser(request, response, database);
        if (!userId) return;
        const client = await database.connect();
        try {
          await client.query('BEGIN');
          // Find the story first; acquire locks in the same order as story moderation.
          const target = await client.query<{ storyId: string }>(
            'SELECT story_id::text AS "storyId" FROM bookmarks WHERE id = $1 AND user_id = $2',
            [bookmarkId, userId],
          );
          const storyId = target.rows[0]?.storyId;
          const story = storyId
            ? await client.query(
                `SELECT id FROM stories WHERE id = $1 AND ${publicStory} FOR UPDATE`,
                [storyId],
              )
            : { rows: [] };
          if (!story.rows.length) {
            await client.query('ROLLBACK');
            return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy dấu trang của bạn.');
          }
          const locked = await client.query<Bookmark>(
            `SELECT ${fields} FROM bookmarks b LEFT JOIN chapters c ON c.id = b.chapter_id AND c.story_id = b.story_id ` +
              'WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b',
            [bookmarkId, userId],
          );
          if (!locked.rows[0]) {
            await client.query('ROLLBACK');
            return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy dấu trang của bạn.');
          }
          let bookmark = null;
          if (method === 'put' && parsed.success) {
            const updated = await client.query(
              `UPDATE bookmarks SET note = $3 WHERE id = $1 AND user_id = $2 RETURNING ${returning}`,
              [bookmarkId, userId, parsed.data.note],
            );
            bookmark = {
              ...updated.rows[0],
              chapterTitle: locked.rows[0].chapterTitle,
              chapterOrder: locked.rows[0].chapterOrder,
            };
          } else
            await client.query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2', [
              bookmarkId,
              userId,
            ]);
          await client.query('COMMIT');
          return response.json(method === 'put' ? { bookmark } : { bookmarkId, deleted: true });
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
  return router;
}
export const bookmarksRouter = createBookmarksRouter();
