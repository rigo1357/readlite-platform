import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  grantVerifiedAccountRole,
  parseGrantRoleArguments,
} from '../src/accounts/grant-role.ts';

test('role command accepts a registered email and only author/admin roles', () => {
  assert.deepEqual(
    parseGrantRoleArguments(['--email', 'reader@example.com', '--role', 'author']),
    { email: 'reader@example.com', role: 'author' },
  );
  assert.deepEqual(
    parseGrantRoleArguments(['--role', 'admin', '--email', 'admin@example.com']),
    { email: 'admin@example.com', role: 'admin' },
  );
  assert.equal(parseGrantRoleArguments(['--email', 'not-an-email', '--role', 'admin']), null);
  assert.equal(parseGrantRoleArguments(['--email', 'reader@example.com', '--role', 'user']), null);
  assert.equal(parseGrantRoleArguments(['--email', 'reader@example.com']), null);
  assert.equal(parseGrantRoleArguments(['--email', 'a@example.com', '--email', 'b@example.com', '--role', 'admin']), null);
});

test('role grant only promotes an active, email-verified existing account', async () => {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: 'user-id', email: 'reader@example.com', role: 'admin' }] };
    },
  };

  const account = await grantVerifiedAccountRole(database, {
    email: 'reader@example.com', role: 'admin',
  });

  assert.deepEqual(account, { id: 'user-id', email: 'reader@example.com', role: 'admin' });
  assert.deepEqual(calls[0].values, ['admin', 'reader@example.com']);
  assert.match(calls[0].sql, /is_active = true/);
  assert.match(calls[0].sql, /email_verified_at IS NOT NULL/);
  assert.match(calls[0].sql, /WHERE email = \$2/);
  assert.doesNotMatch(calls[0].sql, /password|secret/i);
});

test('role grant reports no account for unknown or unverified emails without fallback creation', async () => {
  let writes = 0;
  const database = {
    async query() { writes += 1; return { rows: [] }; },
  };

  assert.equal(await grantVerifiedAccountRole(database, {
    email: 'new@example.com', role: 'author',
  }), null);
  assert.equal(writes, 1);
});
