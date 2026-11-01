import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env.js';

import { pool } from '../db/pool.js';
import {
  extractReferencedMedia,
  MAX_IMPORTED_IMAGE_BYTES,
  parseEpub,
} from '../epub/epub-parser.js';
import type { ParsedEpub, ParsedReaderBlock } from '../epub/epub-types.js';
import type { MediaStorage, StoredMediaObject } from '../media/media-storage.js';
import { LocalMediaStorage } from '../media/local-media-storage.js';

const MAX_EPUB_BYTES = 100 * 1024 * 1024;

interface ImportedStory {
  story: {
    id: string;
    title: string;
    author: string;
    summary: string;
    language: string;
    moderationStatus: 'draft';
    coverUrl: string | null;
  };
  preview: {
    volumes: Array<{
      id: string;
      title: string;
      order: number;
      chapters: Array<{
        id: string;
        title: string;
        order: number;
        wordCount: number;
        blocks: Array<Record<string, unknown>>;
      }>;
    }>;
  };
  warnings: string[];
}

interface QueryResult<Row> {
  rows: Row[];
}

interface TransactionClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  release(): void;
}

interface ImportDatabase {
  connect(): Promise<TransactionClient>;
}

interface StoredImage extends StoredMediaObject {
  mediaId: string;
  mimeType: string;
}

