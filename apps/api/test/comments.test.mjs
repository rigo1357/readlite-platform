import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createCommentsRouter } from '../dist/routes/comments.js';

const servers = [];
const userId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'comments-test-csrf-long-enough-32';
after(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });
async function setup(options = {}) {
  const calls = [];
  const comment = { id: '5', storyId: '12', chapterId: null, parentId: null, content: 'Hay', isDeleted: false, displayName: 'Độc giả', isMine: false, replyCount: 2 };
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: options.inactive ? [] : [{ id: userId, displayName: 'Độc giả' }] };
      if (sql.includes('FROM stories')) return { rows: options.hidden ? [] : [{ id: '12' }] };
      if (sql.includes('FROM chapters')) return { rows: options.wrongChapter ? [] : [{ id: '3' }] };
      if (sql.startsWith('SELECT story_id')) return { rows: options.notMine ? [] : [{ storyId: '12' }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ total: 12 }] };
      if (sql.includes('AS "replyCount"')) return { rows: [{ ...comment, isDeleted: true, content: '' }] };
      if (sql.startsWith('SELECT id FROM comments')) return { rows: options.badParent ? [] : [{ id: '5' }] };
      if (sql.startsWith('SELECT id::text')) return { rows: options.notMine ? [] : [{ ...comment, userId, isDeleted: Boolean(options.deleted) }] };
      if (sql.startsWith('INSERT INTO comments') || sql.startsWith('UPDATE comments SET content')) {
        if (options.failure) throw new Error('write failed');
        return { rows: [{ ...comment, content: values.at(-1) }] };
      }
      return { rows: [] };
    },
    async connect() { return { query: this.query.bind(this), release() { calls.push({ sql: 'RELEASE' }); } }; },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/v1', createCommentsRouter(database));
  app.use((_error, _request, response, next) => { void next; response.status(500).json({ error: { code: 'TEST_ERROR' } }); });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  servers.push(server);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.authAccessSecret));
  const headers = { 'content-type': 'application/json', cookie: `readlite_access=${token}; readlite_csrf=${csrf}`, 'x-csrf-token': csrf };
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return { calls, headers, base, list: base + '/stories/12/comments' };
}
test('comments: anonymous roots paginate, scope story comments and redact deleted content', async () => {
  const { list, calls } = await setup();
  const response = await fetch(list + '?page=2');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.pagination, { page: 2, limit: 10, total: 12 });
  assert.equal(body.comments[0].content, '');
  assert.equal(body.comments[0].isDeleted, true);
  const select = calls.find(call => call.sql.includes('AS "replyCount"'));
  assert.deepEqual(select.values, ['12', null, null, null, 10, 10]);
  assert.match(select.sql, /CASE WHEN c.is_deleted THEN '' ELSE c.content END/);
  assert.match(select.sql, /s.visibility = 'public' AND s.moderation_status = 'published'/);
  assert.ok(!select.sql.includes('email'));
});
test('comments: replies use matching story/chapter and optional session identity', async () => {
  const { list, calls, headers } = await setup();
  assert.equal((await fetch(list + '?chapterId=3&parentId=5', { headers })).status, 200);
  const parent = calls.find(call => call.sql.startsWith('SELECT id FROM comments'));
  assert.deepEqual(parent.values, ['5', '12', '3']);
  assert.match(parent.sql, /parent_id IS NULL/);
  assert.equal(calls.find(call => call.sql.includes('AS "replyCount"')).values[3], userId);
});
test('comments: refuse hidden stories, unknown chapters/parents, invalid paging and bigint overflow', async () => {
  for (const [options, query, status] of [[{ hidden: true }, '', 404], [{ wrongChapter: true }, '?chapterId=3', 404],
    [{ badParent: true }, '?parentId=5', 404], [{}, '?page=0', 400], [{}, '?parentId=9223372036854775808', 400], [{}, '?chapterId=1&chapterId=2', 400]]) {
    const { list } = await setup(options);
    assert.equal((await fetch(list + query)).status, status);
  }
});
test('comments: mutations reject CSRF and malformed bodies before database work', async () => {
  const { list, headers, calls } = await setup();
  assert.equal((await fetch(list, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"content":"Hi"}' })).status, 403);
  for (const body of [{ content: ' ' }, { content: 'x'.repeat(5001) }, { content: 'Hi', userId: 'forged' }, { content: 'Hi', chapterId: '9223372036854775808' }]) {
    assert.equal((await fetch(list, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('comments: requires verified active account', async () => {
  const anonymous = await setup();
  const headers = { 'content-type': 'application/json', cookie: `readlite_csrf=${csrf}`, 'x-csrf-token': csrf };
  assert.equal((await fetch(anonymous.list, { method: 'POST', headers, body: '{"content":"Hi"}' })).status, 401);
  const inactive = await setup({ inactive: true });
  assert.equal((await fetch(inactive.list, { method: 'POST', headers: inactive.headers, body: '{"content":"Hi"}' })).status, 401);
});
test('comments: creates trimmed one-level reply using session identity and locks story/parent', async () => {
  const { list, calls, headers } = await setup();
  const response = await fetch(list, { method: 'POST', headers, body: '{"content":"  Hay quá  ","parentId":"5"}' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).comment.content, 'Hay quá');
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO comments')).values, ['12', null, userId, '5', 'Hay quá']);
  const parent = calls.find(call => call.sql.startsWith('SELECT id FROM comments'));
  assert.match(parent.sql, /parent_id IS NULL AND is_deleted = false FOR UPDATE/);
  assert.match(parent.sql, /chapter_id IS NOT DISTINCT FROM/);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
test('comments: incompatible parent or hidden story rolls back without insertion', async () => {
  for (const options of [{ hidden: true }, { badParent: true }, { wrongChapter: true }]) {
    const { list, calls, headers } = await setup(options);
    assert.ok([400, 404].includes((await fetch(list, { method: 'POST', headers, body: '{"content":"Hi","chapterId":"3","parentId":"5"}' })).status));
    assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
    assert.ok(!calls.some(call => call.sql.startsWith('INSERT INTO comments')));
  }
});
test('comments: editing/deleting another account comment is refused', async () => {
  const { base, headers, calls } = await setup({ notMine: true });
  for (const method of ['PUT', 'DELETE']) assert.equal((await fetch(base + '/comments/5', { method, headers, ...(method === 'PUT' ? { body: '{"content":"New"}' } : {}) })).status, 404);
  assert.ok(!calls.some(call => call.sql.startsWith('UPDATE comments')));
});
test('comments: owner may edit, but deleted comments cannot be edited', async () => {
  const { base, headers, calls } = await setup();
  assert.equal((await fetch(base + '/comments/5', { method: 'PUT', headers, body: '{"content":"Updated"}' })).status, 200);
  assert.deepEqual(calls.find(call => call.sql.startsWith('UPDATE comments')).values, ['5', userId, 'Updated']);
  const deleted = await setup({ deleted: true });
  assert.equal((await fetch(deleted.base + '/comments/5', { method: 'PUT', headers: deleted.headers, body: '{"content":"Updated"}' })).status, 404);
});
test('comments: deletion preserves replies with tombstone and cleared original text', async () => {
  const { base, headers, calls } = await setup();
  assert.equal((await fetch(base + '/comments/5', { method: 'DELETE', headers })).status, 200);
  const mutation = calls.find(call => call.sql.startsWith('UPDATE comments'));
  assert.match(mutation.sql, /is_deleted = true, content = '\[Đã xóa\]'/);
  assert.deepEqual(mutation.values, ['5', userId]);
  assert.ok(!calls.some(call => call.sql.startsWith('DELETE FROM comments')));
});
test('comments: failed insert rolls back and releases client', async () => {
  const { list, headers, calls } = await setup({ failure: true });
  assert.equal((await fetch(list, { method: 'POST', headers, body: '{"content":"Hello"}' })).status, 500);
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
