import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { importEpubDraft, repairEpubMedia } from '../src/services/story-import-service.ts';

const roots = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function createEpubFile() {
  const root = await mkdtemp(join(tmpdir(), 'readlite-story-import-test-'));
  roots.push(root);
  const path = join(root, 'sample.epub');
  await writeFile(path, 'epub fixture');
  return path;
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

test('imports EPUB description, matched genres and today when its publication date is missing', async () => {
  const queries = [];
  const client = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text.startsWith('INSERT INTO stories')) return { rows: [{ id: '42' }] };
      if (text.startsWith('SELECT id::text AS id, name, slug FROM genres')) {
        return { rows: [
          { id: '5', name: 'Fantasy – Kỳ ảo', slug: 'fantasy' },
          { id: '9', name: 'Tình cảm', slug: 'romance' },
        ] };
      }
      if (text.startsWith('INSERT INTO media_assets')) return { rows: [{ id: 'media-1' }] };
      if (text.startsWith('INSERT INTO volumes')) return { rows: [{ id: 'volume-1' }] };
      if (text.startsWith('INSERT INTO chapters')) return { rows: [{ id: 'chapter-1' }] };
      return { rows: [] };
    },
    release() {},
  };
  const parsed = {
    metadata: {
      title: 'Đường về nhà', creator: 'Lê An', language: 'vi',
      description: 'Một câu chuyện có dấu.', publicationDate: null,
      genres: [
        { name: 'Fantasy', slug: 'fantasy' },
        { name: 'Romance', slug: 'romance' },
      ],
    },
    coverPath: 'images/cover.jpg',
    mediaTypes: { 'images/cover.jpg': 'image/jpeg' },
    volumes: [{
      title: 'Tập 1', order: 1,
      chapters: [{ title: 'Chương 1', order: 1, sourcePaths: [], blocks: [], content: 'Mở đầu.', wordCount: 1 }],
    }],
    warnings: [],
  };
  const result = await importEpubDraft({
    epubPath: await createEpubFile(),
    ownerId: 'owner-1',
    database: { async connect() { return client; } },
    storage: {
      async put(source) {
        for await (const chunk of source) { assert.ok(chunk.byteLength > 0); }
        return { key: 'epub-key', byteSize: 12, sha256: 'epub-hash' };
      },
      async delete() {},
    },
    parse: async () => parsed,
    extract: async () => new Map([['images/cover.jpg', {
      key: 'cover-key', byteSize: 8, sha256: 'cover-hash', mimeType: 'image/png',
    }]]),
  });

  const storyInsert = queries.find((query) => query.text.startsWith('INSERT INTO stories'));
  assert.equal(storyInsert.values[1], 'Đường về nhà');
  assert.equal(storyInsert.values[2], 'Lê An');
  assert.equal(storyInsert.values[3], 'Một câu chuyện có dấu.');
  assert.equal(storyInsert.values[5], localToday());
  assert.deepEqual(
    queries.filter((query) => query.text.startsWith('INSERT INTO story_genres')).map((query) => query.values),
    [['42', '5'], ['42', '9']],
  );
  assert.equal(result.story.summary, 'Một câu chuyện có dấu.');
  const coverInsert = queries.find((query) => query.text.startsWith('INSERT INTO media_assets') && query.values[3] === 'cover');
  assert.equal(coverInsert.values[4], 'image/png');
  assert.ok(result.warnings.some((warning) => warning.includes('1 ảnh')));
});

test('repairs a missing EPUB cover and chapter image without replacing story or chapter IDs', async () => {
  const queries = [];
  let nextMediaId = 1;
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('FROM stories') && sql.includes('FOR UPDATE')) return { rows: [{ ownerId: 'owner-1', coverMediaId: null }] };
      if (sql.includes("media_kind = 'epub'")) return { rows: [{ storageKey: 'original-epub' }] };
      if (sql.startsWith('SELECT id::text AS id FROM media_assets')) return { rows: [] };
      if (sql.startsWith('INSERT INTO media_assets')) return { rows: [{ id: `media-${nextMediaId++}` }] };
      if (sql.startsWith('SELECT id::text AS id, content, content_blocks')) {
        return { rows: [{ id: 'chapter-1', content: 'ReadLite', blocks: [{ type: 'text', runs: [{ text: 'ReadLite' }] }] }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const parsed = {
    coverPath: 'images/cover.png',
    mediaTypes: { 'images/cover.png': 'image/png', 'images/inside.png': 'image/png' },
    volumes: [{ chapters: [{ content: 'ReadLite', blocks: [
      { type: 'text', runs: [{ text: 'ReadLite' }] },
      { type: 'image', archivePath: 'images/inside.png', altText: 'Map' },
    ] }] }],
  };
  const result = await repairEpubMedia({
    storyId: '42', requestedBy: 'admin-1', administrator: true,
    database: { async connect() { return client; } },
    storage: {
      createReadStream(key) { assert.equal(key, 'original-epub'); return Readable.from([Buffer.from('epub fixture')]); },
      async delete() { assert.fail('New media must be kept after the repair commits.'); },
    },
    parse: async () => parsed,
    extract: async (_path, paths) => {
      assert.deepEqual(paths, ['images/cover.png', 'images/inside.png']);
      return new Map([
        ['images/cover.png', { key: 'new-cover', byteSize: 8, sha256: 'cover-hash' }],
        ['images/inside.png', { key: 'new-image', byteSize: 8, sha256: 'image-hash' }],
      ]);
    },
  });

  assert.deepEqual(result, { restoredChapters: 1, coverRestored: true });
  assert.ok(queries.some(({ sql, values }) => sql.startsWith('UPDATE stories SET cover_media_id') && values[1] === 'media-1'));
  const chapterUpdate = queries.find(({ sql }) => sql.startsWith('UPDATE chapters SET content_blocks'));
  assert.equal(chapterUpdate.values[0], 'chapter-1');
  assert.equal(JSON.parse(chapterUpdate.values[1])[1].mediaId, 'media-2');
  assert.ok(!queries.some(({ sql }) => sql.startsWith('DELETE FROM chapters') || sql.startsWith('INSERT INTO stories')));
});
