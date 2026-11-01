import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Readable } from 'node:stream';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createMediaRouter } from '../dist/routes/media.js';

const servers = [];
const storyOwnerId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const otherUserId = 'c080e451-4850-4155-a3fd-28ce15c0a2c2';
const mediaId = '42abbdac-0bf3-4265-a183-b53f75475ad8';
const bytes = Buffer.from('synthetic media bytes');

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

async function accessCookie(userId) {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return 'readlite_access=' + accessToken;
}

function createHarness(media, users = []) {
  let streamKey = null;
  const database = {
    async query(sql, values) {
      if (sql.includes('FROM users')) {
        const user = users.find((candidate) => candidate.id === values[0]);
        return { rows: user ? [user] : [] };
      }
      assert.match(sql, /FROM media_assets/);
      assert.deepEqual(values, [mediaId]);
      return { rows: [media] };
    },
  };
  const storage = {
    createReadStream(key) {
      streamKey = key;
      return Readable.from([bytes]);
    },
    async put() {
      throw new Error('Not used by media-route tests.');
    },
    async delete() {},
  };
  const application = express();
  application.use(cookieParser());
  application.use('/api/v1', createMediaRouter(database, storage));
  const originPromise = startServer(application);
  return {
    originPromise,
    streamedKey: () => streamKey,
  };
}

function mediaRecord(overrides = {}) {
  return {
    storageKey: '9e4bb8a1-1075-4aa8-9f0c-d1aabc8d06a2.blob',
    mediaKind: 'cover',
    mimeType: 'image/png',
    byteSize: bytes.length,
    sha256: 'a'.repeat(64),
    storyOwnerId,
    visibility: 'private',
    moderationStatus: 'draft',
    ...overrides,
  };
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

test('GET /api/v1/media/:id rejects malformed ids without accessing storage', async () => {
  const harness = createHarness(mediaRecord());
  const response = await fetch((await harness.originPromise) + '/api/v1/media/not-a-uuid');

  assert.equal(response.status, 404);
  assert.equal(harness.streamedKey(), null);
});

test('published cover and chapter images are publicly readable with safe headers', async () => {
  const harness = createHarness(mediaRecord({
    mediaKind: 'image',
    visibility: 'public',
    moderationStatus: 'published',
  }));
  const response = await fetch((await harness.originPromise) + '/api/v1/media/' + mediaId);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control'), /public/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(harness.streamedKey(), mediaRecord().storageKey);
});

test('draft media is hidden from anonymous and unrelated users', async () => {
  const harness = createHarness(mediaRecord(), [{ id: otherUserId, role: 'user' }]);
  const origin = await harness.originPromise;
  const anonymous = await fetch(origin + '/api/v1/media/' + mediaId);
  const unrelated = await fetch(origin + '/api/v1/media/' + mediaId, {
    headers: { cookie: await accessCookie(otherUserId) },
  });

  assert.equal(anonymous.status, 404);
  assert.equal(unrelated.status, 404);
  assert.equal(harness.streamedKey(), null);
});

test('story owner and administrator can read private media without caching', async () => {
  const media = mediaRecord();
  const harness = createHarness(media, [
    { id: storyOwnerId, role: 'author' },
    { id: otherUserId, role: 'admin' },
  ]);
  const origin = await harness.originPromise;
  const ownerResponse = await fetch(origin + '/api/v1/media/' + mediaId, {
    headers: { cookie: await accessCookie(storyOwnerId) },
  });

  assert.equal(ownerResponse.status, 200);
  assert.equal(ownerResponse.headers.get('cache-control'), 'private, no-store');
  await ownerResponse.arrayBuffer();

  const adminResponse = await fetch(origin + '/api/v1/media/' + mediaId, {
    headers: { cookie: await accessCookie(otherUserId) },
  });
  assert.equal(adminResponse.status, 200);
  await adminResponse.arrayBuffer();
});

test('EPUB is only downloadable by its owner or an administrator', async () => {
  const harness = createHarness(mediaRecord({
    mediaKind: 'epub',
    mimeType: 'application/epub+zip',
  }), [{ id: storyOwnerId, role: 'author' }]);
  const origin = await harness.originPromise;
  const anonymous = await fetch(origin + '/api/v1/media/' + mediaId);
  assert.equal(anonymous.status, 404);

  const owner = await fetch(origin + '/api/v1/media/' + mediaId, {
    headers: { cookie: await accessCookie(storyOwnerId) },
  });
  assert.equal(owner.status, 200);
  assert.match(owner.headers.get('content-disposition'), /attachment/);
  assert.equal(owner.headers.get('cache-control'), 'private, no-store');
  await owner.arrayBuffer();
});
