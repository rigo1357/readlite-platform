import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createReviewsRouter } from '../dist/routes/reviews.js';

const servers = [];
const userId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'reviews-test-csrf-long-enough-32';
after(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });
async function setup({ hidden = false, failure = false, active = true } = {}) {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: active ? [{ id: userId }] : [] };
      if (sql.includes('FROM stories')) return { rows: hidden ? [] : [{ id: '12', ratingAvg: 4, ratingCount: 11 }] };
      if (sql.startsWith('INSERT INTO reviews')) {
        if (failure) throw new Error('write failed');
        return { rows: [{ id: '7', rating: values[2], content: values[3] }] };
      }
      if (sql.includes('FROM reviews')) return { rows: [{ id: '7', rating: 4, content: 'Hay', displayName: 'Độc giả' }] };
      return { rows: [] };
    },
    async connect() { return { query: this.query.bind(this), release() { calls.push({ sql: 'RELEASE' }); } }; },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/v1', createReviewsRouter(database));
  app.use((error, _req, res, _next) => res.status(500).json({ error: { code: 'TEST_ERROR' } }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  servers.push(server);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.authAccessSecret));
  const headers = { 'content-type': 'application/json', cookie: `readlite_access=${token}; readlite_csrf=${csrf}`, 'x-csrf-token': csrf };
  return { calls, headers, url: `http://127.0.0.1:${server.address().port}/api/v1/stories/12/reviews` };
}

test('reviews: public list is paginated and returns aggregates without account email', async () => {
  const { url, calls } = await setup();
  const response = await fetch(url + '?page=2');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ratingAvg, 4);
  assert.deepEqual(body.pagination, { page: 2, limit: 10, total: 11 });
  const query = calls.find(call => call.sql.includes('JOIN users'));
  assert.deepEqual(query.values, ['12', 10, 10]);
  assert.match(query.sql, /s\.visibility = 'public' AND s\.moderation_status = 'published'/);
  assert.ok(!query.sql.includes('email'));
});
test('reviews: hidden stories and invalid paging are refused', async () => {
  const { url } = await setup({ hidden: true });
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url + '?page=0')).status, 400);
  assert.equal((await fetch(url.replace('/12/', '/9223372036854775808/'))).status, 404);
});
test('reviews: own review requires authenticated active verified account', async () => {
  const { url, headers } = await setup();
  assert.equal((await fetch(url + '/me')).status, 401);
  assert.equal((await fetch(url + '/me', { headers })).status, 200);
  const inactive = await setup({ active: false });
  assert.equal((await fetch(inactive.url + '/me', { headers: inactive.headers })).status, 401);
});
test('reviews: mutation requires CSRF and does not access database on failure', async () => {
  const { url, calls } = await setup();
  assert.equal((await fetch(url + '/me', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"rating":5}' })).status, 403);
  assert.equal(calls.length, 0);
});
test('reviews: rejects invalid scores, too long content and forged ownership', async () => {
  const { url, headers, calls } = await setup();
  for (const body of [{ rating: 0 }, { rating: 6 }, { rating: 1.5 }, { rating: 5, content: 'x'.repeat(5001) }, { rating: 5, user_id: 'other-user' }]) {
    assert.equal((await fetch(url + '/me', { method: 'PUT', headers, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('reviews: upsert uses identity from session and commits with story lock', async () => {
  const { url, headers, calls } = await setup();
  const response = await fetch(url + '/me', { method: 'PUT', headers, body: JSON.stringify({ rating: 5, content: '  Rất hay  ' }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).review.content, 'Rất hay');
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO reviews'));
  assert.deepEqual(insert.values, ['12', userId, 5, 'Rất hay']);
  assert.match(insert.sql, /ON CONFLICT \(story_id, user_id\) DO UPDATE/);
  assert.ok(calls.some(call => call.sql.endsWith('FOR UPDATE')));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
test('reviews: deleting is restricted to current account and is idempotent', async () => {
  const { url, headers, calls } = await setup();
  assert.equal((await fetch(url + '/me', { method: 'DELETE', headers })).status, 200);
  const deletion = calls.find(call => call.sql.startsWith('DELETE FROM reviews'));
  assert.deepEqual(deletion.values, ['12', userId]);
});
test('reviews: hidden story mutation rolls back without writing', async () => {
  const { url, headers, calls } = await setup({ hidden: true });
  assert.equal((await fetch(url + '/me', { method: 'PUT', headers, body: '{"rating":4}' })).status, 404);
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql.startsWith('INSERT INTO reviews')));
});
test('reviews: failed write rolls back and releases connection', async () => {
  const { url, headers, calls } = await setup({ failure: true });
  assert.equal((await fetch(url + '/me', { method: 'PUT', headers, body: '{"rating":4}' })).status, 500);
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
