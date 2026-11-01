import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after, test } from 'node:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import express from 'express';
import { app } from '../dist/app.js';
import { env, parseEnvironment } from '../dist/config/env.js';
import { errorHandler } from '../dist/middleware/error-handler.js';
import { loginSchema, registerSchema } from '../dist/validation/auth.js';
import { createHash, randomUUID } from 'node:crypto';
import { pool } from '../dist/db/pool.js';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';

const servers = [];

async function startServer(application) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = application.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Không lấy được cổng kiểm tra API.');
  }

  servers.push(server);
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function getAvailablePort() {
  const server = createServer();
  const address = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });

  if (address === null || typeof address === 'string') {
    throw new Error('Không lấy được cổng kiểm tra API.');
  }

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

after(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );

  await pool.end();
});

test('cấu hình local có giá trị mặc định hợp lệ', () => {
  assert.deepEqual(parseEnvironment({}), {
    nodeEnv: 'development',
    port: 3000,
    databaseUrl: 'postgres://readlite:readlite_local@postgres:5432/readlite',
    authAccessSecret:
      'readlite-local-access-secret-change-before-deploy-2026',
    corsOrigins: ['http://localhost:8080', 'http://localhost:5173'],
    cookieSecure: false,
    mediaDirectory: resolve(homedir(), '.readlite', 'media'),
    aiReviewProvider: undefined,
    aiReviewApiUrl: undefined,
    aiReviewApiKey: undefined,
    aiReviewModel: undefined,
    aiReviewTimeoutMs: 45_000,
    aiReviewMaxChunkCharacters: 10_000,
    aiReviewMaxAttempts: 5,
    aiReviewLeaseSeconds: 120,
    aiReviewRetryBaseSeconds: 10,
    aiReviewPollIntervalMs: 3_000,
  });
});

test('cấu hình sai dừng với thông báo tiếng Việt và không lộ giá trị đầu vào', () => {
  assert.throws(
    () => parseEnvironment({ PORT: 'khong-phai-so' }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Cấu hình môi trường không hợp lệ/);
      assert.doesNotMatch(error.message, /khong-phai-so/);
      return true;
    },
  );
});

test('GET /api/v1/health trả JSON báo API sẵn sàng', async () => {
  const { origin } = await startServer(app);
  const response = await fetch(`${origin}/api/v1/health`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'api' });
});

test('đường dẫn API không tồn tại trả lỗi 404 dạng JSON', async () => {
  const { origin } = await startServer(app);
  const response = await fetch(`${origin}/api/v1/khong-co`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
  });
});

test('JSON gửi lên sai cú pháp trả lỗi 400 dạng JSON', async () => {
  const parsingApp = express();
  parsingApp.use(express.json());
  parsingApp.post('/du-lieu', (_request, response) => response.sendStatus(204));
  parsingApp.use(errorHandler);
  const { origin } = await startServer(parsingApp);
  const response = await fetch(`${origin}/du-lieu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"x":',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: 'INVALID_REQUEST', message: 'Dữ liệu gửi lên không hợp lệ.' },
  });
});

test('lỗi ngoài dự kiến trả JSON chung và không lộ chi tiết nội bộ', async () => {
  const failingApp = express();
  failingApp.get('/loi', (_request, _response, next) => next(new Error('gia-tri-bi-mat')));
  failingApp.use(errorHandler);
  const { origin } = await startServer(failingApp);
  const response = await fetch(`${origin}/loi`);
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.doesNotMatch(body, /gia-tri-bi-mat|stack/i);
  assert.deepEqual(JSON.parse(body), {
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Đã xảy ra lỗi hệ thống.' },
  });
});

test('API không mở cổng nếu migration cơ sở dữ liệu thất bại', { timeout: 8_000 }, async () => {
  const port = await getAvailablePort();
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: 'postgres://readlite:secret-marker@127.0.0.1:1/readlite',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (output += chunk));

  const exit = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2_500);
    child.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ code: null, error });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  if (exit === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }

  assert.ok(exit, 'API phải dừng khi migration không kết nối được cơ sở dữ liệu.');
  assert.equal(exit.code, 1);
  assert.match(output, /Không thể chạy migration PostgreSQL/);
  assert.doesNotMatch(output, /secret-marker|API đang lắng nghe/);
});

const validRegisterInput = {
  email: '  Reader@Example.com ',
  username: '  ReadLite  ',
  password: '12345678',
  displayName: '  Người đọc  ',
};

test('dữ liệu đăng ký hợp lệ được chuẩn hóa', () => {
  assert.deepEqual(registerSchema.parse(validRegisterInput), {
    email: 'reader@example.com',
    username: 'readlite',
    password: '12345678',
    displayName: 'Người đọc',
  });
});

test('đăng ký từ chối email sai hoặc tên người dùng ngoài giới hạn', () => {
  const invalidInputs = [
    { ...validRegisterInput, email: 'khong-phai-email' },
    { ...validRegisterInput, username: 'abc' },
    { ...validRegisterInput, username: 'a'.repeat(21) },
    { ...validRegisterInput, username: '   ' },
  ];

  for (const input of invalidInputs) {
    assert.equal(registerSchema.safeParse(input).success, false);
  }
});

test('đăng ký từ chối mật khẩu ngắn hơn 8 ký tự', () => {
  assert.equal(
    registerSchema.safeParse({
      ...validRegisterInput,
      password: '1234567',
    }).success,
    false,
  );
});

test('đăng ký từ chối mật khẩu vượt giới hạn 72 byte của bcrypt', () => {
  assert.equal(
    registerSchema.safeParse({
      ...validRegisterInput,
      password: 'a'.repeat(73),
    }).success,
    false,
  );
});

test('tên hiển thị không được để trống', () => {
  assert.equal(
    registerSchema.safeParse({
      ...validRegisterInput,
      displayName: '   ',
    }).success,
    false,
  );
});

test('POST /api/v1/auth/register từ chối dữ liệu không hợp lệ', async () => {
  const { origin } = await startServer(app);
  const response = await fetch(`${origin}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'email-sai',
      username: 'abc',
      password: '123',
      displayName: '',
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INVALID_REQUEST',
      message: 'Dữ liệu gửi lên không hợp lệ.',
    },
  });
});

