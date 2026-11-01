import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createBookmarksRouter } from '../dist/routes/bookmarks.js';

const servers = [];
const userId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'bookmarks-test-csrf-long-enough-32';
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});
async function setup(options = {}) {
  const calls = [];
  const bookmark = {
    id: '5',
    storyId: '12',
    chapterId: options.deletedChapter ? null : '3',
    chapterTitle: options.deletedChapter ? null : 'Chương 3',
    chapterOrder: options.deletedChapter ? null : 3,
    positionPermille: 250,
    note: 'Ghi chú',
    createdAt: '2026-10-25T00:00:00.000Z',
  };
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: options.inactive ? [] : [{ id: userId }] };
      if (sql.includes('FROM stories')) return { rows: options.hidden ? [] : [{ id: '12' }] };
      if (sql.includes('FROM chapters'))
        return {
          rows: options.wrongChapter
            ? []
            : [{ id: '3', chapterTitle: 'Chương 3', chapterOrder: 3 }],
        };
      if (sql.startsWith('SELECT story_id'))
        return { rows: options.notMine ? [] : [{ storyId: '12' }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ total: 21 }] };
      if (sql.startsWith('SELECT b.id')) return { rows: options.notMine ? [] : [bookmark] };
      if (sql.startsWith('INSERT INTO bookmarks') || sql.startsWith('UPDATE bookmarks')) {
        if (options.failure) throw new Error('write failed');
        return { rows: [{ ...bookmark, note: values.at(-1) }] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        query: this.query.bind(this),
        release() {
          calls.push({ sql: 'RELEASE' });
        },
      };
    },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/v1', createBookmarksRouter(database));
  app.use((_error, _request, response, next) => {
    void next;
    response.status(500).json({ error: { code: 'TEST_ERROR' } });
  });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  servers.push(server);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  const headers = {
    'content-type': 'application/json',
    cookie: `readlite_access=${token}; readlite_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return { calls, headers, base, list: base + '/stories/12/bookmarks' };
}
test('bookmarks: requires authenticated verified active owner for listing', async () => {
  const { list } = await setup();
  assert.equal((await fetch(list)).status, 401);
  const inactive = await setup({ inactive: true });
  assert.equal((await fetch(inactive.list, { headers: inactive.headers })).status, 401);
});
test('bookmarks: paginated list scopes user and story, preserving bookmarks with deleted chapters', async () => {
  const { list, headers, calls } = await setup({ deletedChapter: true });
  const response = await fetch(list + '?page=2', { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.pagination, { page: 2, limit: 20, total: 21 });
  assert.equal(body.bookmarks[0].chapterId, null);
  assert.equal(body.bookmarks[0].note, 'Ghi chú');
  const select = calls.find((call) => call.sql.startsWith('SELECT b.id'));
  assert.deepEqual(select.values, ['12', userId, 20, 20]);
  assert.match(select.sql, /LEFT JOIN chapters/);
  assert.match(select.sql, /b.user_id = \$2/);
  assert.match(select.sql, /s.visibility = 'public' AND s.moderation_status = 'published'/);
});
test('bookmarks: validates IDs/pagination and refuses hidden stories', async () => {
  const { list, headers } = await setup();
  for (const query of ['?page=0', '?page=abc', '?page=1&page=2'])
    assert.equal((await fetch(list + query, { headers })).status, 400);
  assert.equal(
    (await fetch(list.replace('/12/', '/9223372036854775808/'), { headers })).status,
    404,
  );
  const hidden = await setup({ hidden: true });
  assert.equal((await fetch(hidden.list, { headers: hidden.headers })).status, 404);
});
test('bookmarks: rejects invalid/forged body and CSRF before database access', async () => {
  const { list, headers, calls } = await setup();
  assert.equal((await fetch(list, { method: 'POST', body: '{}' })).status, 403);
  for (const body of [
    { chapterId: '3', positionPermille: -1 },
    { chapterId: '3', positionPermille: 1001 },
    { chapterId: '3', positionPermille: 1.5 },
    { chapterId: '9223372036854775808', positionPermille: 0 },
    { chapterId: '3', positionPermille: 0, note: 'x'.repeat(2001) },
    { chapterId: '3', positionPermille: 0, userId: 'forged' },
  ]) {
    assert.equal(
      (await fetch(list, { method: 'POST', headers, body: JSON.stringify(body) })).status,
      400,
    );
  }
  assert.equal(calls.length, 0);
});
test('bookmarks: create locks story before valid chapter and uses session owner', async () => {
  const { list, headers, calls } = await setup();
  const response = await fetch(list, {
    method: 'POST',
    headers,
    body: '{"chapterId":"3","positionPermille":250,"note":"  Ghi chú  "}',
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.bookmark.chapterTitle, 'Chương 3');
  assert.equal(body.bookmark.note, 'Ghi chú');
  assert.deepEqual(calls.find((call) => call.sql.startsWith('INSERT INTO bookmarks')).values, [
    userId,
    '12',
    '3',
    250,
    'Ghi chú',
  ]);
  assert.ok(
    calls.findIndex((call) => call.sql.includes('FROM stories')) <
      calls.findIndex((call) => call.sql.includes('FROM chapters')),
  );
  assert.ok(calls.some((call) => call.sql.includes('FOR KEY SHARE')));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
});
test('bookmarks: missing note defaults empty and edge positions accepted', async () => {
  for (const positionPermille of [0, 1000]) {
    const { list, headers, calls } = await setup();
    assert.equal(
      (
        await fetch(list, {
          method: 'POST',
          headers,
          body: JSON.stringify({ chapterId: '3', positionPermille }),
        })
      ).status,
      201,
    );
    assert.equal(calls.find((call) => call.sql.startsWith('INSERT INTO bookmarks')).values[4], '');
  }
});
test('bookmarks: chapter from other story or hidden story rolls back without inserting', async () => {
  for (const options of [{ wrongChapter: true }, { hidden: true }]) {
    const { list, headers, calls } = await setup(options);
    assert.equal(
      (
        await fetch(list, {
          method: 'POST',
          headers,
          body: '{"chapterId":"3","positionPermille":250}',
        })
      ).status,
      404,
    );
    assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
    assert.ok(!calls.some((call) => call.sql.startsWith('INSERT INTO bookmarks')));
  }
});
test('bookmarks: cannot edit/delete someone else bookmark', async () => {
  const { base, headers, calls } = await setup({ notMine: true });
  for (const method of ['PUT', 'DELETE'])
    assert.equal(
      (
        await fetch(base + '/bookmarks/5', {
          method,
          headers,
          ...(method === 'PUT' ? { body: '{"note":"New"}' } : {}),
        })
      ).status,
      404,
    );
  assert.ok(
    !calls.some(
      (call) =>
        call.sql.startsWith('UPDATE bookmarks') || call.sql.startsWith('DELETE FROM bookmarks'),
    ),
  );
});
test('bookmarks: deleted chapter keeps note editable/deletable and cannot change ownership or chapter', async () => {
  const { base, headers, calls } = await setup({ deletedChapter: true });
  assert.equal(
    (
      await fetch(base + '/bookmarks/5', {
        method: 'PUT',
        headers,
        body: '{"note":"New","chapterId":"9"}',
      })
    ).status,
    400,
  );
  const update = await fetch(base + '/bookmarks/5', {
    method: 'PUT',
    headers,
    body: '{"note":"  New  "}',
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).bookmark.chapterId, null);
  assert.deepEqual(calls.find((call) => call.sql.startsWith('UPDATE bookmarks')).values, [
    '5',
    userId,
    'New',
  ]);
  assert.equal((await fetch(base + '/bookmarks/5', { method: 'DELETE', headers })).status, 200);
  assert.deepEqual(calls.find((call) => call.sql.startsWith('DELETE FROM bookmarks')).values, [
    '5',
    userId,
  ]);
});
test('bookmarks: write failure rolls back and releases connection', async () => {
  const { list, headers, calls } = await setup({ failure: true });
  assert.equal(
    (await fetch(list, { method: 'POST', headers, body: '{"chapterId":"3","positionPermille":0}' }))
      .status,
    500,
  );
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
