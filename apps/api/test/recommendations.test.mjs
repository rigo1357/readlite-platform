import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { env } from '../dist/config/env.js';
import { createRecommendationsRouter } from '../dist/routes/recommendations.js';

const userId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const servers = [];
after(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });

async function setup({ active = true, matches = [], fallback = [], failure = false } = {}) {
  const calls = [];
  const database = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM users')) return { rows: active ? [{ id: userId }] : [] };
      if (failure) throw new Error('database unavailable');
      if (sql.includes('candidate_matches AS')) return { rows: matches };
      if (sql.includes('readership AS')) return { rows: fallback };
      throw new Error('Unexpected query');
    },
  };
  const app = express();
  app.use(cookieParser());
  app.use('/api/v1', createRecommendationsRouter(database));
  app.use((_error, _request, response, _next) => response.status(500).json({ error: { code: 'TEST_ERROR' } }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  servers.push(server);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.authAccessSecret));
  return { calls, headers: { cookie: `readlite_access=${token}` }, url: `http://127.0.0.1:${server.address().port}/api/v1/me/recommendations` };
}

test('recommendations: requires a valid cookie before querying personal activity', async () => {
  const { url, calls } = await setup();
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { cookie: 'readlite_access=invalid-token' } })).status, 401);
  assert.equal(calls.length, 0);
});

test('recommendations: only an active verified account may load private recommendations', async () => {
  const { url, calls, headers } = await setup({ active: false });
  assert.equal((await fetch(url, { headers })).status, 401);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /is_active = true AND email_verified_at IS NOT NULL/);
  assert.deepEqual(calls[0].values, [userId]);
});

test('recommendations: rejects invalid, excessive and repeated limits without database work', async () => {
  const { url, calls, headers } = await setup();
  for (const query of ['0', '-1', '21', '1.5', '1%20OR%201=1', '1&limit=2']) {
    assert.equal((await fetch(url + '?limit=' + query, { headers })).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('recommendations: weights genres, excludes existing library titles and keeps publication boundaries', async () => {
  const story = { id: '92', title: 'Truyện kỳ ảo', author: 'Tác giả', summary: '', coverUrl: null, totalChapters: 5, ratingAvg: 4.5, ratingCount: 2, genres: [], recommendationReason: 'Cùng thể loại Kỳ ảo với truyện bạn đã thích hoặc đọc' };
  const { url, calls, headers } = await setup({ matches: [story] });
  const response = await fetch(url + '?limit=3', { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stories: [story], personalized: true });
  const query = calls[1];
  assert.deepEqual(query.values, [userId, 3]);
  assert.ok(!query.sql.includes(userId));
  assert.match(query.sql, /SELECT story_id, 3 AS weight FROM favorites WHERE user_id = \$1/);
  assert.match(query.sql, /SELECT story_id, 1 AS weight FROM reading_progress WHERE user_id = \$1/);
  assert.match(query.sql, /SUM\(ui.weight\)/);
  assert.match(query.sql, /SUM\(gp.weight\) AS match_score/);
  assert.match(query.sql, /s\.visibility = 'public' AND s\.moderation_status = 'published'/);
  assert.match(query.sql, /NOT EXISTS \(SELECT 1 FROM user_interactions ui WHERE ui.story_id = s.id\)/);
  assert.match(query.sql, /ORDER BY cm.match_score DESC, s.rating_count DESC, s.rating_avg DESC, s.id DESC/);
  assert.match(query.sql, /s.id::text AS id/);
  assert.match(query.sql, /LIMIT \$2/);
  assert.equal(calls.length, 2);
});

test('recommendations: falls back to measured catalog signals when no unseen genre matches remain', async () => {
  const story = { id: '93', title: 'Khám phá mới', ratingCount: 0, recommendationReason: 'Được độc giả khác đọc' };
  const { url, calls, headers } = await setup({ fallback: [story] });
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stories: [story], personalized: false });
  assert.equal(calls.length, 3);
  const query = calls[2];
  assert.deepEqual(query.values, [userId, 10]);
  assert.match(query.sql, /COUNT\(DISTINCT user_id\) AS readers FROM reading_progress/);
  assert.match(query.sql, /WHEN s.rating_count > 0 THEN/);
  assert.match(query.sql, /ELSE 'Truyện mới để bạn khám phá'/);
  assert.match(query.sql, /s\.visibility = 'public' AND s\.moderation_status = 'published'/);
  assert.match(query.sql, /NOT EXISTS \(SELECT 1 FROM user_interactions ui WHERE ui.story_id = s.id\)/);
  assert.match(query.sql, /ORDER BY COALESCE\(r.readers, 0\) DESC, s.rating_count DESC, s.rating_avg DESC, s.created_at DESC, s.id DESC/);
});

test('recommendations: an empty or fully read catalog stays empty without claiming personalization', async () => {
  const { url, headers } = await setup();
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stories: [], personalized: false });
});

test('recommendations: forwards database errors instead of returning fabricated suggestions', async () => {
  const { url, headers, calls } = await setup({ failure: true });
  assert.equal((await fetch(url, { headers })).status, 500);
  assert.equal(calls.length, 2);
});
