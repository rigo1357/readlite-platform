import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { env } from '../dist/config/env.js';
import { createAuthRouter } from '../dist/routes/auth.js';

const servers = [];
const userId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'password-test-csrf-long-enough-32';
const currentPassword = 'CurrentPassword123!';
const passwordHash = await bcrypt.hash(currentPassword, 4);
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});
async function setup(options = {}) {
  const calls = [],
    messages = [];
  const user = {
    id: userId,
    email: 'reader@example.test',
    username: 'reader',
    display_name: 'Độc giả',
  };
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users'))
        return { rows: options.noUser ? [] : [{ ...user, password_hash: passwordHash }] };
      if (sql.includes('SELECT user_id FROM password_resets'))
        return { rows: options.invalidToken ? [] : [{ user_id: userId }] };
      if (sql.includes('UPDATE password_resets') && sql.includes('RETURNING user_id'))
        return { rows: options.invalidToken ? [] : [{ user_id: userId }] };
      if (sql.includes('SELECT user_id FROM email_verifications'))
        return { rows: [{ user_id: userId }] };
      if (sql.includes('UPDATE email_verifications') && sql.includes('RETURNING user_id'))
        return { rows: [{ user_id: userId }] };
      if (sql.includes('INSERT INTO users')) return { rows: [user] };
      if (sql.includes('UPDATE users')) {
        if (options.writeFailure) throw new Error('write failed');
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
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
  const mailer = {
    async sendVerification(message) {
      messages.push({ type: 'verify', ...message });
      if (options.mailFailure) throw new Error('do-not-expose-smtp-secret');
    },
    async sendPasswordReset(message) {
      messages.push({ type: 'reset', ...message });
      if (options.mailFailure) throw new Error('do-not-expose-smtp-secret');
    },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/v1', createAuthRouter(database, mailer));
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
  return {
    calls,
    messages,
    headers,
    base: `http://127.0.0.1:${server.address().port}/api/v1/auth`,
  };
}
test('change password: CSRF and verified session required', async () => {
  const { base, calls } = await setup();
  assert.equal(
    (await fetch(base + '/change-password', { method: 'POST', body: '{}' })).status,
    403,
  );
  assert.equal(calls.length, 0);
  const inactive = await setup({ noUser: true });
  assert.equal(
    (
      await fetch(inactive.base + '/change-password', {
        method: 'POST',
        headers: inactive.headers,
        body: JSON.stringify({ currentPassword, password: 'NewPassword123!' }),
      })
    ).status,
    401,
  );
  assert.ok(inactive.calls.some((call) => call.sql === 'ROLLBACK'));
});
test('change password: validates strict body and UTF-8 bcrypt 72 byte limit', async () => {
  for (const body of [
    { currentPassword, password: 'short' },
    { currentPassword, password: 'é'.repeat(37) },
    { currentPassword: 'x'.repeat(73), password: 'ValidPassword123' },
    { currentPassword, password: 'ValidPassword123', userId: 'other' },
  ]) {
    const { base, headers, calls } = await setup();
    assert.equal(
      (
        await fetch(base + '/change-password', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status,
      400,
    );
    assert.equal(calls.length, 0);
  }
});
test('change password: wrong current password makes no writes and rolls back', async () => {
  const { base, headers, calls } = await setup();
  const response = await fetch(base + '/change-password', {
    method: 'POST',
    headers,
    body: '{"currentPassword":"WrongPassword123","password":"NewPassword123"}',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'CURRENT_PASSWORD_INVALID');
  assert.ok(!calls.some((call) => call.sql.startsWith('UPDATE')));
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
test('change password: hashes password, locks user, revokes all refresh/reset tokens then clears session', async () => {
  const { base, headers, calls } = await setup();
  const response = await fetch(base + '/change-password', {
    method: 'POST',
    headers,
    body: JSON.stringify({ currentPassword, password: 'NewPassword123!' }),
  });
  assert.equal(response.status, 200);
  const update = calls.find((call) => call.sql.startsWith('UPDATE users'));
  assert.equal(update.values[0], userId);
  assert.notEqual(update.values[1], 'NewPassword123!');
  assert.ok(await bcrypt.compare('NewPassword123!', update.values[1]));
  assert.ok(calls.some((call) => call.sql.includes('FOR NO KEY UPDATE')));
  assert.ok(calls.some((call) => call.sql.startsWith('UPDATE refresh_tokens')));
  assert.ok(calls.some((call) => call.sql.startsWith('UPDATE password_resets')));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  for (const name of ['readlite_access', 'readlite_refresh', 'readlite_csrf'])
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith(name + '=;')));
});
test('change password: failed write rolls back without clearing cookies', async () => {
  const { base, headers, calls } = await setup({ writeFailure: true });
  const response = await fetch(base + '/change-password', {
    method: 'POST',
    headers,
    body: JSON.stringify({ currentPassword, password: 'NewPassword123!' }),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(response.headers.getSetCookie(), []);
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
});
test('forgot password: existing and missing accounts have same response and no token exposure', async () => {
  const existing = await setup(),
    missing = await setup({ noUser: true });
  const responses = [];
  for (const context of [existing, missing]) {
    const response = await fetch(context.base + '/forgot-password', {
      method: 'POST',
      headers: context.headers,
      body: '{"email":"reader@example.test"}',
    });
    assert.equal(response.status, 202);
    responses.push(await response.json());
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.equal(existing.messages[0].type, 'reset');
  assert.equal(missing.messages.length, 0);
  const insert = existing.calls.find((call) => call.sql.includes('INSERT INTO password_resets'));
  assert.equal(
    insert.values[1],
    createHash('sha256').update(existing.messages[0].token).digest('hex'),
  );
  assert.ok(!JSON.stringify(responses).includes(existing.messages[0].token));
});
test('registration: commits account before sending verification and retains successful response on SMTP failure', async () => {
  const { base, headers, calls, messages } = await setup({ mailFailure: true });
  const response = await fetch(base + '/register', {
    method: 'POST',
    headers,
    body: '{"email":"reader@example.test","username":"reader","password":"Password123!","displayName":"Độc giả"}',
  });
  assert.equal(response.status, 201);
  assert.equal(messages[0].type, 'verify');
  const insert = calls.find((call) => call.sql.includes('INSERT INTO email_verifications'));
  assert.equal(insert.values[1], createHash('sha256').update(messages[0].token).digest('hex'));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  assert.ok(!(await response.text()).includes('do-not-expose-smtp-secret'));
});
test('resend verification: generic response, invalidates old token, and sends only after commit', async () => {
  const existing = await setup(),
    missing = await setup({ noUser: true });
  const responses = [];
  for (const context of [existing, missing]) {
    const response = await fetch(context.base + '/resend-verification', {
      method: 'POST',
      headers: context.headers,
      body: '{"email":"reader@example.test"}',
    });
    assert.equal(response.status, 202);
    responses.push(await response.json());
  }
  assert.deepEqual(responses[0], responses[1]);
  assert.equal(existing.messages.length, 1);
  assert.equal(missing.messages.length, 0);
  assert.ok(
    existing.calls.some((call) => call.sql.startsWith('UPDATE email_verifications SET used_at')),
  );
  assert.ok(existing.calls.some((call) => call.sql === 'COMMIT'));
  assert.ok(!JSON.stringify(responses).includes(existing.messages[0].token));
});
test('email delivery errors preserve enumeration-safe response', async () => {
  const { base, headers } = await setup({ mailFailure: true });
  for (const path of ['/forgot-password', '/resend-verification']) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers,
      body: '{"email":"reader@example.test"}',
    });
    assert.equal(response.status, 202);
    assert.ok(!(await response.text()).includes('do-not-expose-smtp-secret'));
  }
});
test('reset browser page escapes token, has no script and no-store/referrer policy', async () => {
  const { base } = await setup();
  const response = await fetch(
    base + '/reset-password?token=' + encodeURIComponent('x'.repeat(32) + '"><script>bad</script>'),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const body = await response.text();
  assert.ok(!body.includes('<script>'));
  assert.match(body, /&quot;&gt;&lt;script&gt;/);
  assert.match(body, /method="post"/);
  assert.equal((await fetch(base + '/reset-password?token=bad')).status, 400);
});
test('reset password: JSON and browser form keep token validation and revoke sessions', async () => {
  for (const form of [false, true]) {
    const { base, headers, calls } = await setup();
    const token = 'x'.repeat(43);
    const response = await fetch(base + '/reset-password', {
      method: 'POST',
      headers: form ? { 'content-type': 'application/x-www-form-urlencoded' } : headers,
      body: form
        ? new URLSearchParams({ token, password: 'NewPassword123!' })
        : JSON.stringify({ token, password: 'NewPassword123!' }),
    });
    assert.equal(response.status, 200);
    assert.ok(calls.some((call) => call.sql.startsWith('UPDATE refresh_tokens')));
    assert.ok(calls.some((call) => call.sql === 'COMMIT'));
    assert.ok(
      response.headers.get('content-type').includes(form ? 'text/html' : 'application/json'),
    );
  }
  const invalid = await setup({ invalidToken: true });
  assert.equal(
    (
      await fetch(invalid.base + '/reset-password', {
        method: 'POST',
        headers: invalid.headers,
        body: JSON.stringify({ token: 'x'.repeat(43), password: 'NewPassword123!' }),
      })
    ).status,
    400,
  );
  assert.ok(!invalid.calls.some((call) => call.sql.startsWith('UPDATE users')));
});
