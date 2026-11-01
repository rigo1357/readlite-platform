import { createReadStream } from 'node:fs';
import { extractReferencedMedia, MAX_IMPORTED_IMAGE_BYTES, parseEpub } from '../epub/epub-parser.js';
import type { ParsedEpub } from '../epub/epub-types.js';
import type { MediaStorage } from '../media/media-storage.js';

export interface UpdateQueryable {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}
export interface UpdateDatabase extends UpdateQueryable {
  connect(): Promise<UpdateQueryable & { release(): void }>;
}
export type UpdateChapter = {
  title: string; content: string; volumeOrder: number; volumeTitle: string;
  blocks: unknown[]; wordCount: number;
};
export class ContentUpdateError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function lockPublishedStory(database: Pick<UpdateDatabase, 'query'>, storyId: string, userId: string, admin: boolean) {
  const result = await database.query<{ lifecycleStatus: string }>(
    "SELECT id,lifecycle_status AS \"lifecycleStatus\" FROM stories WHERE id=$1 AND (owner_id=$2 OR submitted_by=$2 OR $3::boolean) " +
    "AND visibility='public' AND moderation_status='published' FOR UPDATE", [storyId, userId, admin]);
  if (!result.rows.length) throw new ContentUpdateError(409, 'STORY_UNAVAILABLE', 'Truyện chưa xuất bản hoặc bạn không có quyền bổ sung chương.');
  if (result.rows[0]!.lifecycleStatus !== 'ongoing') throw new ContentUpdateError(409, 'STORY_NOT_ONGOING', 'Chuyển truyện về Đang ra trước khi bổ sung hoặc duyệt chương mới.');
}

export async function insertUpdateChapters(db: Pick<UpdateDatabase, 'query'>, updateId: string, chapters: UpdateChapter[]) {
  for (const [index, chapter] of chapters.entries()) {
    await db.query('INSERT INTO story_update_chapters (update_id,chapter_order,volume_order,volume_title,title,content,content_blocks,word_count) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
    [updateId, index + 1, chapter.volumeOrder, chapter.volumeTitle, chapter.title, chapter.content, JSON.stringify(chapter.blocks), chapter.wordCount]);
  }
}

export async function importContentUpdate(input: {
  database: UpdateDatabase; storage: MediaStorage; epubPath: string; storyId: string; userId: string; admin: boolean;
  parse?: (path: string) => Promise<ParsedEpub>; extract?: typeof extractReferencedMedia;
}): Promise<string> {
  const parsed = await (input.parse ?? parseEpub)(input.epubPath);
  const chapters = parsed.volumes.flatMap(v => v.chapters);
  if (!chapters.length || chapters.length > 5000 || parsed.volumes.length > 500 ||
    parsed.volumes.some(v => !v.title.trim() || v.title.length > 500) ||
    chapters.some(c => !c.title.trim() || c.title.length > 500)) {
    throw new ContentUpdateError(422, 'INVALID_EPUB', 'Mục lục EPUB không hợp lệ hoặc vượt quá 5.000 chương.');
  }
  const paths = [...new Set(chapters.flatMap(c => c.blocks.flatMap(b => b.type === 'image' ? [b.archivePath] : [])))];
  const storedKeys: string[] = [];
  let client: Awaited<ReturnType<UpdateDatabase['connect']>> | undefined;
  let inTransaction = false;
  try {
    const images = await (input.extract ?? extractReferencedMedia)(input.epubPath, paths, input.storage, MAX_IMPORTED_IMAGE_BYTES, parsed.mediaTypes);
    for (const image of images.values()) storedKeys.push(image.key);
    const original = await input.storage.put(createReadStream(input.epubPath), 100 * 1024 * 1024);
    storedKeys.push(original.key);
    client = await input.database.connect();
    await client.query('BEGIN'); inTransaction = true;
    // Recheck after extraction: hiding/deleting a story or changing its owner cannot bypass this lock.
    await lockPublishedStory(client, input.storyId, input.userId, input.admin);
    const update = await client.query<{ id: string }>(
      "INSERT INTO story_content_updates(story_id,submitted_by,source,title,warnings) VALUES($1,$2,'epub',$3,$4::jsonb) RETURNING id::text",
      [input.storyId, input.userId, parsed.metadata.title.trim().slice(0, 500) || 'Bổ sung từ EPUB', JSON.stringify(parsed.warnings)]);
    const id = update.rows[0]!.id;
    await client.query("INSERT INTO media_assets(story_id,owner_id,storage_key,media_kind,mime_type,byte_size,sha256,content_update_id) VALUES($1,$2,$3,'epub','application/epub+zip',$4,$5,$6)",
      [input.storyId, input.userId, original.key, original.byteSize, original.sha256, id]);
    const mediaIds = new Map<string, string>();
    for (const [path, stored] of images) {
      const mime = stored.mimeType ?? parsed.mediaTypes[path];
      if (!mime) throw new ContentUpdateError(422, 'INVALID_IMAGE', 'Không nhận diện được ảnh EPUB.');
      const asset = await client.query<{ id: string }>(
        "INSERT INTO media_assets(story_id,owner_id,storage_key,media_kind,mime_type,byte_size,sha256,content_update_id) VALUES($1,$2,$3,'image',$4,$5,$6,$7) RETURNING id::text",
        [input.storyId, input.userId, stored.key, mime, stored.byteSize, stored.sha256, id]);
      mediaIds.set(path, asset.rows[0]!.id);
    }
    await insertUpdateChapters(client, id, parsed.volumes.flatMap((volume, index) => volume.chapters.map(chapter => ({
      title: chapter.title.trim(), content: chapter.content, volumeOrder: index + 1,
      volumeTitle: volume.title.trim(), wordCount: chapter.wordCount,
      blocks: chapter.blocks.map(block => {
        if (block.type === 'text') return block;
        const mediaId = mediaIds.get(block.archivePath);
        if (!mediaId) throw new ContentUpdateError(422, 'INVALID_IMAGE', 'Thiếu ảnh minh họa EPUB.');
        return { type: 'image', mediaId, altText: block.altText, caption: block.caption };
      }),
    }))));
    await client.query('COMMIT'); inTransaction = false;
    return id;
  } catch (error) {
    if (inTransaction) await client?.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled(storedKeys.map(key => input.storage.delete(key)));
    throw error;
  } finally { client?.release(); }
}
