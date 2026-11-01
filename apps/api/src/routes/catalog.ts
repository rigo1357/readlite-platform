import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';

export function mapReaderBlocks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((valueBlock): Array<Record<string, unknown>> => {
    if (!valueBlock || typeof valueBlock !== 'object') return [];
    const block = valueBlock as Record<string, unknown>;
    if (
      block.type === 'text' &&
      ['paragraph', 'heading', 'quote'].includes(String(block.kind)) &&
      Array.isArray(block.runs)
    ) {
      const runs = block.runs.flatMap((valueRun): Array<Record<string, unknown>> => {
        if (!valueRun || typeof valueRun !== 'object') return [];
        const run = valueRun as Record<string, unknown>;
        if (typeof run.text !== 'string') return [];
        return [{
          text: run.text,
          bold: run.bold === true,
          italic: run.italic === true,
        }];
      });
      return [{ type: 'text', kind: block.kind, runs }];
    }
    if (
      block.type === 'image' &&
      typeof block.mediaId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(block.mediaId)
    ) {
      return [{
        type: 'image',
        mediaId: block.mediaId,
        url: '/api/v1/media/' + block.mediaId,
        altText: typeof block.altText === 'string' ? block.altText : '',
        caption: typeof block.caption === 'string' ? block.caption : null,
      }];
    }
    return [];
  });
}

export function createCatalogRouter(database: Pick<typeof pool, 'query'> = pool) {
  const catalogRouter = Router();

const allowedSorts = new Set([
  'newest',
  'most_read',
  'trending',
  'top_rated',
]);

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

function readQueryString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'string' ? value : null;
}

function readPositiveInteger(
  value: unknown,
  defaultValue: number,
): number | null {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function isValidId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) {
    return false;
  }

  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

catalogRouter.get('/genres', async (request, response) => {
  const rawQuery = readQueryString(request.query.q);

  if (rawQuery === null) {
    return invalidRequest(response);
  }

  const query = rawQuery?.trim() || null;

  if (query && query.length > 100) {
    return invalidRequest(response);
  }

  const result = await database.query(
    `SELECT
       g.id::text AS id,
       g.name::text AS name,
       g.slug,
       COUNT(DISTINCT s.id)::int AS "storyCount"
     FROM genres g
     LEFT JOIN story_genres sg
       ON sg.genre_id = g.id
     LEFT JOIN stories s
       ON s.id = sg.story_id
      AND s.visibility = 'public'
      AND s.moderation_status = 'published'
     WHERE ($1::text IS NULL OR g.name::text ILIKE '%' || $1 || '%')
     GROUP BY g.id, g.name, g.slug
     ORDER BY g.name ASC`,
    [query],
  );

  return response.status(200).json({
    genres: result.rows,
  });
});

