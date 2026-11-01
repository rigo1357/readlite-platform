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
const volumeIds = ['10', '11'];
const chapterIds = ['101', '102', '201'];

async function startServer(database) {
  const application = express();
  application.use(express.json());
  application.use(cookieParser());
  application.use('/api/v1', createAuthorStoriesRouter(database));
  const server = await new Promise((resolve, reject) => {
    const listeningServer = application.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  return 'http://127.0.0.1:' + address.port;
}

async function sessionCookie() {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(authorId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return `readlite_access=${token}; readlite_csrf=${csrf}`;
}

function fakeDatabase(calls) {
  return {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql, values });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('SELECT id::text AS id FROM stories')) return { rows: [{ id: '77' }] };
          if (sql.includes('SELECT id::text AS id FROM volumes')) return { rows: volumeIds.map((id) => ({ id })) };
          if (sql.includes('SELECT id::text AS id FROM chapters')) return { rows: chapterIds.map((id) => ({ id })) };
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

after(async () => Promise.all(servers.map((server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}))));

test('updates EPUB volume/chapter titles and order without replacing extracted content', async () => {
  const calls = [];
  const origin = await startServer(fakeDatabase(calls));
  const response = await fetch(origin + '/api/v1/author/stories/77/structure', {
    method: 'PUT',
    headers: {
      cookie: await sessionCookie(),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      volumes: [
        { id: '11', title: 'Tập hai', chapters: [{ id: '201', title: 'Chương B' }] },
        { id: '10', title: 'Tập một', chapters: [{ id: '102', title: 'Chương A' }, { id: '101', title: 'Mở đầu' }] },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { storyId: '77', volumeCount: 2, chapterCount: 3 });
  assert.ok(calls.some(({ sql }) => sql.includes('volume_order = volume_order +')));
  assert.ok(calls.some(({ sql }) => sql.includes('chapter_order = chapter_order +')));
  assert.ok(calls.some(({ sql, values }) => sql.includes('UPDATE volumes') && values.includes('Tập hai')));
  assert.ok(calls.some(({ sql, values }) => sql.includes('UPDATE chapters') && values.includes('Mở đầu')));
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(!calls.some(({ sql }) => sql.includes('DELETE FROM chapters')));
});

test('rejects EPUB structure that omits a chapter or does not include CSRF', async () => {
  const calls = [];
  const origin = await startServer(fakeDatabase(calls));
  const payload = {
    volumes: [
      { id: '10', title: 'Tập một', chapters: [{ id: '101', title: 'Chương một' }] },
      { id: '11', title: 'Tập hai', chapters: [{ id: '201', title: 'Chương hai' }] },
    ],
  };
  const noCsrf = await fetch(origin + '/api/v1/author/stories/77/structure', {
    method: 'PUT',
    headers: { cookie: await sessionCookie(), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(noCsrf.status, 403);

  const missingChapter = await fetch(origin + '/api/v1/author/stories/77/structure', {
    method: 'PUT',
    headers: { cookie: await sessionCookie(), 'x-csrf-token': csrf, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(missingChapter.status, 400);
  assert.ok(calls.some(({ sql }) => sql === 'BEGIN'));
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE ')), false);
});
