import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createStorySubmissionRouter } from '../dist/routes/story-submissions.js';

const servers = [];
const authorId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const userId = 'c080e451-4850-4155-a3fd-28ce15c0a2c2';
const csrf = 'test-csrf-token-value-long-enough-32';

async function startServer(application) {
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

async function cookieFor(userIdValue) {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userIdValue)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return 'readlite_access=' + accessToken + '; readlite_csrf=' + csrf;
}

function applicationFor(users, transactions = false) {
  const database = {
    async query(sql, values) {
      if (sql.includes('FROM users')) {
        const user = users.find((candidate) => candidate.id === values[0]);
        return { rows: user ? [user] : [] };
      }
      if (sql.includes('FROM stories')) return { rows: [{ moderationStatus: 'draft' }] };
      return { rows: [] };
    },
    async connect() {
      if (!transactions) throw new Error('Import should not reach the database in authorization tests.');
      return { async query(sql) { return { rows: sql.startsWith('UPDATE stories') ? [{ id: '77' }] : [] }; }, release() {} };
    },
  };
  const application = express();
  application.use(cookieParser());
  application.use('/api/v1', createStorySubmissionRouter(database, {
    async put() { throw new Error('Storage should not be used in authorization tests.'); },
    createReadStream() { throw new Error('Not used.'); },
    async delete() {},
  }));
  return application;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

test('EPUB import requires a verified login before reading the upload', async () => {
  const origin = await startServer(applicationFor([]));
  const form = new FormData();
  form.append('file', new Blob(['bad']), 'book.epub');
  const response = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    body: form,
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});

test('regular users cannot import EPUBs even with a valid session and CSRF token', async () => {
  const origin = await startServer(applicationFor([{ id: userId, role: 'user' }]));
  const form = new FormData();
  form.append('file', new Blob(['bad']), 'book.epub');
  const response = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(userId),
      'x-csrf-token': csrf,
    },
    body: form,
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
});

test('EPUB import requires a multipart request and CSRF protection', async () => {
  const origin = await startServer(applicationFor([{ id: authorId, role: 'author' }]));
  const noCsrf = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers: { cookie: await cookieFor(authorId) },
    body: new FormData(),
  });
  assert.equal(noCsrf.status, 403);

  const notMultipart = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(authorId),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(notMultipart.status, 400);
  assert.equal((await notMultipart.json()).error.code, 'INVALID_MULTIPART');
});

test('EPUB import rejects missing file and fake EPUB signature', async () => {
  const origin = await startServer(applicationFor([{ id: authorId, role: 'author' }]));
  const headers = {
    cookie: await cookieFor(authorId),
    'x-csrf-token': csrf,
  };
  const missingFile = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers,
    body: new FormData(),
  });
  assert.equal(missingFile.status, 400);
  assert.equal((await missingFile.json()).error.code, 'MISSING_FILE');

  const form = new FormData();
  form.append('file', new Blob(['not a zip'], { type: 'application/epub+zip' }), 'book.epub');
  const fakeEpub = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers,
    body: form,
  });
  assert.equal(fakeEpub.status, 415, await fakeEpub.clone().text());
  assert.equal((await fakeEpub.json()).error.code, 'UNSUPPORTED_FILE_TYPE');
});

test('submission without AI enters a private manual review queue', async () => {
  const origin = await startServer(applicationFor([{ id: authorId, role: 'author' }], true));
  const response = await fetch(origin + '/api/v1/author/stories/77/submit', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(authorId),
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: '{}',
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { storyId: '77', moderationStatus: 'admin_review_pending', aiReviewStatus: 'skipped' });
});
test('EPUB import rejects arbitrary file names and field names', async () => {
  const origin = await startServer(applicationFor([{ id: authorId, role: 'author' }]));
  const headers = {
    cookie: await cookieFor(authorId),
    'x-csrf-token': csrf,
  };
  const wrongExtension = new FormData();
  wrongExtension.append('file', new Blob(['data'], { type: 'application/epub+zip' }), 'book.zip');
  const badName = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers,
    body: wrongExtension,
  });
  assert.equal(badName.status, 415, await badName.clone().text());

  const wrongField = new FormData();
  wrongField.append('book', new Blob(['data'], { type: 'application/epub+zip' }), 'book.epub');
  const badField = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers,
    body: wrongField,
  });
  assert.equal(badField.status, 400);
});




test('EPUB import accepts the Windows EPUB MIME type before validating the archive', async () => {
  const origin = await startServer(applicationFor([{ id: authorId, role: 'author' }]));
  const form = new FormData();
  form.append(
    'file',
    new Blob([Uint8Array.from([0x50, 0x4b, 0x03, 0x04])], { type: 'application/epub' }),
    'book.epub',
  );
  const response = await fetch(origin + '/api/v1/author/stories/import-epub', {
    method: 'POST',
    headers: {
      cookie: await cookieFor(authorId),
      'x-csrf-token': csrf,
    },
    body: form,
  });

  assert.equal(response.status, 422, await response.clone().text());
  assert.equal((await response.json()).error.code, 'EPUB_INVALID');
});