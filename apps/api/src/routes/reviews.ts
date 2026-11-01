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
const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().max(5000).default(''),
}).strict();
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  handler: (_request, response) => { fail(response, 429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Hãy thử lại sau.'); },
});
function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
async function user(request: Request, response: Response, db: Queryable) {
  const id = await readAccessUserId(request.cookies?.readlite_access);
  if (id) {
    const found = await db.query('SELECT id FROM users WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL', [id]);
    if (found.rows.length) return id;
  }
  fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để đánh giá truyện.');
  return null;
}
const publicStory = "visibility = 'public' AND moderation_status = 'published'";
const fields = 'id::text AS id, rating, content, created_at AS "createdAt", updated_at AS "updatedAt"';

export function createReviewsRouter(database: Database = pool): Router {
  const router = Router();
  router.get('/stories/:storyId/reviews', async (request, response, next) => {
    const id = request.params.storyId;
    const rawPage = request.query.page ?? '1';
    if (!validId(id)) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    if (typeof rawPage !== 'string' || !/^[1-9]\d{0,6}$/.test(rawPage)) return fail(response, 400, 'INVALID_REQUEST', 'Trang không hợp lệ.');
    const page = Number(rawPage), limit = 10;
    try {
      const story = await database.query<{ ratingAvg: number; ratingCount: number }>(
        `SELECT rating_avg::float8 AS "ratingAvg", rating_count AS "ratingCount" FROM stories WHERE id = $1 AND ${publicStory}`, [id]);
      if (!story.rows[0]) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      const reviews = await database.query(
        'SELECT r.id::text AS id, r.rating, r.content, r.created_at AS "createdAt", r.updated_at AS "updatedAt", ' +
        'u.display_name AS "displayName" FROM reviews r JOIN users u ON u.id = r.user_id ' +
        "JOIN stories s ON s.id = r.story_id WHERE r.story_id = $1 AND s.visibility = 'public' AND s.moderation_status = 'published' " +
        'ORDER BY r.updated_at DESC, r.id DESC LIMIT $2 OFFSET $3', [id, limit, (page - 1) * limit]);
      return response.json({ reviews: reviews.rows, ...story.rows[0], pagination: { page, limit, total: story.rows[0].ratingCount } });
    } catch (error) { return next(error); }
  });
  router.get('/stories/:storyId/reviews/me', async (request, response, next) => {
    if (!validId(request.params.storyId)) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    try {
      const userId = await user(request, response, database);
      if (!userId) return;
      const story = await database.query(`SELECT id FROM stories WHERE id = $1 AND ${publicStory}`, [request.params.storyId]);
      if (!story.rows.length) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      const result = await database.query(`SELECT ${fields} FROM reviews WHERE story_id = $1 AND user_id = $2`, [request.params.storyId, userId]);
      return response.json({ review: result.rows[0] ?? null });
    } catch (error) { return next(error); }
  });
  for (const method of ['put', 'delete'] as const) {
    router[method]('/stories/:storyId/reviews/me', limiter, async (request, response, next) => {
      if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      const id = request.params.storyId;
      const parsed = reviewSchema.safeParse(request.body);
      if (!validId(id) || method === 'put' && !parsed.success) return fail(response, 400, 'INVALID_REQUEST', 'Chọn từ 1 đến 5 sao, nhận xét tối đa 5000 ký tự.');
      try {
        const userId = await user(request, response, database);
        if (!userId) return;
        const client = await database.connect();
        try {
          await client.query('BEGIN');
          // Keep publication stable until the review and its aggregate trigger commit.
          const story = await client.query(`SELECT id FROM stories WHERE id = $1 AND ${publicStory} FOR UPDATE`, [id]);
          if (!story.rows.length) {
            await client.query('ROLLBACK');
            return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
          }
          let review = null;
          if (method === 'put' && parsed.success) {
            const result = await client.query(
              'INSERT INTO reviews (story_id, user_id, rating, content) VALUES ($1, $2, $3, $4) ' +
              'ON CONFLICT (story_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, content = EXCLUDED.content ' +
              `RETURNING ${fields}`, [id, userId, parsed.data.rating, parsed.data.content]);
            review = result.rows[0];
          } else {
            await client.query('DELETE FROM reviews WHERE story_id = $1 AND user_id = $2', [id, userId]);
          }
          await client.query('COMMIT');
          return response.json({ review });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally { client.release(); }
      } catch (error) { return next(error); }
    });
  }
  return router;
}
export const reviewsRouter = createReviewsRouter();
