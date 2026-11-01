import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createAdminUsersRouter } from '../dist/routes/admin-users.js';

const servers = [];
const actorId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const targetId = 'c080e451-4850-4155-a3fd-28ce15c0a2c2';
const csrf = 'test-csrf-token-value-long-enough-32';

async function start(database) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1', createAdminUsersRouter(database));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function cookie(id) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
    .setSubject(id).setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return `readlite_access=${token}; readlite_csrf=${csrf}`;
}

after(async () => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

test('role management rejects non-admins and missing CSRF', async () => {
  const database = {
    async query() { return { rows: [] }; },
    async connect() { throw new Error('Should not begin a transaction.'); },
  };
  const origin = await start(database);
  const list = await fetch(origin + '/api/v1/admin/users', { headers: { cookie: await cookie(actorId) } });
  assert.equal(list.status, 403);

  const adminDatabase = {
    async query() { return { rows: [{ id: actorId }] }; },
    async connect() { throw new Error('Should not begin a transaction.'); },
  };
  const adminOrigin = await start(adminDatabase);
  const change = await fetch(adminOrigin + `/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH', headers: { cookie: await cookie(actorId), 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(change.status, 403);
  assert.equal((await change.json()).error.code, 'CSRF_INVALID');
});

test('admin changes another verified account role and records an audit event', async () => {
  const statements = [];
  const account = {
    id: targetId, email: 'author@example.test', username: 'author', displayName: 'Author',
    role: 'user', isActive: true, emailVerified: true,
  };
  const database = {
    async query() { return { rows: [{ id: actorId }] }; },
    async connect() { return {
      async query(sql, values) {
        statements.push({ sql, values });
        if (sql.includes('FROM users WHERE id = $1 FOR UPDATE')) return { rows: [account] };
        if (sql.includes("role = 'admin'")) return { rows: [{ id: actorId }] };
        return { rows: [] };
      },
      release() {},
    }; },
  };
  const origin = await start(database);
  const response = await fetch(origin + `/api/v1/admin/users/${targetId}/role`, {
    method: 'PATCH',
    headers: { cookie: await cookie(actorId), 'x-csrf-token': csrf, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'author' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'author');
  assert.ok(statements.some(({ sql, values }) => sql.includes('UPDATE users SET role') && values[1] === 'author'));
  assert.ok(statements.some(({ sql, values }) => sql.includes('account_role_events') && values[0] === actorId && values[1] === targetId));
  assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
});

test('admin cannot change their own role', async () => {
  const database = {
    async query() { return { rows: [{ id: actorId }] }; },
    async connect() { throw new Error('Should not begin a transaction.'); },
  };
  const origin = await start(database);
  const response = await fetch(origin + `/api/v1/admin/users/${actorId}/role`, {
    method: 'PATCH',
    headers: { cookie: await cookie(actorId), 'x-csrf-token': csrf, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'user' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'SELF_ROLE_CHANGE');
});
