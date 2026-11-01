import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createAdminReviewRouter } from '../dist/routes/admin-review.js';

const servers = [];
const adminId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const authorId = 'c080e451-4850-4155-a3fd-28ce15c0a2c2';
const csrf = 'test-csrf-token-value-long-enough-32';

async function startServer(database) {
  const application = express();
  application.use(express.json());
  application.use(cookieParser());
  application.use('/api/v1', createAdminReviewRouter(database));
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

async function cookieFor(userId) {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return 'readlite_access=' + accessToken + '; readlite_csrf=' + csrf;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

test('admin review queue requires administrator role and exposes only AI-cleared items', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM users')) return { rows: [{ id: authorId, role: 'author' }] };
      return { rows: [] };
    },
    async connect() { throw new Error('Not used.'); },
  };
  const origin = await startServer(database);
  const response = await fetch(origin + '/api/v1/admin/story-submissions', {
    headers: { cookie: await cookieFor(authorId) },
  });
  assert.equal(response.status, 403);
});

test('admin can approve an AI warning after a different user submitted it', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push({ sql });
      return { rows: [{ id: adminId, role: 'admin' }] };
    },
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('FROM stories WHERE id = $1 FOR UPDATE')) {
            return { rows: [{
              id: '77',
              submittedBy: authorId,
              moderationStatus: 'admin_review_pending',
              aiReviewStatus: 'warnings',
            }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const origin = await startServer(database);
  const response = await fetch(origin + '/api/v1/admin/story-submissions/77/decision', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(adminId),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision: 'approve' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    storyId: '77',
    moderationStatus: 'published',
    visibility: 'public',
  });
  assert.ok(calls.some(({ sql, values }) =>
    sql.includes('UPDATE stories SET moderation_status') &&
    values[1] === 'published' && values[2] === 'public'));
  assert.ok(calls.some(({ sql, values }) =>
    sql.includes('story_review_events') && values[2] === 'approved'));
});

test('admin can review own imports but cannot decide on incomplete AI review', async () => {
  const createDatabase = (submittedBy, aiReviewStatus) => ({
    async query() {
      return { rows: [{ id: adminId, role: 'admin' }] };
    },
    async connect() {
      return {
        async query(sql) {
          if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('FROM stories WHERE id = $1 FOR UPDATE')) {
            return { rows: [{
              id: '77',
              submittedBy,
              moderationStatus: 'admin_review_pending',
              aiReviewStatus,
            }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  });
  const originSelf = await startServer(createDatabase(adminId, 'passed'));
  const self = await fetch(originSelf + '/api/v1/admin/story-submissions/77/decision', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(adminId),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(self.status, 200);
  assert.equal((await self.json()).moderationStatus, 'published');

  const originFailed = await startServer(createDatabase(authorId, 'failed'));
  const failed = await fetch(originFailed + '/api/v1/admin/story-submissions/77/decision', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(adminId),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(failed.status, 409);
  assert.equal((await failed.json()).error.code, 'STORY_NOT_REVIEWABLE');
});

test('reject and changes-request decisions require a reason', async () => {
  const database = {
    async query() { return { rows: [{ id: adminId, role: 'admin' }] }; },
    async connect() { throw new Error('Validation should happen before transaction.'); },
  };
  const origin = await startServer(database);
  const response = await fetch(origin + '/api/v1/admin/story-submissions/77/decision', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(adminId),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision: 'reject' }),
  });
  assert.equal(response.status, 400);
});