test('POST /api/v1/auth/register tạo tài khoản chưa xác minh và không lộ mật khẩu', async () => {
  const suffix = randomUUID();
  const email = `readlite-${suffix}@example.test`;
  const username = `reader${suffix.slice(0, 8)}`;
  const password = 'Password-Test-123';
  const { origin } = await startServer(app);

  try {
    const response = await fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        username,
        password,
        displayName: 'Người đọc thử',
      }),
    });

    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.user.email, email);
    assert.equal(body.user.username, username);
    assert.equal(body.user.displayName, 'Người đọc thử');
    assert.equal(body.user.emailVerified, false);
    assert.deepEqual(Object.keys(body.user).sort(), [
      'displayName',
      'email',
      'emailVerified',
      'id',
      'username',
    ]);

    const userResult = await pool.query(
      `SELECT id, password_hash, email_verified_at
       FROM users
       WHERE email = $1`,
      [email],
    );

    assert.equal(userResult.rowCount, 1);
    assert.match(userResult.rows[0].password_hash, /^\$2[aby]\$12\$/);
    assert.notEqual(userResult.rows[0].password_hash, password);
    assert.equal(userResult.rows[0].email_verified_at, null);

    const verificationResult = await pool.query(
      `SELECT token_hash, expires_at, used_at
       FROM email_verifications
       WHERE user_id = $1`,
      [userResult.rows[0].id],
    );

    assert.equal(verificationResult.rowCount, 1);
    assert.match(verificationResult.rows[0].token_hash, /^[a-f0-9]{64}$/);
    assert.ok(verificationResult.rows[0].expires_at > new Date());
    assert.equal(verificationResult.rows[0].used_at, null);

    const settingsResult = await pool.query(
      'SELECT 1 FROM user_settings WHERE user_id = $1',
      [userResult.rows[0].id],
    );

    assert.equal(settingsResult.rowCount, 1);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('đăng ký với email đã tồn tại trả 409 và không tạo tài khoản thứ hai', async () => {
  const suffix = randomUUID();
  const email = `duplicate-${suffix}@example.test`;
  const existingUsername = `reader${suffix.slice(0, 8)}`;
  const attemptedUsername = `other${suffix.slice(0, 8)}`;
  const { origin } = await startServer(app);

  await pool.query(
    `INSERT INTO users (email, username, password_hash, display_name)
     VALUES ($1, $2, $3, $4)`,
    [email, existingUsername, 'test-only-hash', 'Tài khoản thử'],
  );

  try {
    const response = await fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        username: attemptedUsername,
        password: 'Password-Test-123',
        displayName: 'Tài khoản trùng email',
      }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'ACCOUNT_ALREADY_EXISTS',
        message: 'Email hoặc tên người dùng đã được sử dụng.',
      },
    });

    const count = await pool.query(
      'SELECT count(*)::int AS count FROM users WHERE email = $1',
      [email],
    );
    assert.equal(count.rows[0].count, 1);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('đăng ký với username đã tồn tại trả 409 và không lưu email mới', async () => {
  const suffix = randomUUID();
  const existingEmail = `existing-${suffix}@example.test`;
  const attemptedEmail = `new-${suffix}@example.test`;
  const username = `reader${suffix.slice(0, 8)}`;
  const { origin } = await startServer(app);

  await pool.query(
    `INSERT INTO users (email, username, password_hash, display_name)
     VALUES ($1, $2, $3, $4)`,
    [existingEmail, username, 'test-only-hash', 'Tài khoản thử'],
  );

  try {
    const response = await fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: attemptedEmail,
        username,
        password: 'Password-Test-123',
        displayName: 'Tài khoản trùng username',
      }),
    });

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'ACCOUNT_ALREADY_EXISTS',
        message: 'Email hoặc tên người dùng đã được sử dụng.',
      },
    });

    const count = await pool.query(
      'SELECT count(*)::int AS count FROM users WHERE email = $1',
      [attemptedEmail],
    );
    assert.equal(count.rows[0].count, 0);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [existingEmail]);
  }
});

test('xác minh email bằng token hợp lệ và từ chối dùng lại token', async () => {
  const suffix = randomUUID();
  const email = `verify-${suffix}@example.test`;
  const username = `reader${suffix.slice(0, 8)}`;
  const rawToken = `verify-${suffix}`;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const { origin } = await startServer(app);

  try {
    const userResult = await pool.query(
      `INSERT INTO users (email, username, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [email, username, 'test-only-hash', 'Tài khoản thử'],
    );

    const userId = userResult.rows[0].id;

    await pool.query(
      `INSERT INTO email_verifications (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, new Date(Date.now() + 60 * 60 * 1000)],
    );

    const verifyUrl = new URL('/api/v1/auth/verify-email', origin);
    verifyUrl.searchParams.set('token', rawToken);

    const response = await fetch(verifyUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: 'Email đã được xác minh.',
    });

    const userState = await pool.query(
      'SELECT email_verified_at FROM users WHERE id = $1',
      [userId],
    );
    assert.ok(userState.rows[0].email_verified_at instanceof Date);

    const verificationState = await pool.query(
      'SELECT used_at FROM email_verifications WHERE token_hash = $1',
      [tokenHash],
    );
    assert.ok(verificationState.rows[0].used_at instanceof Date);

    const replayResponse = await fetch(verifyUrl);
    assert.equal(replayResponse.status, 400);
    assert.deepEqual(await replayResponse.json(), {
      error: {
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.',
      },
    });
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  }
});

