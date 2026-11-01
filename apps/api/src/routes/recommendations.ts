import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';
import { readAccessUserId } from './auth.js';

interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

const publicStory = "s.visibility = 'public' AND s.moderation_status = 'published'";
const summaryFields = `
  s.id::text AS id, s.title, s.author, s.summary,
  s.cover_url AS "coverUrl", s.total_chapters AS "totalChapters",
  s.rating_avg::float8 AS "ratingAvg", s.rating_count AS "ratingCount",
  COALESCE((
    SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name::text, 'slug', g.slug)
                    ORDER BY g.name)
    FROM story_genres sg JOIN genres g ON g.id = sg.genre_id
    WHERE sg.story_id = s.id
  ), '[]'::json) AS genres
`;
const interactions = `
  user_interactions AS (
    SELECT story_id, 3 AS weight FROM favorites WHERE user_id = $1
    UNION ALL
    SELECT story_id, 1 AS weight FROM reading_progress WHERE user_id = $1
  )
`;
function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}

export function createRecommendationsRouter(database: Queryable = pool): Router {
  const router = Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.get('/me/recommendations', async (request, response, next) => {
    const rawLimit = request.query.limit ?? '10';
    if (typeof rawLimit !== 'string' || !/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 20) {
      return fail(response, 400, 'INVALID_REQUEST', 'Số truyện gợi ý phải từ 1 đến 20.');
    }
    const limit = Number(rawLimit);
    try {
      const userId = await readAccessUserId(request.cookies?.readlite_access);
      if (!userId) return fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để xem gợi ý cho bạn.');
      const user = await database.query(
        'SELECT id FROM users WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL', [userId],
      );
      if (!user.rows.length) return fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để xem gợi ý cho bạn.');

      // Favorites count three times as much as reading a story. A genre's weight
      // adds up across the reader's public stories; no external AI is required.
      const matched = await database.query(`
        WITH ${interactions}, genre_preferences AS (
          SELECT sg.genre_id, SUM(ui.weight) AS weight
          FROM user_interactions ui
          JOIN stories source ON source.id = ui.story_id
            AND source.visibility = 'public' AND source.moderation_status = 'published'
          JOIN story_genres sg ON sg.story_id = ui.story_id
          GROUP BY sg.genre_id
        ), candidate_matches AS (
          SELECT sg.story_id, SUM(gp.weight) AS match_score,
                 (array_agg(g.name::text ORDER BY gp.weight DESC, g.name::text, g.id))[1] AS matched_genre
          FROM story_genres sg JOIN genre_preferences gp ON gp.genre_id = sg.genre_id
          JOIN genres g ON g.id = sg.genre_id
          GROUP BY sg.story_id
        )
        SELECT ${summaryFields},
               'Cùng thể loại ' || cm.matched_genre || ' với truyện bạn đã thích hoặc đọc' AS "recommendationReason"
        FROM stories s JOIN candidate_matches cm ON cm.story_id = s.id
        WHERE ${publicStory}
          AND NOT EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.story_id = s.id)
        ORDER BY cm.match_score DESC, s.rating_count DESC, s.rating_avg DESC, s.id DESC
        LIMIT $2
      `, [userId, limit]);
      if (matched.rows.length) return response.json({ stories: matched.rows, personalized: true });

      // Cold start (or no unseen genre matches): use measured readership and
      // reviews, then recency. Every returned label describes a real signal.
      const fallback = await database.query(`
        WITH ${interactions}, readership AS (
          SELECT story_id, COUNT(DISTINCT user_id) AS readers FROM reading_progress GROUP BY story_id
        )
        SELECT ${summaryFields},
               CASE
                 WHEN COALESCE(r.readers, 0) > 0 AND s.rating_count > 0 THEN 'Được độc giả đọc và đánh giá'
                 WHEN COALESCE(r.readers, 0) > 0 THEN 'Được độc giả khác đọc'
                 WHEN s.rating_count > 0 THEN 'Đã có đánh giá từ độc giả'
                 ELSE 'Truyện mới để bạn khám phá'
               END AS "recommendationReason"
        FROM stories s LEFT JOIN readership r ON r.story_id = s.id
        WHERE ${publicStory}
          AND NOT EXISTS (SELECT 1 FROM user_interactions ui WHERE ui.story_id = s.id)
        ORDER BY COALESCE(r.readers, 0) DESC, s.rating_count DESC, s.rating_avg DESC, s.created_at DESC, s.id DESC
        LIMIT $2
      `, [userId, limit]);
      return response.json({ stories: fallback.rows, personalized: false });
    } catch (error) { return next(error); }
  });
  return router;
}

export const recommendationsRouter = createRecommendationsRouter();
