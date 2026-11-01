import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { app } from '../dist/app.js';
import { env } from '../dist/config/env.js';
import { createLibraryRouter } from '../dist/routes/library.js';

const servers = [];
const testUserId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrfValue = 'test-csrf-token-value-long-enough-32';

async function startServer(application = app) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = application.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Không lấy được cổng kiểm thử API.');
  }

  servers.push(server);
  return `http://127.0.0.1:${address.port}`;
}

async function authenticatedCookie() {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(testUserId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));

  return `readlite_access=${accessToken}; readlite_csrf=${csrfValue}`;
}

function appWithDatabase(database) {
  const application = express();
  application.use(express.json());
  application.use(cookieParser());
  application.use('/api/v1', createLibraryRouter(database));
  application.use((_request, response) => response.status(404).end());
  return application;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

test('GET /api/v1/me/library từ chối khi chưa đăng nhập', async () => {
  const origin = await startServer();
  const response = await fetch(`${origin}/api/v1/me/library`);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập để tiếp tục.',
    },
  });
});

test('PUT /api/v1/stories/:id/favorite yêu cầu CSRF trước khi thay đổi dữ liệu', async () => {
  const origin = await startServer();
  const response = await fetch(`${origin}/api/v1/stories/12/favorite`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'CSRF_INVALID',
      message: 'Yêu cầu không hợp lệ.',
    },
  });
});

test('GET /api/v1/me/library trả truyện đã thích và tiến độ đọc', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: testUserId }] };
      }
      return {
        rows: [{
          id: '77',
          title: 'Bên kia trang sách',
          author: 'Tác giả thử',
          isFavorite: true,
          readingProgress: {
            chapterId: '901',
            chapterOrder: 3,
            chapterTitle: 'Chương 3',
            positionPermille: 420,
          },
        }],
      };
    },
  };
  const origin = await startServer(appWithDatabase(database));
  const response = await fetch(`${origin}/api/v1/me/library`, {
    headers: { cookie: await authenticatedCookie() },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    stories: [{
      id: '77',
      title: 'Bên kia trang sách',
      author: 'Tác giả thử',
      isFavorite: true,
      readingProgress: {
        chapterId: '901',
        chapterOrder: 3,
        chapterTitle: 'Chương 3',
        positionPermille: 420,
      },
    }],
  });
});

test('tủ sách không cấp quyền cho tài khoản chưa xác minh hoặc đã vô hiệu hóa', async () => {
  const database = { async query() { return { rows: [] }; } };
  const origin = await startServer(appWithDatabase(database));
  const response = await fetch(`${origin}/api/v1/me/library`, {
    headers: { cookie: await authenticatedCookie() },
  });

  assert.equal(response.status, 401);
});

test('lưu tiến độ từ chối giá trị ngoài 0 đến 1000 trước khi ghi cơ sở dữ liệu', async () => {
  let queryCount = 0;
  const database = { async query() { queryCount += 1; return { rows: [] }; } };
  const origin = await startServer(appWithDatabase(database));
  const response = await fetch(`${origin}/api/v1/stories/77/reading-progress`, {
    method: 'PUT',
    headers: {
      cookie: await authenticatedCookie(),
      'content-type': 'application/json',
      'x-csrf-token': csrfValue,
    },
    body: JSON.stringify({ chapterId: '901', positionPermille: 1001 }),
  });

  assert.equal(response.status, 400);
  assert.equal(queryCount, 0);
});

test('lưu tiến độ trả chapter và permille đã được lưu', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: testUserId }] };
      }
      return {
        rows: [{
          storyId: '77',
          chapterId: '901',
          positionPermille: 420,
          lastReadAt: '2026-10-15T12:00:00.000Z',
        }],
      };
    },
  };
  const origin = await startServer(appWithDatabase(database));
  const response = await fetch(`${origin}/api/v1/stories/77/reading-progress`, {
    method: 'PUT',
    headers: {
      cookie: await authenticatedCookie(),
      'content-type': 'application/json',
      'x-csrf-token': csrfValue,
    },
    body: JSON.stringify({ chapterId: '901', positionPermille: 420 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    progress: {
      storyId: '77',
      chapterId: '901',
      positionPermille: 420,
      lastReadAt: '2026-10-15T12:00:00.000Z',
    },
  });
});

test('thích truyện trả kết quả ổn định sau khi ghi', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: testUserId }] };
      }
      return { rows: [{ storyId: '77' }] };
    },
  };
  const origin = await startServer(appWithDatabase(database));
  const response = await fetch(`${origin}/api/v1/stories/77/favorite`, {
    method: 'PUT',
    headers: {
      cookie: await authenticatedCookie(),
      'x-csrf-token': csrfValue,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { storyId: '77', isFavorite: true });
});
