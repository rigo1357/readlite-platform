import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createAuthorStoriesRouter } from '../dist/routes/author-stories.js';

const servers = [];
const authorId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'test-csrf-token-value-long-enough-32';

async function startServer(application) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = application.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Không lấy được cổng kiểm thử API.');
  }
  servers.push(server);
  return 'http://127.0.0.1:' + address.port;
}

async function cookie() {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(authorId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return 'readlite_access=' + accessToken + '; readlite_csrf=' + csrf;
}

function appFor(database, storage) {
  const application = express();
  application.use(express.json());
  application.use(cookieParser());
  application.use('/api/v1', createAuthorStoriesRouter(database, storage));
  return application;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

test('author story list is filtered to current submitter and a known status', async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      return { rows: [{ id: '77', title: 'Bản nháp', moderationStatus: 'draft' }] };
    },
    async connect() { throw new Error('Not used.'); },
  };
  const origin = await startServer(appFor(database));
  const response = await fetch(origin + '/api/v1/author/stories?status=draft', {
    headers: { cookie: await cookie() },
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).stories[0].id, '77');
  assert.match(calls[1].sql, /submitted_by = \$1/);
  assert.match(calls[1].sql, /moderation_status = 'draft'/);
});

test('author draft preview maps stored image blocks to internal media URLs', async () => {
  let queryIndex = 0;
  const database = {
    async query(sql) {
      queryIndex += 1;
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      if (sql.includes('FROM stories')) {
        return { rows: [{ id: '77', title: 'Bản nháp', moderationStatus: 'draft' }] };
      }
      if (sql.includes('FROM volumes')) {
        return { rows: [{ id: '5', title: 'Tập 1', order: 1 }] };
      }
      return { rows: [{
        id: '9',
        title: 'Chương một',
        order: 1,
        content: 'Mở đầu',
        contentBlocks: [{ type: 'image', mediaId: '42abbdac-0bf3-4265-a183-b53f75475ad8', altText: 'Bản đồ' }],
        wordCount: 2,
      }] };
    },
    async connect() { throw new Error('Not used.'); },
  };
  const origin = await startServer(appFor(database));
  const response = await fetch(origin + '/api/v1/author/stories/77', {
    headers: { cookie: await cookie() },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.preview.volumes[0].chapters[0].blocks[0].url,
    '/api/v1/media/42abbdac-0bf3-4265-a183-b53f75475ad8');
  assert.ok(queryIndex >= 4);
});

test('author uploads a raster cover to a private draft with CSRF and size/type checks', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      if (sql.includes('FROM stories')) return { rows: [{ id: '77' }] };
      throw new Error('Unexpected pool query: ' + sql);
    },
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('SELECT id::text AS id FROM stories')) return { rows: [{ id: '77' }] };
          if (sql.includes('INSERT INTO media_assets')) return { rows: [{ id: '42abbdac-0bf3-4265-a183-b53f75475ad8' }] };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const uploaded = [];
  const deleted = [];
  const storage = {
    async put(source) {
      const chunks = [];
      for await (const chunk of source) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      uploaded.push(bytes);
      return {
        key: '9e4bb8a1-1075-4aa8-9f0c-d1aabc8d06a2.blob',
        byteSize: bytes.length,
        sha256: 'a'.repeat(64),
      };
    },
    createReadStream() { throw new Error('Not used.'); },
    async delete(key) { deleted.push(key); },
  };
  const origin = await startServer(appFor(database, storage));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const form = new FormData();
  form.append('file', new Blob([signature], { type: 'image/png' }), 'cover.png');
  const response = await fetch(origin + '/api/v1/author/stories/77/cover', {
    method: 'POST',
    headers: {
      cookie: await cookie(),
      'x-csrf-token': csrf,
    },
    body: form,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.coverUrl, '/api/v1/media/42abbdac-0bf3-4265-a183-b53f75475ad8');
  assert.equal(uploaded[0].length, 12);
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.deepEqual(deleted, []);
});

test('cover upload rejects mismatched image signatures before media storage', async () => {
  let storageWrites = 0;
  const database = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      if (sql.includes('FROM stories')) return { rows: [{ id: '77' }] };
      return { rows: [] };
    },
    async connect() { throw new Error('Invalid image must not reach PostgreSQL.'); },
  };
  const storage = {
    async put() { storageWrites += 1; throw new Error('Bad image must not be stored.'); },
    createReadStream() { throw new Error('Not used.'); },
    async delete() {},
  };
  const origin = await startServer(appFor(database, storage));
  const form = new FormData();
  form.append('file', new Blob(['not image data'], { type: 'image/png' }), 'cover.png');
  const response = await fetch(origin + '/api/v1/author/stories/77/cover', {
    method: 'POST',
    headers: {
      cookie: await cookie(),
      'x-csrf-token': csrf,
    },
    body: form,
  });

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, 'UNSUPPORTED_FILE_TYPE');
  assert.equal(storageWrites, 0);
});
test('metadata updates require CSRF and update only drafts inside a transaction', async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      throw new Error('Unexpected pool query.');
    },
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('SELECT id::text AS id FROM stories')) return { rows: [{ id: '77' }] };
          if (sql.includes('SELECT id::text AS id FROM genres')) return { rows: [{ id: '2' }] };
          if (sql.includes('SELECT id::text AS id, title, author')) {
            return { rows: [{ id: '77', title: 'Tên sửa', moderationStatus: 'draft' }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const origin = await startServer(appFor(database));
  const withoutCsrf = await fetch(origin + '/api/v1/author/stories/77', {
    method: 'PATCH',
    headers: { cookie: await cookie(), 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Tên sửa' }),
  });
  assert.equal(withoutCsrf.status, 403);

  const updated = await fetch(origin + '/api/v1/author/stories/77', {
    method: 'PATCH',
    headers: {
      cookie: await cookie(),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title: 'Tên sửa', genreIds: ['2'] }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).story.title, 'Tên sửa');
  const begin = calls.findIndex((call) => call.sql === 'BEGIN');
  const lock = calls.findIndex((call) => call.sql.includes('FOR UPDATE'));
  const commit = calls.findIndex((call) => call.sql === 'COMMIT');
  assert.ok(begin >= 0 && begin < lock && lock < commit);
  assert.ok(calls.some((call) => call.sql.includes("action, details") && call.sql.includes('metadata_updated')));
});