catalogRouter.get('/stories', async (request, response) => {
  const rawQuery = readQueryString(request.query.q);
  const rawGenre = readQueryString(request.query.genre);
  const rawSort = readQueryString(request.query.sort);
  const rawLifecycle = readQueryString(request.query.lifecycle);

  if (rawQuery === null || rawGenre === null || rawSort === null || rawLifecycle === null ||
    (rawLifecycle !== undefined && !['ongoing', 'completed', 'paused'].includes(rawLifecycle))) {
    return invalidRequest(response);
  }

  const query = rawQuery?.trim() || null;
  const genre = rawGenre?.trim().toLowerCase() || null;
  const sort = rawSort ?? 'newest';
  const page = readPositiveInteger(request.query.page, 1);
  const limit = readPositiveInteger(request.query.limit, 20);

  if (
    (query !== null && query.length > 200) ||
    (genre !== null && genre.length > 100) ||
    page === null ||
    limit === null ||
    limit > 50 ||
    !allowedSorts.has(sort)
  ) {
    return invalidRequest(response);
  }

  const offset = (page - 1) * limit;

  if (!Number.isSafeInteger(offset)) {
    return invalidRequest(response);
  }

  const filters = `
    s.visibility = 'public'
    AND s.moderation_status = 'published'
    AND ($3::text IS NULL OR s.lifecycle_status=$3)
    AND (
      $1::text IS NULL
      OR s.title ILIKE '%' || $1 || '%'
      OR s.author ILIKE '%' || $1 || '%'
      OR s.summary ILIKE '%' || $1 || '%'
    )
    AND (
      $2::text IS NULL
      OR EXISTS (
        SELECT 1
        FROM story_genres sg_filter
        JOIN genres g_filter ON g_filter.id = sg_filter.genre_id
        WHERE sg_filter.story_id = s.id
          AND g_filter.slug = $2
      )
    )
  `;

  const ratingFilter =
    sort === 'top_rated' ? 'AND s.rating_count >= 5' : '';

  const countResult = await database.query(
    `SELECT COUNT(*) AS total
     FROM stories s
     WHERE ${filters}
       ${ratingFilter}`,
    [query, genre, rawLifecycle ?? null],
  );

  const newestOrder = `
    COALESCE(
      (SELECT MAX(ch.updated_at)
       FROM chapters ch
       WHERE ch.story_id = s.id),
      s.created_at
    ) DESC NULLS LAST
  `;

  const orderBy: Record<string, string> = {
    newest: newestOrder,
    most_read: `
      (SELECT COUNT(DISTINCT rp.user_id)
       FROM reading_progress rp
       WHERE rp.story_id = s.id
         AND rp.last_read_at >= NOW() - INTERVAL '30 days') DESC,
      ${newestOrder}
    `,
    trending: `
      (SELECT COUNT(DISTINCT rp.user_id)
       FROM reading_progress rp
       WHERE rp.story_id = s.id
         AND rp.last_read_at >= NOW() - INTERVAL '7 days') DESC,
      ${newestOrder}
    `,
    top_rated: `
      s.rating_avg DESC,
      s.rating_count DESC,
      ${newestOrder}
    `,
  };

  const storiesResult = await database.query(
    `SELECT
       s.id::text AS id,
       s.title,
       s.author,
       s.summary,
       s.cover_url AS "coverUrl",
       s.publication_date AS "publicationDate",
       s.lifecycle_status AS "lifecycleStatus",
       s.lifecycle_changed_at AS "lifecycleChangedAt",
       s.total_chapters AS "totalChapters",
       s.rating_avg::float8 AS "ratingAvg",
       s.rating_count AS "ratingCount",
       s.created_at AS "createdAt",
       s.updated_at AS "updatedAt",
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', g.id::text,
               'name', g.name::text,
               'slug', g.slug
             )
             ORDER BY g.name
           )
           FROM story_genres sg
           JOIN genres g ON g.id = sg.genre_id
           WHERE sg.story_id = s.id
         ),
         '[]'::json
       ) AS genres
     FROM stories s
     WHERE ${filters}
       ${ratingFilter}
     ORDER BY ${orderBy[sort]}, s.id DESC
     LIMIT $4
     OFFSET $5`,
    [query, genre, rawLifecycle ?? null, limit, offset],
  );

  const total = Number(countResult.rows[0].total);

  return response.status(200).json({
    stories: storiesResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

catalogRouter.get('/stories/:storyId/chapters/:chapterId', async (request, response) => {
  const { storyId, chapterId } = request.params;

  if (!isValidId(storyId) || !isValidId(chapterId)) {
    return notFound(response);
  }

  const result = await database.query(
    'SELECT ' +
      'c.id::text AS id, c.story_id::text AS "storyId", ' +
      'c.chapter_order AS "chapterOrder", c.title, c.content, ' +
      'c.content_blocks AS "contentBlocks", c.word_count AS "wordCount", ' +
      'v.id::text AS "volumeId", v.title AS "volumeTitle", ' +
      'v.volume_order AS "volumeOrder", ' +
      'c.created_at AS "createdAt", c.updated_at AS "updatedAt" ' +
      'FROM chapters c JOIN stories s ON s.id = c.story_id ' +
      'LEFT JOIN volumes v ON v.id = c.volume_id AND v.story_id = c.story_id ' +
      'WHERE c.story_id = $1 AND c.id = $2 ' +
      "AND s.visibility = 'public' AND s.moderation_status = 'published'",
    [storyId, chapterId],
  );

  if (result.rows.length === 0) {
    return notFound(response);
  }

  const row = result.rows[0] as Record<string, unknown>;
  const { contentBlocks, ...chapter } = row;
  return response.status(200).json({
    chapter: { ...chapter, blocks: mapReaderBlocks(contentBlocks) },
  });
});
catalogRouter.get('/stories/:storyId/chapters', async (request, response) => {
  const { storyId } = request.params;

  if (!isValidId(storyId)) {
    return notFound(response);
  }

  const storyResult = await database.query(
    'SELECT 1 FROM stories WHERE id = $1 ' +
      "AND visibility = 'public' AND moderation_status = 'published'",
    [storyId],
  );
  if (storyResult.rows.length === 0) {
    return notFound(response);
  }

  const result = await database.query(
    'SELECT c.id::text AS id, c.story_id::text AS "storyId", ' +
      'c.chapter_order AS "chapterOrder", c.title, c.content, ' +
      'c.content_blocks AS "contentBlocks", c.word_count AS "wordCount", ' +
      'v.id::text AS "volumeId", v.title AS "volumeTitle", ' +
      'v.volume_order AS "volumeOrder", ' +
      'c.created_at AS "createdAt", c.updated_at AS "updatedAt" ' +
      'FROM chapters c ' +
      'LEFT JOIN volumes v ON v.id = c.volume_id AND v.story_id = c.story_id ' +
      'WHERE c.story_id = $1 ' +
      'ORDER BY COALESCE(v.volume_order, 0), c.chapter_order ASC',
    [storyId],
  );

  const chapters: Array<Record<string, unknown>> = result.rows.map((valueRow): Record<string, unknown> => {
    const row = valueRow as Record<string, unknown>;
    const { contentBlocks, ...chapter } = row;
    return { ...chapter, blocks: mapReaderBlocks(contentBlocks) };
  });
  const volumeMap = new Map<string, {
    id: string;
    title: string;
    order: number;
    chapters: Array<Record<string, unknown>>;
  }>();
  for (const chapter of chapters) {
    if (
      typeof chapter.volumeId !== 'string' ||
      typeof chapter.volumeTitle !== 'string' ||
      typeof chapter.volumeOrder !== 'number'
    ) {
      continue;
    }
    let volume = volumeMap.get(chapter.volumeId);
    if (!volume) {
      volume = {
        id: chapter.volumeId,
        title: chapter.volumeTitle,
        order: chapter.volumeOrder,
        chapters: [],
      };
      volumeMap.set(chapter.volumeId, volume);
    }
    volume.chapters.push(chapter);
  }

  return response.status(200).json({
    chapters,
    volumes: [...volumeMap.values()],
  });
});
catalogRouter.get('/stories/:storyId', async (request, response) => {
  const { storyId } = request.params;

  if (!isValidId(storyId)) {
    return notFound(response);
  }

  const result = await database.query(
    `SELECT
       s.id::text AS id,
       s.title,
       s.author,
       s.summary,
       s.cover_url AS "coverUrl",
       s.publication_date AS "publicationDate",
       s.lifecycle_status AS "lifecycleStatus",
       s.lifecycle_changed_at AS "lifecycleChangedAt",
       s.total_chapters AS "totalChapters",
       s.rating_avg::float8 AS "ratingAvg",
       s.rating_count AS "ratingCount",
       s.created_at AS "createdAt",
       s.updated_at AS "updatedAt",
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', g.id::text,
               'name', g.name::text,
               'slug', g.slug
             )
             ORDER BY g.name
           )
           FROM story_genres sg
           JOIN genres g ON g.id = sg.genre_id
           WHERE sg.story_id = s.id
         ),
         '[]'::json
       ) AS genres
     FROM stories s
     WHERE s.id = $1
       AND s.visibility = 'public'
       AND s.moderation_status = 'published'`,
    [storyId],
  );

  if (result.rows.length === 0) {
    return notFound(response);
  }

  return response.status(200).json({
    story: result.rows[0],
  });
});

  return catalogRouter;
}

export const catalogRouter = createCatalogRouter();