test('xác minh email từ chối token quá ngắn', async () => {
  const { origin } = await startServer(app);
  const response = await fetch(
    `${origin}/api/v1/auth/verify-email?token=bad`,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INVALID_REQUEST',
      message: 'Dữ liệu gửi lên không hợp lệ.',
    },
  });
});

test('dữ liệu đăng nhập chuẩn hóa email và giữ nguyên mật khẩu', () => {
  assert.deepEqual(
    loginSchema.parse({
      email: '  Reader@Example.com ',
      password: 'Password-Test-123',
    }),
    {
      email: 'reader@example.com',
      password: 'Password-Test-123',
    },
  );
});

test('đăng nhập từ chối email sai, mật khẩu rỗng hoặc vượt giới hạn bcrypt', () => {
  const invalidInputs = [
    { email: 'email-sai', password: 'Password-Test-123' },
    { email: 'reader@example.com', password: '' },
    { email: 'reader@example.com', password: 'a'.repeat(73) },
  ];

  for (const input of invalidInputs) {
    assert.equal(loginSchema.safeParse(input).success, false);
  }
});

test('đăng nhập trả cùng lỗi cho email lạ, sai mật khẩu và email chưa xác minh', async () => {
  const suffix = randomUUID();
  const verifiedEmail = `verified-${suffix}@example.test`;
  const unverifiedEmail = `unverified-${suffix}@example.test`;
  const password = 'Correct-Test-Password';
  const passwordHash = await bcrypt.hash(password, 12);
  const { origin } = await startServer(app);

  try {
    await pool.query(
      `INSERT INTO users (
         email, username, password_hash, display_name, email_verified_at
       )
       VALUES
         ($1, $2, $3, $4, now()),
         ($5, $6, $3, $7, NULL)`,
      [
        verifiedEmail,
        `verified${suffix.slice(0, 8)}`,
        passwordHash,
        'Tài khoản đã xác minh',
        unverifiedEmail,
        `unverified${suffix.slice(0, 8)}`,
        'Tài khoản chưa xác minh',
      ],
    );

    const attempts = [
      {
        email: `missing-${suffix}@example.test`,
        password: 'Wrong-Test-Password',
      },
      {
        email: verifiedEmail,
        password: 'Wrong-Test-Password',
      },
      {
        email: unverifiedEmail,
        password,
      },
    ];

    let expectedError;

    for (const credentials of attempts) {
      const response = await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      assert.equal(response.status, 401);

      const body = await response.json();
      assert.deepEqual(body, {
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email hoặc mật khẩu không đúng.',
        },
      });

      if (expectedError) {
        assert.deepEqual(body, expectedError);
      } else {
        expectedError = body;
      }
    }
  } finally {
    await pool.query(
      'DELETE FROM users WHERE email IN ($1, $2)',
      [verifiedEmail, unverifiedEmail],
    );
  }
});

