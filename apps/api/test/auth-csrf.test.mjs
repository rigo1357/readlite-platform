import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from '../dist/routes/auth.js';

const app = express();
app.use(cookieParser());
app.use('/api/v1', authRouter);
const server = await new Promise((resolve, reject) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  listening.once('error', reject);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test('GET /auth/csrf returns the cookie token for an existing session without caching it', async () => {
  const token = 'c'.repeat(43);
  const response = await fetch(`${origin}/api/v1/auth/csrf`, {
    headers: { cookie: `readlite_refresh=refresh-value; readlite_csrf=${token}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { csrfToken: token });
});

test('GET /auth/csrf rejects requests without a session cookie', async () => {
  const response = await fetch(`${origin}/api/v1/auth/csrf`, {
    headers: { cookie: `readlite_csrf=${'c'.repeat(43)}` },
  });
  assert.equal(response.status, 401);
});
