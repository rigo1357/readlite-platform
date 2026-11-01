import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createReportsRouter } from '../dist/routes/reports.js';

const servers = [];
const userId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'reports-test-csrf-long-enough-32';
after(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });
async function setup(options = {}) {
  const calls = [];
  const report = { id: '7', targetType: options.targetType ?? 'story', targetId: '12', status: options.closed ? 'resolved' : 'open' };
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: options.inactive ? [] : [{ id: userId, role: options.role ?? 'admin' }] };
      if (sql.startsWith('SELECT story_id')) return { rows: options.missingTarget ? [] : [{ storyId: '12' }] };
      if (sql.includes('FROM stories')) return { rows: options.hidden ? [] : [{ id: '12', moderationStatus: options.busy ? 'ai_review_pending' : 'published' }] };
      if (sql.startsWith('SELECT id FROM comments') || sql.startsWith('SELECT id FROM reviews')) return { rows: options.missingTarget ? [] : [{ id: '12' }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ total: 11 }] };
      if (sql.includes('AS "reporterName"')) return { rows: [{ ...report, reporterName: 'Độc giả', reason: 'Nội dung sai', targetTitle: 'Truyện', targetContent: null, targetAvailable: false }] };
      if (sql.startsWith('SELECT id::text')) return { rows: options.missingReport ? [] : [report] };
      if (sql.startsWith('INSERT INTO reports')) {
        if (options.failure) throw new Error('write failed');
        return { rows: [{ ...report, targetType: values[1], targetId: values[2] }] };
      }
      if (sql.startsWith('UPDATE reports')) return { rows: [{ ...report, status: values[1] }] };
      if (sql.startsWith('UPDATE comments') || sql.startsWith('DELETE FROM reviews')) return { rows: options.missingTarget ? [] : [{ id: '12' }] };
      return { rows: [] };
    },
    async connect() { return { query: this.query.bind(this), release() { calls.push({ sql: 'RELEASE' }); } }; },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/v1', createReportsRouter(database));
  app.use((_error, _request, response, next) => { void next; response.status(500).json({ error: { code: 'TEST_ERROR' } }); });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  servers.push(server);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.authAccessSecret));
  const headers = { 'content-type': 'application/json', cookie: `readlite_access=${token}; readlite_csrf=${csrf}`, 'x-csrf-token': csrf };
  return { calls, headers, base: `http://127.0.0.1:${server.address().port}/api/v1` };
}
test('reports: strict validation and CSRF fail without querying database', async () => {
  const { base, headers, calls } = await setup();
  assert.equal((await fetch(base + '/reports', { method: 'POST', body: '{}' })).status, 403);
  for (const body of [{ targetType: 'user', targetId: '1', reason: 'spam' }, { targetType: 'story', targetId: '9223372036854775808', reason: 'spam' },
    { targetType: 'story', targetId: '1', reason: ' ' }, { targetType: 'story', targetId: '1', reason: 'x'.repeat(2001) },
    { targetType: 'story', targetId: '1', reason: 'spam', reporterId: 'forged' }]) {
    assert.equal((await fetch(base + '/reports', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(calls.length, 0);
});
test('reports: active verified login required for reporting', async () => {
  const { base, headers } = await setup({ inactive: true });
  assert.equal((await fetch(base + '/reports', { method: 'POST', headers, body: '{"targetType":"story","targetId":"12","reason":"Spam"}' })).status, 401);
});
test('reports: uses session identity, locks public story, and deduplicates open report', async () => {
  const { base, headers, calls } = await setup();
  const body = '{"targetType":"story","targetId":"12","reason":"  Spam  "}';
  const first = await fetch(base + '/reports', { method: 'POST', headers, body });
  const second = await fetch(base + '/reports', { method: 'POST', headers, body });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).report.id, (await second.json()).report.id);
  const insert = calls.find(call => call.sql.startsWith('INSERT INTO reports'));
  assert.deepEqual(insert.values, [userId, 'story', '12', 'Spam']);
  assert.match(insert.sql, /ON CONFLICT \(reporter_id, target_type, target_id\) WHERE status = 'open'/);
  assert.ok(calls.some(call => call.sql.includes("moderation_status = 'published' FOR UPDATE")));
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});
test('reports: cannot report hidden stories or removed comments/reviews', async () => {
  for (const [options, type] of [[{ hidden: true }, 'story'], [{ missingTarget: true }, 'comment'], [{ missingTarget: true }, 'review']]) {
    const { base, headers, calls } = await setup(options);
    assert.equal((await fetch(base + '/reports', { method: 'POST', headers, body: JSON.stringify({ targetType: type, targetId: '12', reason: 'Spam' }) })).status, 404);
    assert.ok(!calls.some(call => call.sql.startsWith('INSERT INTO reports')));
    assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  }
});
test('reports: admin list denies users and validates filters', async () => {
  const user = await setup({ role: 'user' });
  assert.equal((await fetch(user.base + '/admin/reports', { headers: user.headers })).status, 403);
  const admin = await setup();
  assert.equal((await fetch(admin.base + '/admin/reports?status=bogus', { headers: admin.headers })).status, 400);
  assert.equal((await fetch(admin.base + '/admin/reports?page=0', { headers: admin.headers })).status, 400);
});
test('reports: admin list paginates, omits email and redacts deleted comment body', async () => {
  const { base, headers, calls } = await setup();
  const response = await fetch(base + '/admin/reports?page=2', { headers });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).pagination, { page: 2, limit: 10, total: 11 });
  const select = calls.find(call => call.sql.includes('AS "reporterName"'));
  assert.deepEqual(select.values, ['open', 10, 10]);
  assert.match(select.sql, /WHEN c.is_deleted = false THEN c.content ELSE NULL END/);
  assert.ok(!select.sql.includes('email'));
});
test('reports: decision requires admin, CSRF and compatible status/action', async () => {
  const { base, headers } = await setup();
  assert.equal((await fetch(base + '/admin/reports/7', { method: 'PATCH', body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/admin/reports/7', { method: 'PATCH', headers, body: '{"status":"dismissed","action":"hide_story"}' })).status, 400);
  const user = await setup({ role: 'user' });
  assert.equal((await fetch(user.base + '/admin/reports/7', { method: 'PATCH', headers: user.headers, body: '{"status":"resolved"}' })).status, 403);
  assert.equal((await fetch(base + '/admin/reports/7', { method: 'PATCH', headers, body: '{"status":"resolved","action":"delete_comment"}' })).status, 400);
});
test('reports: hide story and report resolution commit atomically with audit event', async () => {
  const { base, headers, calls } = await setup();
  const response = await fetch(base + '/admin/reports/7', { method: 'PATCH', headers, body: '{"status":"resolved","action":"hide_story"}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).report.status, 'resolved');
  assert.ok(calls.some(call => call.sql.startsWith("UPDATE stories SET visibility = 'private', moderation_status = 'draft'")));
  const event = calls.find(call => call.sql.startsWith('INSERT INTO story_review_events'));
  assert.equal(event.values[1], userId);
  assert.deepEqual(JSON.parse(event.values[2]), { action: 'hidden_from_report', reportId: '7' });
  assert.deepEqual(calls.find(call => call.sql.startsWith('UPDATE reports')).values, ['7', 'resolved', userId]);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});
test('reports: closed or busy reports cannot perform side effects', async () => {
  for (const options of [{ closed: true }, { busy: true }]) {
    const { base, headers, calls } = await setup(options);
    assert.equal((await fetch(base + '/admin/reports/7', { method: 'PATCH', headers, body: '{"status":"resolved","action":"hide_story"}' })).status, 409);
    assert.ok(!calls.some(call => call.sql.startsWith('UPDATE stories')));
    assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  }
});
test('reports: comment moderation preserves replies; review deletion uses aggregate trigger', async () => {
  for (const [type, action, expected] of [['comment', 'delete_comment', 'UPDATE comments'], ['review', 'delete_review', 'DELETE FROM reviews']]) {
    const { base, headers, calls } = await setup({ targetType: type });
    assert.equal((await fetch(base + '/admin/reports/7', { method: 'PATCH', headers, body: JSON.stringify({ status: 'resolved', action }) })).status, 200);
    assert.deepEqual(calls.find(call => call.sql.startsWith(expected)).values, ['12', '12']);
    assert.ok(calls.some(call => call.sql === 'COMMIT'));
    assert.ok(!calls.some(call => call.sql.startsWith('DELETE FROM comments')));
  }
});
test('reports: missing target can be dismissed without a content action', async () => {
  const { base, headers, calls } = await setup({ targetType: 'comment', missingTarget: true });
  assert.equal((await fetch(base + '/admin/reports/7', { method: 'PATCH', headers, body: '{"status":"dismissed"}' })).status, 200);
  assert.deepEqual(calls.find(call => call.sql.startsWith('UPDATE reports')).values, ['7', 'dismissed', userId]);
});
test('reports: failed write rolls back and releases', async () => {
  const { base, headers, calls } = await setup({ failure: true });
  assert.equal((await fetch(base + '/reports', { method: 'POST', headers, body: '{"targetType":"story","targetId":"12","reason":"Spam"}' })).status, 500);
  assert.ok(calls.some(call => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some(call => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