test('đăng nhập hợp lệ cấp access JWT và lưu refresh token dạng hash', async () => {
  const suffix = randomUUID();
  const email = `login-${suffix}@example.test`;
  const username = `login${suffix.slice(0, 8)}`;
  const password = 'Correct-Login-Password';
  const passwordHash = await bcrypt.hash(password, 12);
  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản đăng nhập thử'],
  );
  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const response = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.user.id, userId);
    assert.equal(body.user.email, email);
    assert.equal(body.user.emailVerified, true);
    assert.equal('password_hash' in body.user, false);
    assert.equal(typeof body.csrfToken, 'string');
    assert.ok(body.csrfToken.length >= 32);

    const setCookies = response.headers.getSetCookie();
    const accessCookie = setCookies.find((cookie) =>
      cookie.startsWith('readlite_access='),
    );
    const refreshCookie = setCookies.find((cookie) =>
      cookie.startsWith('readlite_refresh='),
    );
    const csrfCookie = setCookies.find((cookie) =>
      cookie.startsWith('readlite_csrf='),
    );

    assert.ok(accessCookie, 'Phải có access cookie.');
    assert.ok(refreshCookie, 'Phải có refresh cookie.');
    assert.ok(csrfCookie, 'Phải có CSRF cookie.');
    assert.match(csrfCookie, /;\s*SameSite=Lax\b/i);
    assert.match(csrfCookie, /;\s*Path=\/api\/v1(?:;|$)/i);
    assert.doesNotMatch(csrfCookie, /;\s*HttpOnly\b/i);

    const csrfTokenFromCookie = csrfCookie
      .split(';', 1)[0]
      .slice('readlite_csrf='.length);

    assert.equal(body.csrfToken, csrfTokenFromCookie);
    assert.match(accessCookie, /;\s*HttpOnly\b/i);
    assert.match(accessCookie, /;\s*SameSite=Lax\b/i);
    assert.match(accessCookie, /;\s*Path=\/api\/v1(?:;|$)/i);
    assert.match(refreshCookie, /;\s*HttpOnly\b/i);
    assert.match(refreshCookie, /;\s*SameSite=Lax\b/i);
    assert.match(refreshCookie, /;\s*Path=\/api\/v1\/auth(?:;|$)/i);

    const accessToken = accessCookie
      .split(';', 1)[0]
      .slice('readlite_access='.length);
    const refreshToken = refreshCookie
      .split(';', 1)[0]
      .slice('readlite_refresh='.length);

    const { payload } = await jwtVerify(
      accessToken,
      new TextEncoder().encode(env.authAccessSecret),
    );
    assert.equal(payload.sub, userId);
    assert.equal(payload.email, email);

    const storedToken = await pool.query(
      `SELECT token_hash, expires_at
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    assert.equal(storedToken.rowCount, 1);
    assert.equal(
      storedToken.rows[0].token_hash,
      createHash('sha256').update(refreshToken).digest('hex'),
    );
    assert.ok(storedToken.rows[0].expires_at > new Date());
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('GET /api/v1/auth/me từ chối khi thiếu access cookie', async () => {
  const { origin } = await startServer(app);
  const response = await fetch(`${origin}/api/v1/auth/me`);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập để tiếp tục.',
    },
  });
});

test('GET /api/v1/auth/me trả tài khoản từ access cookie hợp lệ', async () => {
  const suffix = randomUUID();
  const email = `me-${suffix}@example.test`;
  const username = `me${suffix.slice(0, 8)}`;
  const password = 'Correct-Me-Password';
  const passwordHash = await bcrypt.hash(password, 12);
  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản kiểm tra me'],
  );
  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginResponse.status, 200);

    const accessCookie = loginResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('readlite_access='));

    assert.ok(accessCookie, 'Đăng nhập phải cấp access cookie.');

    const response = await fetch(`${origin}/api/v1/auth/me`, {
      headers: {
        cookie: accessCookie.split(';', 1)[0],
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      user: {
        id: userId,
        email,
        username,
        displayName: 'Tài khoản kiểm tra me',
        role: 'user',
        emailVerified: true,
      },
    });
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('POST /api/v1/auth/logout yêu cầu CSRF và thu hồi refresh token', async () => {
  const suffix = randomUUID();
  const email = `logout-${suffix}@example.test`;
  const username = `logout${suffix.slice(0, 8)}`;
  const password = 'Correct-Logout-Password';
  const passwordHash = await bcrypt.hash(password, 12);
  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản đăng xuất thử'],
  );
  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginResponse.status, 200);

    const setCookies = loginResponse.headers.getSetCookie();
    const accessCookie = setCookies.find((cookie) =>
      cookie.startsWith('readlite_access='),
    );
    const refreshCookie = setCookies.find((cookie) =>
      cookie.startsWith('readlite_refresh='),
    );
    const csrfCookie = setCookies.find((cookie) =>
      cookie.startsWith('readlite_csrf='),
    );

    assert.ok(accessCookie);
    assert.ok(refreshCookie);
    assert.ok(csrfCookie);

    const cookieHeader = [accessCookie, refreshCookie, csrfCookie]
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');
    const csrfToken = csrfCookie
      .split(';', 1)[0]
      .slice('readlite_csrf='.length);
    const refreshToken = refreshCookie
      .split(';', 1)[0]
      .slice('readlite_refresh='.length);
    const refreshTokenHash = createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const missingCsrfResponse = await fetch(
      `${origin}/api/v1/auth/logout`,
      {
        method: 'POST',
        headers: { cookie: cookieHeader },
      },
    );

    assert.equal(missingCsrfResponse.status, 403);
    assert.deepEqual(await missingCsrfResponse.json(), {
      error: {
        code: 'CSRF_INVALID',
        message: 'Yêu cầu không hợp lệ.',
      },
    });

    const logoutResponse = await fetch(`${origin}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
      },
    });

    assert.equal(logoutResponse.status, 204);

    const tokenResult = await pool.query(
      `SELECT revoked_at
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [refreshTokenHash],
    );

    assert.equal(tokenResult.rowCount, 1);
    assert.ok(tokenResult.rows[0].revoked_at instanceof Date);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('POST /api/v1/auth/refresh xoay token, yêu cầu CSRF và từ chối phát lại token cũ', async () => {
  const suffix = randomUUID();
  const email = `refresh-${suffix}@example.test`;
  const username = `refresh${suffix.slice(0, 8)}`;
  const password = 'Correct-Refresh-Password';
  const passwordHash = await bcrypt.hash(password, 12);
  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản refresh thử'],
  );
  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    assert.equal(loginResponse.status, 200);

    const loginCookies = loginResponse.headers.getSetCookie();
    const accessCookie = loginCookies.find((cookie) =>
      cookie.startsWith('readlite_access='),
    );
    const refreshCookie = loginCookies.find((cookie) =>
      cookie.startsWith('readlite_refresh='),
    );
    const csrfCookie = loginCookies.find((cookie) =>
      cookie.startsWith('readlite_csrf='),
    );

    assert.ok(accessCookie);
    assert.ok(refreshCookie);
    assert.ok(csrfCookie);

    const originalRefreshToken = refreshCookie
      .split(';', 1)[0]
      .slice('readlite_refresh='.length);
    const originalRefreshCookiePair = refreshCookie.split(';', 1)[0];
    const originalRefreshHash = createHash('sha256')
      .update(originalRefreshToken)
      .digest('hex');
    const originalCsrfToken = csrfCookie
      .split(';', 1)[0]
      .slice('readlite_csrf='.length);
    const originalCookieHeader = [
      accessCookie,
      refreshCookie,
      csrfCookie,
    ]
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');

    const missingCsrfResponse = await fetch(
      `${origin}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: { cookie: originalCookieHeader },
      },
    );

    assert.equal(missingCsrfResponse.status, 403);

    const refreshResponse = await fetch(
      `${origin}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: {
          cookie: originalCookieHeader,
          'x-csrf-token': originalCsrfToken,
        },
      },
    );

    assert.equal(refreshResponse.status, 200);

    const body = await refreshResponse.json();
    assert.equal(body.user.id, userId);
    assert.equal(body.user.email, email);

    const refreshedCookies = refreshResponse.headers.getSetCookie();
    const newAccessCookie = refreshedCookies.find((cookie) =>
      cookie.startsWith('readlite_access='),
    );
    const newRefreshCookie = refreshedCookies.find((cookie) =>
      cookie.startsWith('readlite_refresh='),
    );
    const newCsrfCookie = refreshedCookies.find((cookie) =>
      cookie.startsWith('readlite_csrf='),
    );

    assert.ok(newAccessCookie);
    assert.ok(newRefreshCookie);
    assert.ok(newCsrfCookie);

    const newRefreshToken = newRefreshCookie
      .split(';', 1)[0]
      .slice('readlite_refresh='.length);
    const newCsrfToken = newCsrfCookie
      .split(';', 1)[0]
      .slice('readlite_csrf='.length);
    const newRefreshHash = createHash('sha256')
      .update(newRefreshToken)
      .digest('hex');

    assert.notEqual(newRefreshToken, originalRefreshToken);
    assert.equal(body.csrfToken, newCsrfToken);

    const oldTokenResult = await pool.query(
      'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [originalRefreshHash],
    );
    assert.ok(oldTokenResult.rows[0].revoked_at instanceof Date);

    const newTokenResult = await pool.query(
      `SELECT id
       FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [newRefreshHash],
    );
    assert.equal(newTokenResult.rowCount, 1);

    const replayCookieHeader = [
      newAccessCookie,
      originalRefreshCookiePair,
      newCsrfCookie,
    ]
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');

    const replayResponse = await fetch(
      `${origin}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: {
          cookie: replayCookieHeader,
          'x-csrf-token': newCsrfToken,
        },
      },
    );

    assert.equal(replayResponse.status, 401);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('POST /api/v1/auth/logout-all thu hồi mọi phiên của tài khoản', async () => {
  const suffix = randomUUID();
  const email = `logout-all-${suffix}@example.test`;
  const username = `all${suffix.slice(0, 10)}`;
  const password = 'Correct-Logout-All-Password';
  const passwordHash = await bcrypt.hash(password, 12);
  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản đăng xuất mọi thiết bị'],
  );
  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    let currentCookieHeader = '';
    let currentCsrfToken = '';

    for (let index = 0; index < 2; index += 1) {
      const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      assert.equal(loginResponse.status, 200);

      const cookies = loginResponse.headers.getSetCookie();
      const accessCookie = cookies.find((cookie) =>
        cookie.startsWith('readlite_access='),
      );
      const refreshCookie = cookies.find((cookie) =>
        cookie.startsWith('readlite_refresh='),
      );
      const csrfCookie = cookies.find((cookie) =>
        cookie.startsWith('readlite_csrf='),
      );

      assert.ok(accessCookie);
      assert.ok(refreshCookie);
      assert.ok(csrfCookie);

      if (index === 1) {
        currentCookieHeader = [
          accessCookie,
          refreshCookie,
          csrfCookie,
        ]
          .map((cookie) => cookie.split(';', 1)[0])
          .join('; ');

        currentCsrfToken = csrfCookie
          .split(';', 1)[0]
          .slice('readlite_csrf='.length);
      }
    }

    const activeBefore = await pool.query(
      `SELECT count(*)::int AS count
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    assert.equal(activeBefore.rows[0].count, 2);

    const missingCsrfResponse = await fetch(
      `${origin}/api/v1/auth/logout-all`,
      {
        method: 'POST',
        headers: { cookie: currentCookieHeader },
      },
    );
    assert.equal(missingCsrfResponse.status, 403);

    const logoutResponse = await fetch(
      `${origin}/api/v1/auth/logout-all`,
      {
        method: 'POST',
        headers: {
          cookie: currentCookieHeader,
          'x-csrf-token': currentCsrfToken,
        },
      },
    );

    assert.equal(logoutResponse.status, 204);

    const activeAfter = await pool.query(
      `SELECT count(*)::int AS count
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    assert.equal(activeAfter.rows[0].count, 0);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('POST /api/v1/auth/forgot-password không tiết lộ email có tài khoản', async () => {
  const suffix = randomUUID();
  const email = `forgot-${suffix}@example.test`;
  const username = `forgot${suffix.slice(0, 10)}`;
  const passwordHash = await bcrypt.hash('Forgot-Password-Test-123', 12);

  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản thử quên mật khẩu'],
  );

  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const knownEmailResponse = await fetch(
      `${origin}/api/v1/auth/forgot-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      },
    );

    const unknownEmailResponse = await fetch(
      `${origin}/api/v1/auth/forgot-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `missing-${suffix}@example.test` }),
      },
    );

    assert.equal(knownEmailResponse.status, 202);
    assert.equal(unknownEmailResponse.status, 202);

    const knownEmailBody = await knownEmailResponse.json();
    const unknownEmailBody = await unknownEmailResponse.json();

    assert.deepEqual(knownEmailBody, unknownEmailBody);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('POST /api/v1/auth/reset-password đổi mật khẩu, thu hồi phiên và từ chối dùng lại token', async () => {
  const suffix = randomUUID();
  const email = `reset-${suffix}@example.test`;
  const username = `reset${suffix.slice(0, 10)}`;
  const oldPassword = 'Old-Reset-Password-123';
  const newPassword = 'New-Reset-Password-456';
  const passwordHash = await bcrypt.hash(oldPassword, 12);

  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản đặt lại mật khẩu'],
  );

  const userId = userResult.rows[0].id;
  const { origin } = await startServer(app);
  const originalConsoleInfo = console.info;
  let resetToken = '';

  console.info = (message) => {
    const text = String(message);
    const prefix = 'Token đặt lại mật khẩu dùng khi phát triển: ';
    if (text.startsWith(prefix)) {
      resetToken = text.slice(prefix.length);
    }
  };

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: oldPassword }),
    });
    assert.equal(loginResponse.status, 200);

    const forgotResponse = await fetch(
      `${origin}/api/v1/auth/forgot-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      },
    );

    assert.equal(forgotResponse.status, 202);
    assert.ok(resetToken.length >= 32, 'Phải lấy được token từ log development.');

    const storedToken = await pool.query(
      `SELECT token_hash, expires_at, used_at
       FROM password_resets
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [userId],
    );

    assert.equal(
      storedToken.rows[0].token_hash,
      createHash('sha256').update(resetToken).digest('hex'),
    );
    assert.ok(storedToken.rows[0].expires_at > new Date());
    assert.equal(storedToken.rows[0].used_at, null);

    const invalidResponse = await fetch(
      `${origin}/api/v1/auth/reset-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: 'x'.repeat(43),
          password: newPassword,
        }),
      },
    );
    assert.equal(invalidResponse.status, 400);

    const resetResponse = await fetch(
      `${origin}/api/v1/auth/reset-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      },
    );

    assert.equal(resetResponse.status, 200);

    const updatedUser = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    assert.equal(
      await bcrypt.compare(newPassword, updatedUser.rows[0].password_hash),
      true,
    );
    assert.equal(
      await bcrypt.compare(oldPassword, updatedUser.rows[0].password_hash),
      false,
    );

    const activeSessions = await pool.query(
      `SELECT count(*)::int AS count
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    assert.equal(activeSessions.rows[0].count, 0);

    const replayResponse = await fetch(
      `${origin}/api/v1/auth/reset-password`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      },
    );
    assert.equal(replayResponse.status, 400);
  } finally {
    console.info = originalConsoleInfo;
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
});

