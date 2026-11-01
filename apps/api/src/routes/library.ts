import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Router, type Request, type Response } from 'express';
import { pool } from '../db/pool.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

interface QueryResult<Row> {
  rows: Row[];
}

interface Database {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

const progressSchema = z.object({
  chapterId: z.string().regex(/^[1-9]\d*$/).max(19),
  positionPermille: z.number().int().min(0).max(1000),
});

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
      },
    });
  },
});

function isValidId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value) || value.length > 19) {
    return false;
  }

  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

function unauthorized(response: Response) {
  return response.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập để tiếp tục.',
    },
  });
}

function invalidRequest(response: Response) {
  return response.status(400).json({
    error: {
      code: 'INVALID_REQUEST',
      message: 'Dữ liệu gửi lên không hợp lệ.',
    },
  });
}

function notFound(response: Response) {
  return response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy truyện.',
    },
  });
}

function csrfInvalid(response: Response) {
  return response.status(403).json({
    error: {
      code: 'CSRF_INVALID',
      message: 'Yêu cầu không hợp lệ.',
    },
  });
}

async function verifiedUserId(
  request: Request,
  response: Response,
  database: Database,
): Promise<string | null> {
  const userId = await readAccessUserId(request.cookies?.readlite_access);

  if (!userId) {
    unauthorized(response);
    return null;
  }

  const result = await database.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE id = $1
       AND is_active = true
       AND email_verified_at IS NOT NULL`,
    [userId],
  );

  if (!result.rows[0]) {
    unauthorized(response);
    return null;
  }

  return userId;
}

export function createLibraryRouter(database: Database = pool): Router {
  const router = Router();

  router.get('/me/library', async (request, response, next) => {
    try {
      const userId = await verifiedUserId(request, response, database);

      if (!userId) {
        return;
      }

      const result = await database.query(
        `SELECT
           s.id::text AS id,
           s.title,
           s.author,
           s.summary,
           s.cover_url AS "coverUrl",
           s.total_chapters AS "totalChapters",
           s.rating_avg::float8 AS "ratingAvg",
           s.rating_count AS "ratingCount",
           (f.story_id IS NOT NULL) AS "isFavorite",
           CASE
             WHEN rp.story_id IS NULL OR rp.current_chapter_id IS NULL THEN NULL
             ELSE json_build_object(
               'chapterId', rp.current_chapter_id::text,
               'chapterOrder', c.chapter_order,
               'chapterTitle', c.title,
               'positionPermille', rp.position_permille,
               'lastReadAt', rp.last_read_at
             )
           END AS "readingProgress"
         FROM stories s
         LEFT JOIN favorites f
           ON f.story_id = s.id
          AND f.user_id = $1
         LEFT JOIN reading_progress rp
           ON rp.story_id = s.id
          AND rp.user_id = $1
         LEFT JOIN chapters c
           ON c.id = rp.current_chapter_id
          AND c.story_id = s.id
         WHERE s.visibility = 'public'
           AND s.moderation_status = 'published'
           AND (f.story_id IS NOT NULL OR rp.story_id IS NOT NULL)
         ORDER BY COALESCE(rp.last_read_at, f.created_at) DESC, s.id DESC`,
        [userId],
      );

      return response.status(200).json({ stories: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.put(
    '/stories/:storyId/favorite',
    mutationLimiter,
    async (request, response, next) => {
      if (
        !csrfTokensMatch(
          request.cookies?.readlite_csrf,
          request.get('x-csrf-token'),
        )
      ) {
        return csrfInvalid(response);
      }

      const storyId = typeof request.params.storyId === 'string'
        ? request.params.storyId
        : '';

      if (!isValidId(storyId)) {
        return notFound(response);
      }

      try {
        const userId = await verifiedUserId(request, response, database);

        if (!userId) {
          return;
        }

        const result = await database.query<{ storyId: string }>(
          `INSERT INTO favorites (user_id, story_id)
           SELECT $1, s.id
           FROM stories s
           WHERE s.id = $2
             AND s.visibility = 'public'
             AND s.moderation_status = 'published'
           ON CONFLICT (user_id, story_id) DO UPDATE
             SET created_at = favorites.created_at
           RETURNING story_id::text AS "storyId"`,
          [userId, storyId],
        );

        if (!result.rows[0]) {
          return notFound(response);
        }

        return response.status(200).json({
          storyId: result.rows[0].storyId,
          isFavorite: true,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete(
    '/stories/:storyId/favorite',
    mutationLimiter,
    async (request, response, next) => {
      if (
        !csrfTokensMatch(
          request.cookies?.readlite_csrf,
          request.get('x-csrf-token'),
        )
      ) {
        return csrfInvalid(response);
      }

      const storyId = typeof request.params.storyId === 'string'
        ? request.params.storyId
        : '';

      if (!isValidId(storyId)) {
        return notFound(response);
      }

      try {
        const userId = await verifiedUserId(request, response, database);

        if (!userId) {
          return;
        }

        const result = await database.query<{ storyId: string }>(
          `WITH visible_story AS (
             SELECT id
             FROM stories
             WHERE id = $2
               AND visibility = 'public'
               AND moderation_status = 'published'
           ), removed AS (
             DELETE FROM favorites f
             USING visible_story s
             WHERE f.user_id = $1
               AND f.story_id = s.id
             RETURNING f.story_id
           )
           SELECT id::text AS "storyId"
           FROM visible_story`,
          [userId, storyId],
        );

        if (!result.rows[0]) {
          return notFound(response);
        }

        return response.status(200).json({
          storyId: result.rows[0].storyId,
          isFavorite: false,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    '/stories/:storyId/reading-progress',
    async (request, response, next) => {
      const storyId = typeof request.params.storyId === 'string'
        ? request.params.storyId
        : '';

      if (!isValidId(storyId)) {
        return notFound(response);
      }

      try {
        const userId = await verifiedUserId(request, response, database);

        if (!userId) {
          return;
        }

        const result = await database.query<{
          storyId: string;
          chapterId: string | null;
          chapterOrder: number | null;
          chapterTitle: string | null;
          positionPermille: number | null;
          lastReadAt: Date | null;
        }>(
          `SELECT
             s.id::text AS "storyId",
             rp.current_chapter_id::text AS "chapterId",
             c.chapter_order AS "chapterOrder",
             c.title AS "chapterTitle",
             rp.position_permille AS "positionPermille",
             rp.last_read_at AS "lastReadAt"
           FROM stories s
           LEFT JOIN reading_progress rp
             ON rp.story_id = s.id
            AND rp.user_id = $1
           LEFT JOIN chapters c
             ON c.id = rp.current_chapter_id
            AND c.story_id = s.id
           WHERE s.id = $2
             AND s.visibility = 'public'
             AND s.moderation_status = 'published'`,
          [userId, storyId],
        );

        if (!result.rows[0]) {
          return notFound(response);
        }

        const row = result.rows[0];
        const progress = row.chapterId === null
          ? null
          : {
              chapterId: row.chapterId,
              chapterOrder: row.chapterOrder,
              chapterTitle: row.chapterTitle,
              positionPermille: row.positionPermille,
              lastReadAt: row.lastReadAt,
            };

        return response.status(200).json({
          storyId: row.storyId,
          progress,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.put(
    '/stories/:storyId/reading-progress',
    mutationLimiter,
    async (request, response, next) => {
      if (
        !csrfTokensMatch(
          request.cookies?.readlite_csrf,
          request.get('x-csrf-token'),
        )
      ) {
        return csrfInvalid(response);
      }

      const storyId = typeof request.params.storyId === 'string'
        ? request.params.storyId
        : '';
      const parsed = progressSchema.safeParse(request.body);

      if (!isValidId(storyId) || !parsed.success || !isValidId(parsed.data.chapterId)) {
        return invalidRequest(response);
      }

      try {
        const userId = await verifiedUserId(request, response, database);

        if (!userId) {
          return;
        }

        const result = await database.query(
          `INSERT INTO reading_progress (
             user_id, story_id, current_chapter_id, position_permille, last_read_at
           )
           SELECT $1, s.id, c.id, $4, now()
           FROM stories s
           JOIN chapters c ON c.story_id = s.id
           WHERE s.id = $2
             AND s.visibility = 'public'
             AND s.moderation_status = 'published'
             AND c.id = $3
           ON CONFLICT (user_id, story_id) DO UPDATE
             SET current_chapter_id = EXCLUDED.current_chapter_id,
                 position_permille = EXCLUDED.position_permille,
                 last_read_at = now()
           RETURNING
             story_id::text AS "storyId",
             current_chapter_id::text AS "chapterId",
             position_permille AS "positionPermille",
             last_read_at AS "lastReadAt"`,
          [userId, storyId, parsed.data.chapterId, parsed.data.positionPermille],
        );

        if (!result.rows[0]) {
          return notFound(response);
        }

        return response.status(200).json({ progress: result.rows[0] });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export const libraryRouter = createLibraryRouter();


