import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { repairEpubMedia } from '../services/story-import-service.js';
import { pool } from '../db/pool.js';
import { LocalMediaStorage } from '../media/local-media-storage.js';
import type { MediaStorage } from '../media/media-storage.js';
import { stageSingleUpload, StagedUploadError } from '../media/staging-upload.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

interface QueryResult<Row> {
  rows: Row[];
}
interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}
interface Database extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}
type Contributor = { id: string; role: string };

const storyIdPattern = /^[1-9]\d{0,18}$/;
const allowedStatuses = new Set(['all', 'draft', 'pending', 'published']);
const genreIdSchema = z.string().regex(/^[1-9]\d{0,18}$/);
const publicationDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Ngày phát hành không hợp lệ.');
function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const manualChapterSchema = z.object({
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(500_000),
}).strict();
const manualStorySchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(20_000),
  language: z.string().trim().min(2).max(35).default('vi'),
  publicationDate: publicationDateSchema.nullable().optional(),
  genreIds: z.array(genreIdSchema).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  volumeTitle: z.string().trim().min(1).max(500).default('Tập 1'),
  chapters: z.array(manualChapterSchema).min(1).max(100),
}).strict();
const manualChaptersSchema = z.object({
  volumeTitle: z.string().trim().min(1).max(500),
  chapters: z.array(manualChapterSchema).min(1).max(100),
}).strict();
const epubStructureSchema = z.object({
  volumes: z.array(z.object({
    id: z.string().regex(/^[1-9]\d{0,18}$/u),
    title: z.string().trim().min(1).max(500),
    chapters: z.array(z.object({
      id: z.string().regex(/^[1-9]\d{0,18}$/u),
      title: z.string().trim().min(1).max(500),
    }).strict()).min(1).max(5000),
  }).strict()).min(1).max(500),
}).strict();
const metadataSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  author: z.string().trim().max(500).optional(),
  summary: z.string().max(20_000).optional(),
  language: z.string().trim().min(2).max(35).optional(),
  publicationDate: publicationDateSchema.nullable().optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
  genreIds: z.array(genreIdSchema).max(50).optional(),
}).strict().refine((data) => Object.keys(data).length > 0);

function jsonError(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}

async function requireContributor(
  request: Request,
  response: Response,
  database: Queryable,
): Promise<Contributor | null> {
  const userId = await readAccessUserId(request.cookies?.readlite_access);
  if (!userId) {
    jsonError(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }
  const result = await database.query<Contributor>(
    'SELECT id::text AS id, role FROM users ' +
      'WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL',
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    jsonError(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }
  if (user.role !== 'author' && user.role !== 'admin') {
    jsonError(response, 403, 'FORBIDDEN', 'Tài khoản chưa có quyền quản lý truyện.');
    return null;
  }
  return user;
}

function isValidStoryId(value: unknown): value is string {
  if (typeof value !== 'string' || !storyIdPattern.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

function chapterBlocks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block): Array<Record<string, unknown>> => {
    if (!block || typeof block !== 'object') return [];
    const record = block as Record<string, unknown>;
    if (record.type === 'image' && typeof record.mediaId === 'string') {
      return [{ ...record, url: '/api/v1/media/' + record.mediaId }];
    }
    if (record.type === 'text') return [record];
    return [];
  });
}

function validImageSignature(signature: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return signature.length >= 8
      && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === 'image/jpeg') {
    return signature.length >= 3
      && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  }
  return mimeType === 'image/webp'
    && signature.length >= 12
    && signature.subarray(0, 4).toString('ascii') === 'RIFF'
    && signature.subarray(8, 12).toString('ascii') === 'WEBP';
}

const coverUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    jsonError(response, 429, 'RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'),
});
export function createAuthorStoriesRouter(
  database: Database = pool,
  storage: MediaStorage = new LocalMediaStorage(),
): Router {
  const router = Router();

  router.post('/author/stories/manual', async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      return jsonError(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    }
    const parsed = manualStorySchema.safeParse(request.body);
    if (!parsed.success) {
      return jsonError(response, 400, 'INVALID_REQUEST', 'Thông tin truyện hoặc chương chưa hợp lệ.');
    }

    const client = await database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const genres = await client.query<{ id: string }>(
        'SELECT id::text AS id FROM genres WHERE id = ANY($1::bigint[])',
        [parsed.data.genreIds],
      );
      if (genres.rows.length !== parsed.data.genreIds.length) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return jsonError(response, 400, 'INVALID_GENRE', 'Có thể loại không hợp lệ.');
      }

      const storyResult = await client.query<{ id: string; title: string }>(
        'INSERT INTO stories ' +
          '(owner_id, title, author, summary, source, visibility, content, ' +
          'moderation_status, submitted_by, ai_review_status, ai_review_warnings, ' +
          'language, publication_date) ' +
          "VALUES ($1, $2, $3, $4, 'manual', 'private', '', 'draft', $1, " +
          "'not_started', '[]'::jsonb, $5, $6) RETURNING id::text AS id, title",
        [
          user.id,
          parsed.data.title,
          parsed.data.author,
          parsed.data.summary,
          parsed.data.language,
          parsed.data.publicationDate ?? localDateString(),
        ],
      );
      const story = storyResult.rows[0];
      if (!story) throw new Error('Manual story insert returned no row.');

      const volumeResult = await client.query<{ id: string }>(
        'INSERT INTO volumes (story_id, volume_order, title) ' +
          'VALUES ($1, 1, $2) RETURNING id::text AS id',
        [story.id, parsed.data.volumeTitle],
      );
      const volumeId = volumeResult.rows[0]?.id;
      if (!volumeId) throw new Error('Manual story volume insert returned no row.');

      for (const [index, chapter] of parsed.data.chapters.entries()) {
        await client.query(
          'INSERT INTO chapters ' +
            '(story_id, volume_id, chapter_order, title, content, word_count) ' +
            'VALUES ($1, $2, $3, $4, $5, $6)',
          [
            story.id,
            volumeId,
            index + 1,
            chapter.title,
            chapter.content,
            chapter.content.trim().split(/\s+/u).length,
          ],
        );
      }

      for (const genreId of parsed.data.genreIds) {
        await client.query(
          'INSERT INTO story_genres (story_id, genre_id) VALUES ($1, $2)',
          [story.id, genreId],
        );
      }

      await client.query(
        'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
          "VALUES ($1, $2, 'draft_created', $3::jsonb)",
        [
          story.id,
          user.id,
          JSON.stringify({ source: 'manual', chapters: parsed.data.chapters.length }),
        ],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return response.status(201).json({ story });
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally {
      client.release();
    }
  });

  router.get('/author/stories', async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    const rawStatus = request.query.status ?? 'all';
    if (typeof rawStatus !== 'string' || !allowedStatuses.has(rawStatus)) {
      return jsonError(response, 400, 'INVALID_REQUEST', 'Trạng thái lọc không hợp lệ.');
    }

    const filters: Record<string, string> = {
      all: '',
      draft: "AND moderation_status = 'draft'",
      pending: "AND moderation_status IN ('ai_review_pending', 'admin_review_pending', 'changes_requested')",
      published: "AND moderation_status = 'published'",
    };
    try {
      const result = await database.query(
        'SELECT id::text AS id, title, author, summary, language,lifecycle_status AS "lifecycleStatus",lifecycle_version AS "lifecycleVersion", ' +
          'moderation_status AS "moderationStatus", ai_review_status AS "aiReviewStatus", ' +
          'ai_review_warnings AS "aiReviewWarnings", cover_url AS "coverUrl", ' +
          'source, publication_date AS "publicationDate", ' +
          'total_chapters AS "totalChapters", created_at AS "createdAt", updated_at AS "updatedAt" ' +
          'FROM stories WHERE ' + (user.role === 'admin' ? 'true ' : 'submitted_by = $1 ') + filters[rawStatus] +
          ' ORDER BY updated_at DESC, id DESC',
        user.role === 'admin' ? [] : [user.id],
      );
      return response.status(200).json({ stories: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/author/stories/:storyId', async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    const storyId = request.params.storyId;
    if (!isValidStoryId(storyId)) {
      return jsonError(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    }

    try {
      const values: unknown[] = [storyId];
      let ownershipFilter = '';
      if (user.role !== 'admin') {
        values.push(user.id);
        ownershipFilter = 'AND submitted_by = $2';
      }
      const storyResult = await database.query(
        'SELECT id::text AS id, title, author, summary, language, source,lifecycle_status AS "lifecycleStatus",lifecycle_version AS "lifecycleVersion", ' +
          'moderation_status AS "moderationStatus", ai_review_status AS "aiReviewStatus", ' +
          'ai_review_warnings AS "aiReviewWarnings", cover_url AS "coverUrl", ' +
          'cover_media_id::text AS "coverMediaId", publication_date AS "publicationDate", ' +
          "EXISTS(SELECT 1 FROM story_content_updates cu WHERE cu.story_id=stories.id AND cu.status='published') AS \"hasPublishedUpdates\", " +
          'COALESCE((SELECT array_agg(sg.genre_id::text ORDER BY sg.genre_id) ' +
          'FROM story_genres sg WHERE sg.story_id = stories.id), ARRAY[]::text[]) AS "genreIds", ' +
          'total_chapters AS "totalChapters", created_at AS "createdAt", updated_at AS "updatedAt" ' +
          'FROM stories WHERE id = $1 ' + ownershipFilter,
        values,
      );
      const story = storyResult.rows[0];
      if (!story) {
        return jsonError(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      }

      const volumeResult = await database.query<{
        id: string;
        title: string;
        order: number;
      }>(
        'SELECT id::text AS id, title, volume_order AS "order" ' +
          'FROM volumes WHERE story_id = $1 ORDER BY volume_order ASC',
        [storyId],
      );
      const volumes = [];
      for (const volume of volumeResult.rows) {
        const chapterResult = await database.query<{
          id: string;
          title: string;
          order: number;
          content: string;
          contentBlocks: unknown;
          wordCount: number;
        }>(
          'SELECT id::text AS id, title, chapter_order AS "order", content, ' +
            'content_blocks AS "contentBlocks", word_count AS "wordCount" ' +
            'FROM chapters WHERE story_id = $1 AND volume_id = $2 ' +
            'ORDER BY chapter_order ASC',
          [storyId, volume.id],
        );
        volumes.push({
          ...volume,
          chapters: chapterResult.rows.map((chapter) => ({
            ...chapter,
            blocks: chapterBlocks(chapter.contentBlocks),
          })),
        });
      }
      if (volumes.length === 0) {
        // Stories created before the EPUB/volume migration (including seed stories)
        // still have chapters with a null volume_id. Keep them editable in admin.
        const legacy = await database.query<{
          id: string; title: string; order: number; content: string;
          contentBlocks: unknown; wordCount: number;
        }>(
          'SELECT id::text AS id, title, chapter_order AS "order", content, ' +
            'content_blocks AS "contentBlocks", word_count AS "wordCount" ' +
            'FROM chapters WHERE story_id = $1 AND volume_id IS NULL ORDER BY chapter_order ASC',
          [storyId],
        );
        if (legacy.rows.length) volumes.push({
          id: 'legacy', title: 'Tập 1', order: 1,
          chapters: legacy.rows.map((chapter) => ({
            ...chapter, blocks: chapterBlocks(chapter.contentBlocks),
          })),
        });
      }
      return response.status(200).json({ story, preview: { volumes } });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/author/stories/:storyId/chapters', async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      return jsonError(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    }
    const storyId = request.params.storyId;
    const parsed = manualChaptersSchema.safeParse(request.body);
    if (!isValidStoryId(storyId) || !parsed.success) {
      return jsonError(response, 400, 'INVALID_REQUEST', 'Nội dung chương chưa hợp lệ.');
    }

    const client = await database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const ownershipValues: unknown[] = [storyId];
      let ownershipFilter = '';
      if (user.role !== 'admin') {
        ownershipValues.push(user.id);
        ownershipFilter = 'AND submitted_by = $2';
      }
      const editable = await client.query<{ id: string; volumeId: string | null; protectedContent: boolean }>(
        "SELECT s.id::text AS id, v.id::text AS \"volumeId\", " +
          "(s.moderation_status = 'published' OR EXISTS (SELECT 1 FROM story_content_updates cu WHERE cu.story_id=s.id AND cu.status='published')) AS \"protectedContent\" " +
          'FROM stories s LEFT JOIN volumes v ON v.story_id = s.id AND v.volume_order = 1 ' +
          "WHERE s.id = $1 AND s.source = 'manual' " + ownershipFilter +
          (user.role === 'admin' ? " AND s.moderation_status NOT IN ('ai_review_pending', 'admin_review_pending') FOR UPDATE OF s" : " AND s.moderation_status IN ('draft', 'changes_requested') FOR UPDATE OF s"),
        ownershipValues,
      );
      const story = editable.rows[0];
      if (!story) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return jsonError(response, 404, 'DRAFT_NOT_EDITABLE', 'Không tìm thấy bản thảo thủ công có thể sửa.');
      }

      if (story.protectedContent) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return jsonError(response, 409, 'USE_CONTENT_UPDATE', 'Truyện đã xuất bản. Hãy dùng mục Bổ sung chương để giữ nguyên chương và tiến độ đọc cũ.');
      }

      let volumeId = story.volumeId;
      if (!volumeId) {
        const volume = await client.query<{ id: string }>(
          'INSERT INTO volumes (story_id, volume_order, title) ' +
            'VALUES ($1, 1, $2) RETURNING id::text AS id',
          [storyId, parsed.data.volumeTitle],
        );
        volumeId = volume.rows[0]?.id ?? null;
      } else {
        await client.query(
          'UPDATE volumes SET title = $2 WHERE id = $1',
          [volumeId, parsed.data.volumeTitle],
        );
      }
      if (!volumeId) throw new Error('Manual story volume update returned no row.');

      const existingChapters = await client.query<{ id: string }>(
        'SELECT id::text AS id FROM chapters WHERE story_id = $1 ORDER BY chapter_order ASC FOR UPDATE',
        [storyId],
      );
      const removedIds = existingChapters.rows.slice(parsed.data.chapters.length).map((chapter) => chapter.id);
      if (removedIds.length) {
        await client.query('DELETE FROM chapters WHERE id = ANY($1::bigint[])', [removedIds]);
      }
      for (const [index, chapter] of parsed.data.chapters.entries()) {
        const wordCount = chapter.content.trim().split(/\s+/u).length;
        const existing = existingChapters.rows[index];
        if (existing) {
          await client.query(
            'UPDATE chapters SET volume_id = $2, title = $3, content = $4, word_count = $5 WHERE id = $1',
            [existing.id, volumeId, chapter.title, chapter.content, wordCount],
          );
        } else {
          await client.query(
            'INSERT INTO chapters ' +
              '(story_id, volume_id, chapter_order, title, content, word_count) ' +
              'VALUES ($1, $2, $3, $4, $5, $6)',
            [storyId, volumeId, index + 1, chapter.title, chapter.content, wordCount],
          );
        }
      }
      await client.query(
        'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
          "VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
        [storyId, user.id, JSON.stringify({ fields: ['chapters', 'volumeTitle'] })],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return response.status(200).json({ storyId, chapterCount: parsed.data.chapters.length });
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally {
      client.release();
    }
  });

  router.put('/author/stories/:storyId/structure', async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      return jsonError(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    }
    const storyId = request.params.storyId;
    const parsed = epubStructureSchema.safeParse(request.body);
    if (!isValidStoryId(storyId) || !parsed.success
      || parsed.data.volumes.reduce((count, volume) => count + volume.chapters.length, 0) > 5000) {
      return jsonError(response, 400, 'INVALID_REQUEST', 'Mục lục EPUB chưa hợp lệ.');
    }

    const volumeIds = parsed.data.volumes.map((volume) => volume.id);
    const chapterIds = parsed.data.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.id));
    if (volumeIds.some((id) => !isValidStoryId(id)) || chapterIds.some((id) => !isValidStoryId(id))
      || new Set(volumeIds).size !== volumeIds.length || new Set(chapterIds).size !== chapterIds.length) {
      return jsonError(response, 400, 'INVALID_REQUEST', 'Mục lục không được lặp tập hoặc chương.');
    }

    const client = await database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const ownershipValues: unknown[] = [storyId];
      let ownershipFilter = '';
      if (user.role !== 'admin') {
        ownershipValues.push(user.id);
        ownershipFilter = 'AND submitted_by = $2';
      }
      const editable = await client.query<{ id: string }>(
        "SELECT id::text AS id FROM stories WHERE id = $1 AND source = 'epub' " +
          (user.role === 'admin' ? "AND moderation_status NOT IN ('ai_review_pending', 'admin_review_pending') " : "AND moderation_status IN ('draft', 'changes_requested') ") + ownershipFilter + ' FOR UPDATE',
        ownershipValues,
      );
      if (!editable.rows[0]) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return jsonError(response, 404, 'DRAFT_NOT_EDITABLE', 'Không tìm thấy bản thảo EPUB có thể sửa.');
      }

      const currentVolumes = await client.query<{ id: string }>(
        'SELECT id::text AS id FROM volumes WHERE story_id = $1 ORDER BY volume_order ASC FOR UPDATE',
        [storyId],
      );
      const currentChapters = await client.query<{ id: string }>(
        'SELECT id::text AS id FROM chapters WHERE story_id = $1 ORDER BY chapter_order ASC FOR UPDATE',
        [storyId],
      );
      const sameIds = (submitted: string[], current: string[]) =>
        submitted.length === current.length && submitted.every((id) => current.includes(id));
      if (!sameIds(volumeIds, currentVolumes.rows.map((volume) => volume.id))
        || !sameIds(chapterIds, currentChapters.rows.map((chapter) => chapter.id))) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return jsonError(response, 400, 'INVALID_STRUCTURE', 'Tập hoặc chương đã thay đổi; hãy tải lại bản nháp.');
      }

      // Move current positions out of the submitted range before applying the new order.
      await client.query(
        'UPDATE volumes SET volume_order = volume_order + $2 WHERE story_id = $1',
        [storyId, currentVolumes.rows.length + 1],
      );
      await client.query(
        'UPDATE chapters SET chapter_order = chapter_order + $2 WHERE story_id = $1',
        [storyId, currentChapters.rows.length + 1],
      );
      let chapterOrder = 0;
      for (const [volumeIndex, volume] of parsed.data.volumes.entries()) {
        await client.query(
          'UPDATE volumes SET volume_order = $2, title = $3 WHERE id = $1 AND story_id = $4',
          [volume.id, volumeIndex + 1, volume.title, storyId],
        );
        for (const chapter of volume.chapters) {
          chapterOrder += 1;
          await client.query(
            'UPDATE chapters SET volume_id = $2, chapter_order = $3, title = $4 ' +
              'WHERE id = $1 AND story_id = $5',
            [chapter.id, volume.id, chapterOrder, chapter.title, storyId],
          );
        }
      }
      await client.query(
        'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
          "VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
        [storyId, user.id, JSON.stringify({ fields: ['volumeTitles', 'chapterTitles', 'chapterOrder'] })],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return response.status(200).json({
        storyId,
        volumeCount: parsed.data.volumes.length,
        chapterCount: chapterOrder,
      });
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      return next(error);
    } finally {
      client.release();
    }
  });

  router.post('/author/stories/:storyId/cover', coverUploadLimiter, async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      return jsonError(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    }
    const storyId = request.params.storyId;
    if (!isValidStoryId(storyId)) {
      return jsonError(response, 404, 'NOT_FOUND', 'Không tìm thấy bản nháp.');
    }

    const ownershipValues: unknown[] = [storyId];
    const ownershipFilter = user.role === 'admin' ? '' : 'AND submitted_by = $2';
    if (user.role !== 'admin') ownershipValues.push(user.id);
    const editable = await database.query<{ id: string }>(
      "SELECT id::text AS id FROM stories WHERE id = $1 " +
        ownershipFilter +
        (user.role === 'admin' ? " AND moderation_status NOT IN ('ai_review_pending', 'admin_review_pending')" : " AND moderation_status IN ('draft', 'changes_requested')"),
      ownershipValues,
    );
    if (!editable.rows[0]) {
      return jsonError(response, 404, 'NOT_FOUND', 'Không tìm thấy bản nháp có thể sửa.');
    }

    let staged: { path: string; directory: string; mimeType: string };
    try {
      staged = await stageSingleUpload(request, {
        fieldName: 'file',
        maxBytes: 10 * 1024 * 1024,
        extensions: ['.jpg', '.jpeg', '.png', '.webp'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        signatureBytes: 12,
        verifySignature: validImageSignature,
      });
    } catch (error) {
      if (error instanceof StagedUploadError) {
        return jsonError(
          response,
          error.status,
          error.code,
          error.code === 'FILE_TOO_LARGE'
            ? 'Ảnh bìa vượt quá giới hạn 10 MiB.'
            : 'Tệp ảnh không hợp lệ hoặc không được hỗ trợ.',
        );
      }
      return next(error);
    }

    let storedKey: string | null = null;
    try {
      const stored = await storage.put(createReadStream(staged.path), 10 * 1024 * 1024);
      storedKey = stored.key;
      const client = await database.connect();
      let transactionStarted = false;
      try {
        await client.query('BEGIN');
        transactionStarted = true;
        const locked = await client.query<{ id: string }>(
          "SELECT id::text AS id FROM stories WHERE id = $1 " +
            ownershipFilter +
            (user.role === 'admin' ? " AND moderation_status NOT IN ('ai_review_pending', 'admin_review_pending') FOR UPDATE" : " AND moderation_status IN ('draft', 'changes_requested') FOR UPDATE"),
          ownershipValues,
        );
        if (!locked.rows[0]) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return jsonError(response, 404, 'NOT_FOUND', 'Bản nháp đã thay đổi hoặc không còn quyền sửa.');
        }
        const asset = await client.query<{ id: string }>(
          "INSERT INTO media_assets " +
            "(story_id, owner_id, storage_key, media_kind, mime_type, byte_size, sha256) " +
            "VALUES ($1, $2, $3, 'cover', $4, $5, $6) RETURNING id::text AS id",
          [storyId, user.id, stored.key, staged.mimeType, stored.byteSize, stored.sha256],
        );
        const mediaId = asset.rows[0]?.id;
        if (!mediaId) throw new Error('Cover asset insert failed.');
        const coverUrl = '/api/v1/media/' + mediaId;
        await client.query(
          'UPDATE stories SET cover_media_id = $2, cover_url = $3 WHERE id = $1',
          [storyId, mediaId, coverUrl],
        );
        await client.query(
          'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
            "VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
          [storyId, user.id, JSON.stringify({ fields: ['coverMediaId'] })],
        );
        await client.query('COMMIT');
        transactionStarted = false;
        return response.status(201).json({
          storyId,
          coverMediaId: mediaId,
          coverUrl,
        });
      } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (storedKey) await storage.delete(storedKey).catch(() => undefined);
      return next(error);
    } finally {
      await rm(staged.directory, { recursive: true, force: true });
    }
  });
  router.route(['/author/stories/:storyId', '/author/stories/:storyId/metadata']).all((request, _response, next) => {
    if (request.method === 'PATCH' || (request.method === 'POST' && request.path.endsWith('/metadata'))) return next();
    return next('route');
  }).all( async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      return jsonError(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    }
    const storyId = request.params.storyId;
    const parsed = metadataSchema.safeParse(request.body);
    if (!isValidStoryId(storyId) || !parsed.success) {
      return jsonError(response, 400, 'INVALID_REQUEST', 'Thông tin truyện chưa hợp lệ.');
    }

    const client = await database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const ownershipValues: unknown[] = [storyId];
      let ownershipFilter = '';
      if (user.role !== 'admin') {
        ownershipValues.push(user.id);
        ownershipFilter = 'AND submitted_by = $2';
      }
      const editable = await client.query<{ id: string }>(
        "SELECT id::text AS id FROM stories WHERE id = $1 " +
          ownershipFilter +
          (user.role === 'admin' ? " AND moderation_status NOT IN ('ai_review_pending', 'admin_review_pending') FOR UPDATE" : " AND moderation_status IN ('draft', 'changes_requested') FOR UPDATE"),
        ownershipValues,
      );
      if (!editable.rows[0]) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return jsonError(response, 404, 'NOT_FOUND', 'Không tìm thấy bản nháp có thể sửa.');
      }

      let coverUrl: string | null | undefined;
      if (parsed.data.coverMediaId !== undefined) {
        if (parsed.data.coverMediaId === null) {
          coverUrl = null;
        } else {
          const cover = await client.query<{ id: string }>(
            "SELECT id::text AS id FROM media_assets " +
              "WHERE id = $1 AND story_id = $2 AND media_kind IN ('cover', 'image')",
            [parsed.data.coverMediaId, storyId],
          );
          if (!cover.rows[0]) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return jsonError(response, 400, 'INVALID_COVER', 'Ảnh bìa không thuộc bản nháp này.');
          }
          coverUrl = '/api/v1/media/' + parsed.data.coverMediaId;
        }
      }

      if (parsed.data.genreIds) {
        const genres = await client.query<{ id: string }>(
          'SELECT id::text AS id FROM genres WHERE id = ANY($1::bigint[])',
          [parsed.data.genreIds],
        );
        if (genres.rows.length !== parsed.data.genreIds.length) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return jsonError(response, 400, 'INVALID_GENRE', 'Có thể loại không hợp lệ.');
        }
      }


      await client.query(
        'UPDATE stories SET ' +
          'title = COALESCE($2, title), author = COALESCE($3, author), ' +
          'summary = COALESCE($4, summary), language = COALESCE($5, language), ' +
          'cover_media_id = CASE WHEN $6::boolean THEN $7::uuid ELSE cover_media_id END, ' +
          'cover_url = CASE WHEN $6::boolean THEN $8::text ELSE cover_url END, ' +
          'publication_date = CASE WHEN $9::boolean THEN $10::date ELSE publication_date END ' +
          'WHERE id = $1',
        [
          storyId,
          parsed.data.title ?? null,
          parsed.data.author ?? null,
          parsed.data.summary ?? null,
          parsed.data.language ?? null,
          parsed.data.coverMediaId !== undefined,
          parsed.data.coverMediaId ?? null,
          coverUrl ?? null,
          parsed.data.publicationDate !== undefined,
          parsed.data.publicationDate ?? null,
        ],
      );
      if (parsed.data.genreIds) {
        await client.query('DELETE FROM story_genres WHERE story_id = $1', [storyId]);
        for (const genreId of parsed.data.genreIds) {
          await client.query(
            'INSERT INTO story_genres (story_id, genre_id) VALUES ($1, $2)',
            [storyId, genreId],
          );
        }
      }
      await client.query(
        'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
          "VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
        [
          storyId,
          user.id,
          JSON.stringify({ fields: Object.keys(parsed.data) }),
        ],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      const updated = await client.query(
        'SELECT id::text AS id, title, author, summary, language, ' +
          'moderation_status AS "moderationStatus", cover_url AS "coverUrl", ' +
          'publication_date AS "publicationDate" ' +
          'FROM stories WHERE id = $1',
        [storyId],
      );
      return response.status(200).json({ story: updated.rows[0] });
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      return next(error);
    } finally {
      client.release();
    }
  });

  router.post('/author/stories/:storyId/repair-media', async (request, response, next) => {
    const user = await requireContributor(request, response, database);
    if (!user) return;
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return jsonError(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
    const storyId = request.params.storyId;
    if (!isValidStoryId(storyId)) return jsonError(response, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
    try {
      return response.json(await repairEpubMedia({ storyId, requestedBy: user.id, administrator: user.role === 'admin', database, storage }));
    } catch (error) { return next(error); }
  });
  return router;
}

export const authorStoriesRouter = createAuthorStoriesRouter();