test('PATCH /api/v1/auth/me yêu cầu CSRF, cập nhật hồ sơ và từ chối username trùng', async () => {
  const suffix = randomUUID();
  const email = `profile-${suffix}@example.test`;
  const username = `profile${suffix.slice(0, 8)}`;
  const otherEmail = `profile-other-${suffix}@example.test`;
  const otherUsername = `taken${suffix.slice(0, 8)}`;
  const password = 'Profile-Password-123';
  const passwordHash = await bcrypt.hash(password, 12);

  const firstUser = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tên ban đầu'],
  );
  const userId = firstUser.rows[0].id;

  const secondUser = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [otherEmail, otherUsername, passwordHash, 'Tài khoản khác'],
  );
  const otherUserId = secondUser.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginResponse.status, 200);

    const cookies = loginResponse.headers.getSetCookie();
    const accessCookie = cookies.find((cookie) =>
      cookie.startsWith('readlite_access='),
    );
    const csrfCookie = cookies.find((cookie) =>
      cookie.startsWith('readlite_csrf='),
    );
    assert.ok(accessCookie);
    assert.ok(csrfCookie);

    const cookieHeader = [accessCookie, csrfCookie]
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');
    const csrfToken = csrfCookie
      .split(';', 1)[0]
      .slice('readlite_csrf='.length);

    const missingCsrf = await fetch(`${origin}/api/v1/auth/me`, {
      method: 'PATCH',
      headers: {
        cookie: cookieHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'Tên mới' }),
    });
    assert.equal(missingCsrf.status, 403);

    const updateResponse = await fetch(`${origin}/api/v1/auth/me`, {
      method: 'PATCH',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: `updated${suffix.slice(0, 8)}`,
        displayName: 'Tên đã cập nhật',
      }),
    });

    assert.equal(updateResponse.status, 200);
    const updatedBody = await updateResponse.json();
    assert.equal(updatedBody.user.displayName, 'Tên đã cập nhật');
    assert.equal(updatedBody.user.username, `updated${suffix.slice(0, 8)}`);

    const duplicateResponse = await fetch(`${origin}/api/v1/auth/me`, {
      method: 'PATCH',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: otherUsername }),
    });
    assert.equal(duplicateResponse.status, 409);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
  }
});

