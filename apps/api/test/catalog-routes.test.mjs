import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import { createCatalogRouter } from '../src/routes/catalog.ts';

const servers = [];

async function startApp(database) {
  const app = express();
  app.use('/api/v1', createCatalogRouter(database));
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

class CatalogDatabase {
  calls = [];

  constructor(chapterRows = []) {
    this.chapterRows = chapterRows;
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    if (sql.includes('SELECT 1 FROM stories')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM chapters c')) {
      return { rows: [...this.chapterRows].sort((left, right) => left.chapterOrder - right.chapterOrder) };
    }
    if (sql.includes('FROM stories s')) return { rows: [] };
    throw new Error(`Unexpected catalog query: ${sql}`);
  }
}

test('public chapter detail returns safe ordered reader blocks including internal image URLs', async () => {
  const database = new CatalogDatabase([{
    id: '10', storyId: '1', chapterOrder: 2, title: 'Chương 2', content: 'Nội dung cũ',
    contentBlocks: [
      { type: 'text', kind: 'paragraph', runs: [{ text: 'Mở đầu', bold: false, italic: false }] },
      { type: 'image', mediaId: '42abbdac-0bf3-4265-a183-b53f75475ad8', altText: 'Bản đồ', caption: 'Làng' },
    ], wordCount: 200, volumeId: '5', volumeTitle: 'Tập 1', volumeOrder: 1,
  }]);
  const origin = await startApp(database);

  const response = await fetch(`${origin}/api/v1/stories/1/chapters/10`);
  assert.equal(response.status, 200);
  const { chapter } = await response.json();
  assert.equal(chapter.content, 'Nội dung cũ');
  assert.equal(chapter.volumeTitle, 'Tập 1');
  assert.deepEqual(chapter.blocks, [
    { type: 'text', kind: 'paragraph', runs: [{ text: 'Mở đầu', bold: false, italic: false }] },
    {
      type: 'image', mediaId: '42abbdac-0bf3-4265-a183-b53f75475ad8',
      url: '/api/v1/media/42abbdac-0bf3-4265-a183-b53f75475ad8', altText: 'Bản đồ', caption: 'Làng',
    },
  ]);
  assert.match(database.calls[0].sql, /moderation_status = 'published'/);
});

test('chapter contents preserve legacy text, group volumes, and order chapters', async () => {
  const database = new CatalogDatabase([
    { id: '12', storyId: '1', chapterOrder: 2, title: 'Chương 2', content: 'Legacy B', contentBlocks: null, volumeId: '5', volumeTitle: 'Tập 1', volumeOrder: 1 },
    { id: '11', storyId: '1', chapterOrder: 1, title: 'Chương 1', content: 'Legacy A', contentBlocks: null, volumeId: '5', volumeTitle: 'Tập 1', volumeOrder: 1 },
    { id: '13', storyId: '1', chapterOrder: 3, title: 'Chương 3', content: 'Legacy C', contentBlocks: null, volumeId: null, volumeTitle: null, volumeOrder: null },
  ]);
  const origin = await startApp(database);

  const response = await fetch(`${origin}/api/v1/stories/1/chapters`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.chapters.map((chapter) => chapter.id), ['11', '12', '13']);
  assert.deepEqual(payload.chapters.map((chapter) => chapter.content), ['Legacy A', 'Legacy B', 'Legacy C']);
  assert.deepEqual(payload.chapters.map((chapter) => chapter.blocks), [[], [], []]);
  assert.deepEqual(payload.volumes.map((volume) => volume.chapters.map((chapter) => chapter.id)), [['11', '12']]);
  assert.match(database.calls[1].sql, /ORDER BY COALESCE\(v.volume_order, 0\), c.chapter_order ASC/);
});

test('public story detail refuses a draft and queries only published stories', async () => {
  const database = new CatalogDatabase();
  const origin = await startApp(database);

  const response = await fetch(`${origin}/api/v1/stories/99`);
  assert.equal(response.status, 404);
  assert.match(database.calls[0].sql, /moderation_status = 'published'/);
});



