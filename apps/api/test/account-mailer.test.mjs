import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../dist/config/env.js';
import { createAccountMailer } from '../dist/services/account-mailer.js';

function config(extra = {}) {
  return parseEnvironment({
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'readlite@example.test',
    APP_PUBLIC_URL: 'https://api.example.test',
    SMTP_USER: 'test-user',
    SMTP_PASSWORD: 'test-password',
    ...extra,
  });
}
test('mailer: disabled SMTP creates no transport; development keeps existing recovery logs', async () => {
  const logs = [];
  const mailer = createAccountMailer(
    parseEnvironment({}),
    () => {
      throw new Error('must not create transport');
    },
    { info: (message) => logs.push(message) },
  );
  await mailer.sendVerification({ email: 'reader@example.test', token: 'verification-test-token' });
  await mailer.sendPasswordReset({ email: 'reader@example.test', token: 'reset-test-token' });
  assert.match(
    logs[0],
    /http:\/\/localhost:3000\/api\/v1\/auth\/verify-email\?token=verification-test-token/,
  );
  assert.equal(logs[1], 'Token đặt lại mật khẩu dùng khi phát triển: reset-test-token');
});
test('mailer: production without SMTP never prints tokens', async () => {
  const logs = [];
  const production = parseEnvironment({
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    AUTH_ACCESS_SECRET: 'a'.repeat(40),
    READLITE_MEDIA_DIR: 'C:/readlite/media',
  });
  const mailer = createAccountMailer(
    production,
    () => {
      throw new Error('must not create transport');
    },
    { info: (message) => logs.push(message) },
  );
  await mailer.sendVerification({ email: 'reader@example.test', token: 'verification-secret' });
  await mailer.sendPasswordReset({ email: 'reader@example.test', token: 'reset-secret' });
  assert.deepEqual(logs, []);
});
test('mailer: injected SMTP receives safe plain text mail with correct URL, expiry and no filesystem access', async () => {
  const messages = [],
    logs = [];
  let options;
  const mailer = createAccountMailer(
    config(),
    (value) => {
      options = value;
      return {
        async sendMail(message) {
          messages.push(message);
        },
      };
    },
    { info: (message) => logs.push(message) },
  );
  await mailer.sendVerification({ email: 'reader@example.test', token: 'abc_token' });
  await mailer.sendPasswordReset({ email: 'reader@example.test', token: 'xyz_token' });
  assert.equal(options.host, 'smtp.example.test');
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.deepEqual(options.auth, { user: 'test-user', pass: 'test-password' });
  assert.equal(messages[0].to, 'reader@example.test');
  assert.equal(messages[0].from, 'readlite@example.test');
  assert.match(
    messages[0].text,
    /https:\/\/api.example.test\/api\/v1\/auth\/verify-email\?token=abc_token/,
  );
  assert.match(messages[0].text, /24 giờ/);
  assert.match(
    messages[1].text,
    /https:\/\/api.example.test\/api\/v1\/auth\/reset-password\?token=xyz_token/,
  );
  assert.match(messages[1].text, /30 phút/);
  assert.deepEqual(logs, []);
});
test('mailer: production requires STARTTLS unless configured for immediate TLS', () => {
  for (const secure of ['false', 'true']) {
    let options;
    createAccountMailer(
      config({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        AUTH_ACCESS_SECRET: 'a'.repeat(40),
        READLITE_MEDIA_DIR: 'C:/readlite/media',
        SMTP_SECURE: secure,
      }),
      (value) => {
        options = value;
        return { async sendMail() {} };
      },
    );
    assert.equal(options.secure, secure === 'true');
    assert.equal(options.requireTLS, secure === 'false');
    assert.equal(options.tls?.rejectUnauthorized, undefined);
  }
});
test('mailer: SMTP failures reject so callers can recover without pretending delivery', async () => {
  const mailer = createAccountMailer(config(), () => ({
    async sendMail() {
      throw new Error('test transport unavailable');
    },
  }));
  await assert.rejects(
    mailer.sendVerification({ email: 'reader@example.test', token: 'test-token' }),
    /transport unavailable/,
  );
});
test('SMTP config: blank Compose variables keep SMTP disabled', () => {
  assert.equal(
    parseEnvironment({
      SMTP_HOST: '',
      SMTP_FROM: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      APP_PUBLIC_URL: '',
    }).email,
    undefined,
  );
});
test('SMTP config: requires sender, public API origin, paired credentials and production HTTPS', () => {
  for (const values of [
    { SMTP_HOST: 'smtp.example.test' },
    {
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'x@example.test',
      APP_PUBLIC_URL: 'https://example.test/api',
    },
    { SMTP_USER: 'account', SMTP_PASSWORD: '' },
    { SMTP_PORT: '0' },
    { SMTP_SECURE: 'invalid' },
    {
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      AUTH_ACCESS_SECRET: 'a'.repeat(40),
      READLITE_MEDIA_DIR: 'C:/readlite/media',
      SMTP_HOST: 'host',
      SMTP_FROM: 'x@example.test',
      APP_PUBLIC_URL: 'http://example.test',
    },
  ]) {
    assert.throws(() => parseEnvironment(values), /Cấu hình môi trường không hợp lệ/);
  }
  assert.throws(
    () => config({ SMTP_PORT: 'do-not-expose-secret-value' }),
    (error) => !error.message.includes('do-not-expose-secret-value'),
  );
});