test('DELETE /api/v1/auth/me yêu cầu CSRF và mật khẩu trước khi xóa tài khoản', async () => {
  const suffix = randomUUID();
  const email = `delete-${suffix}@example.test`;
  const username = `delete${suffix.slice(0, 8)}`;
  const password = 'Delete-Account-Password-123';
  const passwordHash = await bcrypt.hash(password, 12);

  const userResult = await pool.query(
    `INSERT INTO users (
       email, username, password_hash, display_name, email_verified_at
     )
     VALUES ($1, $2, $3, $4, now())
     RETURNING id`,
    [email, username, passwordHash, 'Tài khoản sẽ xóa'],
  );
  const userId = userResult.rows[0].id;

  const storyResult = await pool.query(
    `INSERT INTO stories (owner_id, title, visibility, moderation_status, ai_review_status)
     VALUES ($1, $2, 'public', 'published', 'skipped')
     RETURNING id`,
    [userId, `Truyện thử ${suffix}`],
  );
  const storyId = storyResult.rows[0].id;
  const { origin } = await startServer(app);

  try {
    const loginResponse = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginResponse.status, 200);

    const cookies = loginResponse.headers.getSetCookie();
    const accessCookie = cookies.find((cookie) =>
      cookie.startsWith('readlite_access='),
    );
    const csrfCookie = cookies.find((cookie) =>
      cookie.startsWith('readlite_csrf='),
    );
    assert.ok(accessCookie);
    assert.ok(csrfCookie);

    const cookieHeader = [accessCookie, csrfCookie]
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');
    const csrfToken = csrfCookie
      .split(';', 1)[0]
      .slice('readlite_csrf='.length);

    const missingCsrf = await fetch(`${origin}/api/v1/auth/me`, {
      method: 'DELETE',
      headers: {
        cookie: cookieHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(missingCsrf.status, 403);

    const wrongPassword = await fetch(`${origin}/api/v1/auth/me`, {
      method: 'DELETE',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: 'Wrong-Password-123' }),
    });
    assert.equal(wrongPassword.status, 401);

    const deleteResponse = await fetch(`${origin}/api/v1/auth/me`, {
      method: 'DELETE',
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    assert.equal(deleteResponse.status, 204);

    const deletedUser = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId],
    );
    assert.equal(deletedUser.rowCount, 0);

    const preservedStory = await pool.query(
      'SELECT owner_id, visibility FROM stories WHERE id = $1',
      [storyId],
    );
    assert.equal(preservedStory.rows[0].owner_id, null);
    assert.equal(preservedStory.rows[0].visibility, 'private');
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM stories WHERE id = $1', [storyId]);
  }
});

