import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import { app } from '../dist/app.js';
import { pool } from '../dist/db/pool.js';
import { isReadliteTestDatabase } from '../scripts/test-runner.mjs';

test('admin can publish, hide and delete the same story Android reads when AI is unavailable', {
  skip: !isReadliteTestDatabase(process.env.DATABASE_URL) || Boolean(process.env.AI_REVIEW_PROVIDER),
}, async () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = (await pool.query(
    `INSERT INTO users (email, username, password_hash, display_name, role, email_verified_at)
     VALUES ($1, $2, $3, 'Test administrator', 'admin', now()) RETURNING id`,
    [`flow-${suffix}@example.test`, `flow${suffix}`, await bcrypt.hash('TestPassword123!', 10)],
  )).rows[0];
  let storyId;
  let legacyId;
  let epubId;
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `flow-${suffix}@example.test`, password: 'TestPassword123!' }),
    });
    assert.equal(login.status, 200);
    const csrf = (await login.json()).csrfToken;
    const cookies = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
    const auth = { Cookie: cookies, 'x-csrf-token': csrf };

    storyId = (await pool.query(
      `INSERT INTO stories (owner_id, submitted_by, title, author, summary, source)
       VALUES ($1, $1, $2, 'ReadLite', 'Integration test', 'manual') RETURNING id::text AS id`,
      [user.id, `Flow ${suffix}`],
    )).rows[0].id;
    const volume = (await pool.query(
      `INSERT INTO volumes (story_id, volume_order, title) VALUES ($1, 1, 'Tập 1') RETURNING id`,
      [storyId],
    )).rows[0];
    await pool.query(
      `INSERT INTO chapters (story_id, volume_id, chapter_order, title, content, word_count)
       VALUES ($1, $2, 1, 'Chương 1', 'Một câu chuyện thử nghiệm.', 5)`,
      [storyId, volume.id],
    );

    const inventory = await fetch(`${origin}/api/v1/author/stories`, { headers: auth });
    assert.equal(inventory.status, 200);
    assert.ok((await inventory.json()).stories.some((story) => story.id === storyId));

    legacyId = (await pool.query(
      `INSERT INTO stories (owner_id, title, visibility, moderation_status, ai_review_status)
       VALUES ($1, $2, 'public', 'published', 'skipped') RETURNING id::text AS id`,
      [user.id, `Legacy ${suffix}`],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO chapters (story_id, chapter_order, title, content, word_count)
       VALUES ($1, 1, 'Old chapter', 'Old content', 2)`, [legacyId],
    );
    const legacy = await fetch(`${origin}/api/v1/author/stories/${legacyId}`, { headers: auth });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).preview.volumes[0].chapters[0].title, 'Old chapter');
    const legacyChapterId = (await pool.query('SELECT id::text AS id FROM chapters WHERE story_id = $1', [legacyId])).rows[0].id;
    const editLegacy = await fetch(`${origin}/api/v1/author/stories/${legacyId}/chapters`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ volumeTitle: 'Tập 1', chapters: [{ title: 'Old chapter updated', content: 'Updated content' }] }),
    });
    assert.equal(editLegacy.status, 200);
    const legacyChapter = (await pool.query('SELECT id::text AS id, volume_id FROM chapters WHERE story_id = $1', [legacyId])).rows[0];
    assert.equal(legacyChapter.id, legacyChapterId);
    assert.ok(legacyChapter.volume_id);

    epubId = (await pool.query(
      `INSERT INTO stories (owner_id, submitted_by, reviewed_by, title, source, visibility, moderation_status, ai_review_status)
       VALUES ($1, $1, $1, $2, 'epub', 'public', 'published', 'skipped') RETURNING id::text AS id`,
      [user.id, `EPUB ${suffix}`],
    )).rows[0].id;
    const epubVolume = (await pool.query(
      "INSERT INTO volumes (story_id, volume_order, title) VALUES ($1, 1, 'Original') RETURNING id::text AS id", [epubId],
    )).rows[0].id;
    const epubChapters = (await pool.query(
      `INSERT INTO chapters (story_id, volume_id, chapter_order, title, content)
       VALUES ($1, $2, 1, 'One', 'Text one'), ($1, $2, 2, 'Two', 'Text two')
       RETURNING id::text AS id, chapter_order`, [epubId, epubVolume],
    )).rows.sort((a, b) => a.chapter_order - b.chapter_order);
    const editEpub = await fetch(`${origin}/api/v1/author/stories/${epubId}/structure`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ volumes: [{ id: epubVolume, title: 'Reordered', chapters: [
        { id: epubChapters[1].id, title: 'Two first' }, { id: epubChapters[0].id, title: 'One second' },
      ] }] }),
    });
    assert.equal(editEpub.status, 200);
    const reordered = (await pool.query(
      'SELECT id::text AS id FROM chapters WHERE story_id = $1 ORDER BY chapter_order', [epubId],
    )).rows;
    assert.deepEqual(reordered.map((chapter) => chapter.id), [epubChapters[1].id, epubChapters[0].id]);

    const submit = await fetch(`${origin}/api/v1/author/stories/${storyId}/submit`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(submit.status, 202);
    assert.equal((await submit.json()).aiReviewStatus, 'skipped');

    const queue = await fetch(`${origin}/api/v1/admin/story-submissions`, { headers: auth });
    assert.equal(queue.status, 200);
    assert.ok((await queue.json()).submissions.some((story) => story.id === storyId));

    const approve = await fetch(`${origin}/api/v1/admin/story-submissions/${storyId}/decision`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    assert.equal(approve.status, 200);
    assert.equal((await approve.json()).visibility, 'public');
    const publicStory = await fetch(`${origin}/api/v1/stories/${storyId}`);
    assert.equal(publicStory.status, 200);
    const firstChapterId = (await pool.query('SELECT id::text AS id FROM chapters WHERE story_id = $1', [storyId])).rows[0].id;
    const editPublished = await fetch(`${origin}/api/v1/author/stories/${storyId}/chapters`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ volumeTitle: 'Tập 1', chapters: [
        { title: 'Chương 1 mới', content: 'Nội dung đã đổi.' },
        { title: 'Chương 2', content: 'Nội dung tiếp theo.' },
      ] }),
    });
    assert.equal(editPublished.status, 200);
    const publishedChapters = (await pool.query(
      'SELECT id::text AS id, title FROM chapters WHERE story_id = $1 ORDER BY chapter_order', [storyId],
    )).rows;
    assert.equal(publishedChapters.length, 2);
    assert.equal(publishedChapters[0].id, firstChapterId);
    assert.equal(publishedChapters[0].title, 'Chương 1 mới');

    const hide = await fetch(`${origin}/api/v1/admin/stories/${storyId}/hide`, {
      method: 'POST', headers: auth,
    });
    assert.equal(hide.status, 200);
    assert.equal((await pool.query('SELECT visibility FROM stories WHERE id = $1', [storyId])).rows[0].visibility, 'private');

    const remove = await fetch(`${origin}/api/v1/admin/stories/${storyId}`, {
      method: 'DELETE', headers: auth,
    });
    assert.equal(remove.status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM stories WHERE id = $1', [storyId])).rows[0].count, 0);
    storyId = null;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (storyId) await pool.query('DELETE FROM stories WHERE id = $1', [storyId]);
    if (legacyId) await pool.query('DELETE FROM stories WHERE id = $1', [legacyId]);
    if (epubId) await pool.query('DELETE FROM stories WHERE id = $1', [epubId]);
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    await pool.end();
  }
});
