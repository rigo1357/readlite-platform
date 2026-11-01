import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../src/config/env.ts';
import { createStorySubmissionRouter } from '../src/routes/story-submissions.ts';

const authorId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'test-csrf-token-value-long-enough-32';
const servers = [];

async function startServer(application) {
  const server = await new Promise((resolve, reject) => {
    const listening = application.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address.');
  return 'http://127.0.0.1:' + address.port;
}

async function cookieFor(userId) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(env.authAccessSecret));
  return 'readlite_access=' + token + '; readlite_csrf=' + csrf;
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

test('author submission returns 202 after atomically enqueueing AI review', async () => {
  const enqueueCalls = [];
  const database = {
    async query(sql, values) {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: values[0], role: 'author' }] };
      }
      if (sql.includes('FROM stories')) {
        return { rows: [{ moderationStatus: 'draft' }] };
      }
      return { rows: [] };
    },
    async connect() {
      throw new Error('The injected review service should own the queue transaction.');
    },
  };
  const reviewService = {
    async enqueueStory(storyId, requestedBy) {
      enqueueCalls.push({ storyId, requestedBy });
    },
  };
  const application = express();
  application.use(cookieParser());
  application.use('/api/v1', createStorySubmissionRouter(
    database,
    {
      async put() { throw new Error('Storage is not used by the submit route.'); },
      createReadStream() { throw new Error('Storage is not used by the submit route.'); },
      async delete() {},
    },
    reviewService,
  ));
  const origin = await startServer(application);
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
  assert.deepEqual(await response.json(), {
    storyId: '77',
    moderationStatus: 'ai_review_pending',
    aiReviewStatus: 'queued',
  });
  assert.deepEqual(enqueueCalls, [{ storyId: '77', requestedBy: authorId }]);
});