async function createCatalogFixture() {
  const suffix = randomUUID().replaceAll('-', '');
  const userIds = Array.from({ length: 7 }, () => randomUUID());

  for (let index = 0; index < userIds.length; index += 1) {
    await pool.query(
      `INSERT INTO users (
         id, email, username, password_hash, display_name
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userIds[index],
        `g3-${suffix}-${index}@example.test`,
        `cat${suffix.slice(0, 12)}${index}`,
        'test-only-password-hash',
        `Tài khoản G3 ${index}`,
      ],
    );
  }

  const genreResult = await pool.query(
    `INSERT INTO genres (name, slug)
     VALUES ($1, $2)
     RETURNING id, name, slug`,
    [`Fantasy ${suffix}`, `fantasy-${suffix}`],
  );
  const genre = genreResult.rows[0];

  const firstStoryResult = await pool.query(
    `INSERT INTO stories (
       owner_id, title, author, summary, visibility, moderation_status, ai_review_status
     )
     VALUES ($1, $2, $3, $4, 'public', 'published', 'skipped')
     RETURNING id`,
    [
      userIds[0],
      `G3 Catalog ${suffix}`,
      'Tác giả A',
      `Giới thiệu truyện G3 ${suffix}`,
    ],
  );
  const firstStoryId = firstStoryResult.rows[0].id;

  const secondStoryResult = await pool.query(
    `INSERT INTO stories (
       owner_id, title, author, summary, visibility, moderation_status, ai_review_status
     )
     VALUES ($1, $2, $3, $4, 'public', 'published', 'skipped')
     RETURNING id`,
    [
      userIds[0],
      `G3 Other ${suffix}`,
      'Tác giả B',
      `Giới thiệu truyện khác ${suffix}`,
    ],
  );
  const secondStoryId = secondStoryResult.rows[0].id;

  const privateStoryResult = await pool.query(
    `INSERT INTO stories (
       owner_id, title, author, summary, visibility
     )
     VALUES ($1, $2, $3, $4, 'private')
     RETURNING id`,
    [
      userIds[0],
      `G3 Private ${suffix}`,
      'Tác giả riêng',
      'Truyện riêng tư trong dữ liệu thử',
    ],
  );
  const privateStoryId = privateStoryResult.rows[0].id;

  await pool.query(
    `INSERT INTO story_genres (story_id, genre_id)
     VALUES ($1, $3), ($2, $3)`,
    [firstStoryId, secondStoryId, genre.id],
  );

  const daysAgo = (days) =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const firstChapterResult = await pool.query(
    `INSERT INTO chapters (
       story_id, chapter_order, title, content, updated_at
     )
     VALUES ($1, 1, $2, $3, $4)
     RETURNING id`,
    [
      firstStoryId,
      'Chương A',
      'Nội dung chương A để kiểm thử.',
      daysAgo(5),
    ],
  );
  const firstChapterId = firstChapterResult.rows[0].id;

  const secondChapterResult = await pool.query(
    `INSERT INTO chapters (
       story_id, chapter_order, title, content, updated_at
     )
     VALUES ($1, 1, $2, $3, $4)
     RETURNING id`,
    [
      secondStoryId,
      'Chương B',
      'Nội dung chương B để kiểm thử.',
      daysAgo(2),
    ],
  );
  const secondChapterId = secondChapterResult.rows[0].id;

  for (let index = 0; index < 6; index += 1) {
    await pool.query(
      `INSERT INTO reading_progress (
         user_id, story_id, current_chapter_id, position_permille, last_read_at
       )
       VALUES ($1, $2, $3, 500, $4)`,
      [
        userIds[index + 1],
        firstStoryId,
        firstChapterId,
        daysAgo(index === 0 ? 1 : 8 + index),
      ],
    );
  }

  for (let index = 0; index < 3; index += 1) {
    await pool.query(
      `INSERT INTO reading_progress (
         user_id, story_id, current_chapter_id, position_permille, last_read_at
       )
       VALUES ($1, $2, $3, 500, $4)`,
      [userIds[index + 1], secondStoryId, secondChapterId, daysAgo(index + 1)],
    );
  }

  const ratings = [5, 4, 4, 4, 5];

  for (let index = 0; index < ratings.length; index += 1) {
    await pool.query(
      `INSERT INTO reviews (story_id, user_id, rating, content)
       VALUES ($1, $2, $3, '')`,
      [firstStoryId, userIds[index + 1], ratings[index]],
    );
  }

  await pool.query(
    `INSERT INTO reviews (story_id, user_id, rating, content)
     VALUES ($1, $2, 5, '')`,
    [secondStoryId, userIds[6]],
  );

  return {
    userIds,
    genreId: genre.id,
    genreName: genre.name,
    genreSlug: genre.slug,
    firstStoryId,
    secondStoryId,
    privateStoryId,
    firstChapterId,
    secondChapterId,
  };
}

async function deleteCatalogFixture(fixture) {
  await pool.query(
    'DELETE FROM stories WHERE id = ANY($1::bigint[])',
    [[
      fixture.firstStoryId,
      fixture.secondStoryId,
      fixture.privateStoryId,
    ]],
  );

  await pool.query('DELETE FROM genres WHERE id = $1', [
    fixture.genreId,
  ]);

  await pool.query(
    'DELETE FROM users WHERE id = ANY($1::uuid[])',
    [fixture.userIds],
  );
}

test('GET /api/v1/genres tìm thể loại và đếm truyện công khai', async () => {
  const fixture = await createCatalogFixture();

  try {
    const { origin } = await startServer(app);
    const response = await fetch(
      `${origin}/api/v1/genres?q=${encodeURIComponent(fixture.genreName)}`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.genres.length, 1);
    assert.equal(body.genres[0].id, fixture.genreId);
    assert.equal(body.genres[0].name, fixture.genreName);
    assert.equal(body.genres[0].slug, fixture.genreSlug);
    assert.equal(body.genres[0].storyCount, 2);
  } finally {
    await deleteCatalogFixture(fixture);
  }
});

test('GET /api/v1/stories tìm kiếm, lọc thể loại và phân trang', async () => {
  const fixture = await createCatalogFixture();

  try {
    const { origin } = await startServer(app);
    const response = await fetch(
      `${origin}/api/v1/stories?q=${encodeURIComponent('G3 Catalog')}` +
        `&genre=${encodeURIComponent(fixture.genreSlug)}&page=1&limit=1`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.stories.length, 1);
    assert.equal(body.stories[0].id, fixture.firstStoryId);
    assert.deepEqual(body.pagination, {
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });

    const genreResponse = await fetch(
      `${origin}/api/v1/stories?genre=${encodeURIComponent(fixture.genreSlug)}`,
    );
    const genreBody = await genreResponse.json();

    assert.equal(genreResponse.status, 200);
    assert.equal(genreBody.pagination.total, 2);
    assert.ok(
      genreBody.stories.every(
        (story) => story.id !== fixture.privateStoryId,
      ),
    );
  } finally {
    await deleteCatalogFixture(fixture);
  }
});

test('GET /api/v1/stories/:id trả chi tiết và chương truyện', async () => {
  const fixture = await createCatalogFixture();

  try {
    const { origin } = await startServer(app);

    const storyResponse = await fetch(
      `${origin}/api/v1/stories/${fixture.firstStoryId}`,
    );
    const storyBody = await storyResponse.json();

    assert.equal(storyResponse.status, 200);
    assert.equal(storyBody.story.id, fixture.firstStoryId);
    assert.equal(storyBody.story.title.startsWith('G3 Catalog '), true);
    assert.equal(storyBody.story.totalChapters, 1);
    assert.equal(storyBody.story.ratingCount, 5);
    assert.equal(typeof storyBody.story.ratingAvg, 'number');
    assert.equal(storyBody.story.genres[0].slug, fixture.genreSlug);

    const chaptersResponse = await fetch(
      `${origin}/api/v1/stories/${fixture.firstStoryId}/chapters`,
    );
    const chaptersBody = await chaptersResponse.json();

    assert.equal(chaptersResponse.status, 200);
    assert.equal(chaptersBody.chapters.length, 1);
    assert.equal(chaptersBody.chapters[0].id, fixture.firstChapterId);
    assert.equal(chaptersBody.chapters[0].chapterOrder, 1);

    const chapterResponse = await fetch(
      `${origin}/api/v1/stories/${fixture.firstStoryId}` +
        `/chapters/${fixture.firstChapterId}`,
    );
    const chapterBody = await chapterResponse.json();

    assert.equal(chapterResponse.status, 200);
    assert.equal(
      chapterBody.chapter.content,
      'Nội dung chương A để kiểm thử.',
    );

    const wrongStoryChapterResponse = await fetch(
      `${origin}/api/v1/stories/${fixture.firstStoryId}` +
        `/chapters/${fixture.secondChapterId}`,
    );

    assert.equal(wrongStoryChapterResponse.status, 404);

    const privateStoryResponse = await fetch(
      `${origin}/api/v1/stories/${fixture.privateStoryId}`,
    );

    assert.equal(privateStoryResponse.status, 404);
  } finally {
    await deleteCatalogFixture(fixture);
  }
});

test('GET /api/v1/stories hỗ trợ các bảng xếp hạng', async () => {
  const fixture = await createCatalogFixture();

  try {
    const { origin } = await startServer(app);
    const baseUrl =
      `${origin}/api/v1/stories?genre=${encodeURIComponent(fixture.genreSlug)}`;

    const newestResponse = await fetch(`${baseUrl}&sort=newest`);
    const newestBody = await newestResponse.json();
    assert.equal(newestBody.stories[0].id, fixture.secondStoryId);

    const mostReadResponse = await fetch(`${baseUrl}&sort=most_read`);
    const mostReadBody = await mostReadResponse.json();
    assert.equal(mostReadBody.stories[0].id, fixture.firstStoryId);

    const trendingResponse = await fetch(`${baseUrl}&sort=trending`);
    const trendingBody = await trendingResponse.json();
    assert.equal(trendingBody.stories[0].id, fixture.secondStoryId);

    const topRatedResponse = await fetch(`${baseUrl}&sort=top_rated`);
    const topRatedBody = await topRatedResponse.json();
    assert.equal(topRatedBody.stories[0].id, fixture.firstStoryId);
    assert.equal(topRatedBody.pagination.total, 1);
  } finally {
    await deleteCatalogFixture(fixture);
  }
});

test('GET /api/v1/stories từ chối tham số phân trang và sắp xếp sai', async () => {
  const { origin } = await startServer(app);

  for (const query of ['page=0', 'limit=51', 'sort=khong-hop-le']) {
    const response = await fetch(`${origin}/api/v1/stories?${query}`);
    const body = await response.json();

    assert.equal(response.status, 400, query);
    assert.equal(body.error.code, 'INVALID_REQUEST', query);
  }
});