function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function genreKey(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function assertValidMetadata(parsed: ParsedEpub): void {
  if (parsed.metadata.title.trim().length < 1 || parsed.metadata.title.length > 500) {
    throw new StoryImportError('EPUB_METADATA_INVALID');
  }
  if (parsed.metadata.creator.length > 500) {
    throw new StoryImportError('EPUB_METADATA_INVALID');
  }
  if (parsed.metadata.language.trim().length < 2 || parsed.metadata.language.length > 35) {
    throw new StoryImportError('EPUB_METADATA_INVALID');
  }
  for (const volume of parsed.volumes) {
    if (volume.title.trim().length < 1 || volume.title.length > 500) {
      throw new StoryImportError('EPUB_METADATA_INVALID');
    }
    for (const chapter of volume.chapters) {
      if (chapter.title.trim().length < 1 || chapter.title.length > 500) {
        throw new StoryImportError('EPUB_METADATA_INVALID');
      }
    }
  }
}

function referencedImagePaths(parsed: ParsedEpub): string[] {
  const paths = new Set<string>();
  if (parsed.coverPath) paths.add(parsed.coverPath);
  for (const volume of parsed.volumes) {
    for (const chapter of volume.chapters) {
      for (const block of chapter.blocks) {
        if (block.type === 'image') paths.add(block.archivePath);
      }
    }
  }
  return [...paths];
}

export class StoryImportError extends Error {
  constructor(public readonly code: 'EPUB_METADATA_INVALID' | 'EPUB_IMPORT_FAILED') {
    super(code);
    this.name = 'StoryImportError';
  }
}

export async function importEpubDraft(input: {
  epubPath: string;
  ownerId: string;
  database?: ImportDatabase;
  storage?: MediaStorage;
  parse?: (path: string) => Promise<ParsedEpub>;
  extract?: typeof extractReferencedMedia;
}): Promise<ImportedStory> {
  const database = (input.database ?? pool) as unknown as ImportDatabase;
  const storage = input.storage ?? new LocalMediaStorage();
  const parse = input.parse ?? parseEpub;
  const extract = input.extract ?? extractReferencedMedia;
  const parsed: ParsedEpub = await parse(input.epubPath);
  assertValidMetadata(parsed);

  const storedKeys: string[] = [];
  const storedByPath = new Map<string, StoredImage>();
  let correctedImageTypes = 0;


  try {
    const paths = referencedImagePaths(parsed);
    const extracted = await extract(
      input.epubPath,
      paths,
      storage,
      MAX_IMPORTED_IMAGE_BYTES,
      parsed.mediaTypes,
    );
    for (const [archivePath, stored] of extracted) {
      const declaredMimeType = parsed.mediaTypes[archivePath];
      const mimeType = stored.mimeType ?? declaredMimeType;
      if (!mimeType) {
        await Promise.all([...extracted.values()].map((image) => storage.delete(image.key)));
        throw new StoryImportError('EPUB_IMPORT_FAILED');
      }
      if (declaredMimeType !== mimeType) correctedImageTypes++;
      storedKeys.push(stored.key);
      storedByPath.set(archivePath, { ...stored, mediaId: '', mimeType });
    }

    const original = await storage.put(
      createReadStream(input.epubPath),
      MAX_EPUB_BYTES,
    );
    storedKeys.push(original.key);

    const client = await database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const publicationDate = parsed.metadata.publicationDate ?? localDateString();
      const storyResult = await client.query<{ id: string }>(
        'INSERT INTO stories ' +
          '(owner_id, title, author, summary, source, visibility, ' +
          'moderation_status, submitted_by, ai_review_status, language, publication_date) ' +
          "VALUES ($1, $2, $3, $4, 'epub', 'private', 'draft', $1, 'not_started', $5, $6) " +
          'RETURNING id::text AS id',
        [
          input.ownerId,
          parsed.metadata.title.trim(),
          parsed.metadata.creator.trim(),
          parsed.metadata.description.trim(),
          parsed.metadata.language.trim(),
          publicationDate,
        ],
      );
      const storyId = storyResult.rows[0]?.id;
      if (!storyId) {
        throw new StoryImportError('EPUB_IMPORT_FAILED');
      }

      const genreRows = await client.query<{ id: string; name: string; slug: string }>(
        'SELECT id::text AS id, name, slug FROM genres',
      );
      const genreBySlug = new Map(genreRows.rows.map((genre) => [genreKey(genre.slug), genre]));
      const genreByName = new Map(genreRows.rows.map((genre) => [genreKey(genre.name), genre]));
      const matchedGenres = new Map<string, string>();
      const importWarnings = [...parsed.warnings];
      if (correctedImageTypes > 0) {
        importWarnings.push(`Đã nhận diện lại định dạng thực tế của ${correctedImageTypes} ảnh trong EPUB.`);
      }
      for (const genre of parsed.metadata.genres) {
        const match = (genre.slug ? genreBySlug.get(genreKey(genre.slug)) : undefined)
          ?? genreByName.get(genreKey(genre.name));
        if (match) {
          matchedGenres.set(match.id, match.id);
        } else {
          importWarnings.push(`Không tìm thấy thể loại “${genre.name}” trong danh mục ReadLite.`);
        }
      }
      for (const genreId of matchedGenres.values()) {
        await client.query(
          'INSERT INTO story_genres (story_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [storyId, genreId],
        );
      }

      const epubAsset = await client.query<{ id: string }>(
        'INSERT INTO media_assets ' +
          '(story_id, owner_id, storage_key, media_kind, mime_type, byte_size, sha256) ' +
          "VALUES ($1, $2, $3, 'epub', 'application/epub+zip', $4, $5) " +
          'RETURNING id::text AS id',
        [storyId, input.ownerId, original.key, original.byteSize, original.sha256],
      );
      if (!epubAsset.rows[0]) {
        throw new StoryImportError('EPUB_IMPORT_FAILED');
      }

      for (const [archivePath, stored] of storedByPath) {
        const kind = archivePath === parsed.coverPath ? 'cover' : 'image';
        const asset = await client.query<{ id: string }>(
          'INSERT INTO media_assets ' +
            '(story_id, owner_id, storage_key, media_kind, mime_type, byte_size, sha256) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7) ' +
            'RETURNING id::text AS id',
          [
            storyId,
            input.ownerId,
            stored.key,
            kind,
            stored.mimeType,
            stored.byteSize,
            stored.sha256,
          ],
        );
        const mediaId = asset.rows[0]?.id;
        if (!mediaId) {
          throw new StoryImportError('EPUB_IMPORT_FAILED');
        }
        stored.mediaId = mediaId;
      }

      const coverMediaId = parsed.coverPath
        ? storedByPath.get(parsed.coverPath)?.mediaId ?? null
        : null;
      const coverUrl = coverMediaId
        ? '/api/v1/media/' + coverMediaId
        : null;
      if (coverMediaId) {
        await client.query(
          'UPDATE stories SET cover_media_id = $2, cover_url = $3 WHERE id = $1',
          [storyId, coverMediaId, coverUrl],
        );
      }

      const previewVolumes: ImportedStory['preview']['volumes'] = [];
      for (const volume of parsed.volumes) {
        const volumeResult = await client.query<{ id: string }>(
          'INSERT INTO volumes (story_id, volume_order, title) ' +
            'VALUES ($1, $2, $3) RETURNING id::text AS id',
          [storyId, volume.order, volume.title.trim()],
        );
        const volumeId = volumeResult.rows[0]?.id;
        if (!volumeId) {
          throw new StoryImportError('EPUB_IMPORT_FAILED');
        }

        const previewChapters: ImportedStory['preview']['volumes'][number]['chapters'] = [];
        for (const chapter of volume.chapters) {
          const blocks = chapter.blocks.map((block) =>
            toStoredBlock(block, storedByPath),
          );
          const chapterResult = await client.query<{ id: string }>(
            'INSERT INTO chapters ' +
              '(story_id, volume_id, chapter_order, title, content, content_blocks, word_count) ' +
              'VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ' +
              'RETURNING id::text AS id',
            [
              storyId,
              volumeId,
              chapter.order,
              chapter.title.trim(),
              chapter.content,
              JSON.stringify(blocks),
              chapter.wordCount,
            ],
          );
          const chapterId = chapterResult.rows[0]?.id;
          if (!chapterId) {
            throw new StoryImportError('EPUB_IMPORT_FAILED');
          }
          previewChapters.push({
            id: chapterId,
            title: chapter.title,
            order: chapter.order,
            wordCount: chapter.wordCount,
            blocks: blocks.map((block) =>
              block.type === 'image'
                ? {
                    ...block,
                    url: '/api/v1/media/' + block.mediaId,
                  }
                : block,
            ),
          });
        }
        previewVolumes.push({
          id: volumeId,
          title: volume.title,
          order: volume.order,
          chapters: previewChapters,
        });
      }

      await client.query(
        'INSERT INTO story_review_events (story_id, actor_id, action, details) ' +
          "VALUES ($1, $2, 'draft_created', $3::jsonb)",
        [
          storyId,
          input.ownerId,
          JSON.stringify({
            source: 'epub',
            volumeCount: parsed.volumes.length,
            chapterCount: parsed.volumes.reduce(
              (count, volume) => count + volume.chapters.length,
              0,
            ),
            warnings: importWarnings,
          }),
        ],
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return {
        story: {
          id: storyId,
          title: parsed.metadata.title,
          author: parsed.metadata.creator,
          summary: parsed.metadata.description,
          language: parsed.metadata.language,
          moderationStatus: 'draft',
          coverUrl,
        },
        preview: { volumes: previewVolumes },
        warnings: importWarnings,
      };
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
     throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (storedKeys.length > 0) {
      await Promise.all(storedKeys.map((key) => storage.delete(key)));
    }
    if (
      error instanceof StoryImportError ||
      error instanceof Error && 'code' in error
    ) {
      throw error;
    }
    throw new StoryImportError('EPUB_IMPORT_FAILED');
  }
}

function toStoredBlock(
  block: ParsedReaderBlock,
  storedByPath: Map<string, StoredImage>,
): Record<string, unknown> {
  if (block.type === 'text') {
    return block;
  }
  const stored = storedByPath.get(block.archivePath);
  if (!stored?.mediaId) {
    throw new StoryImportError('EPUB_IMPORT_FAILED');
  }
  return {
    type: 'image',
    mediaId: stored.mediaId,
    altText: block.altText,
    caption: block.caption,
  };
}






/** Repair existing imports without creating another story or replacing edited text/chapter IDs. */
export async function repairEpubMedia(input: {
  storyId: string; requestedBy: string; administrator: boolean;
  database: ImportDatabase; storage: MediaStorage;
  parse?: (path: string) => Promise<ParsedEpub>;
  extract?: typeof extractReferencedMedia;
}): Promise<{ restoredChapters: number; coverRestored: boolean }> {
  const client = await input.database.connect();
  const newKeys: string[] = [];
  let directory: string | null = null;
  let committed = false;
  try {
    await client.query('BEGIN');
    const story = (await client.query<{ ownerId: string; coverMediaId: string | null }>(
      'SELECT owner_id::text AS "ownerId", cover_media_id::text AS "coverMediaId" FROM stories ' +
      "WHERE id = $1 AND source = 'epub' AND (submitted_by = $2 OR $3::boolean) " +
      "AND moderation_status NOT IN ('ai_review_pending', 'admin_review_pending') FOR UPDATE",
      [input.storyId, input.requestedBy, input.administrator],
    )).rows[0];
    if (!story) throw new StoryImportError('EPUB_IMPORT_FAILED');
    const original = (await client.query<{ storageKey: string }>(
      "SELECT storage_key AS \"storageKey\" FROM media_assets WHERE story_id = $1 AND media_kind = 'epub' AND content_update_id IS NULL ORDER BY created_at LIMIT 1",
      [input.storyId],
    )).rows[0];
    if (!original) throw new StoryImportError('EPUB_IMPORT_FAILED');
    const stagingRoot = resolve(env.mediaDirectory, '.staging');
    await mkdir(stagingRoot, { recursive: true });
    directory = await mkdtemp(join(stagingRoot, 'repair-'));
    const path = join(directory, 'original.epub');
    await pipeline(input.storage.createReadStream(original.storageKey), createWriteStream(path));
    const parsed = await (input.parse ?? parseEpub)(path);
    const extracted = await (input.extract ?? extractReferencedMedia)(path, referencedImagePaths(parsed), input.storage, MAX_IMPORTED_IMAGE_BYTES, parsed.mediaTypes);
    newKeys.push(...[...extracted.values()].map((asset) => asset.key));
    const media = new Map<string, StoredImage>();
    for (const [archivePath, asset] of extracted) {
      const existing = (await client.query<{ id: string }>(
        "SELECT id::text AS id FROM media_assets WHERE story_id = $1 AND sha256 = $2 AND content_update_id IS NULL AND media_kind IN ('image', 'cover') LIMIT 1",
        [input.storyId, asset.sha256],
      )).rows[0];
      let mediaId = existing?.id;
      const mimeType = asset.mimeType ?? parsed.mediaTypes[archivePath];
      if (!mimeType) throw new StoryImportError('EPUB_IMPORT_FAILED');
      if (mediaId) {
        await input.storage.delete(asset.key);
        newKeys.splice(newKeys.indexOf(asset.key), 1);
      } else {
        mediaId = (await client.query<{ id: string }>(
          'INSERT INTO media_assets (story_id, owner_id, storage_key, media_kind, mime_type, byte_size, sha256) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id',
          [input.storyId, story.ownerId, asset.key, archivePath === parsed.coverPath ? 'cover' : 'image', mimeType, asset.byteSize, asset.sha256],
        )).rows[0]?.id;
      }
      if (!mediaId) throw new StoryImportError('EPUB_IMPORT_FAILED');
      media.set(archivePath, { ...asset, mediaId, mimeType });
    }
    const coverId = parsed.coverPath ? media.get(parsed.coverPath)?.mediaId : null;
    const coverRestored = Boolean(!story.coverMediaId && coverId);
    if (coverRestored) await client.query('UPDATE stories SET cover_media_id = $2, cover_url = $3 WHERE id = $1',
      [input.storyId, coverId, '/api/v1/media/' + coverId]);
    const chapters = (await client.query<{ id: string; content: string; blocks: unknown[] }>(
      'SELECT id::text AS id, content, content_blocks AS blocks FROM chapters WHERE story_id = $1 FOR UPDATE', [input.storyId],
    )).rows;
    let restoredChapters = 0;
    for (const chapter of chapters) {
      const source = parsed.volumes.flatMap((volume) => volume.chapters).find((item) => item.content.trim() === chapter.content.trim());
      if (!source) continue;
      const imageCount = source.blocks.filter((block) => block.type === 'image').length;
      const currentImages = (chapter.blocks ?? []).filter((block) => block && typeof block === 'object' && 'type' in block && block.type === 'image').length;
      if (imageCount <= currentImages) continue;
      await client.query('UPDATE chapters SET content_blocks = $2::jsonb WHERE id = $1',
        [chapter.id, JSON.stringify(source.blocks.map((block) => toStoredBlock(block, media)))]);
      restoredChapters++;
    }
    await client.query("INSERT INTO story_review_events (story_id, actor_id, action, details) VALUES ($1, $2, 'metadata_updated', $3::jsonb)",
      [input.storyId, input.requestedBy, JSON.stringify({ action: 'repair_epub_media', restoredChapters, coverRestored })]);
    await client.query('COMMIT'); committed = true;
    return { restoredChapters, coverRestored };
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => undefined);
      await Promise.allSettled(newKeys.map((key) => input.storage.delete(key)));
    }
    throw error;
  } finally {
    client.release();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
