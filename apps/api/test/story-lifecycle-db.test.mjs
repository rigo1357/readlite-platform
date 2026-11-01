import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { up as core } from '../../../db/migrations/002-core-schema.ts';
import { up as submissions } from '../../../db/migrations/003-story-submissions-media.ts';
import { up as dates } from '../../../db/migrations/004-story-publication-date.ts';
import { up as manualReview } from '../../../db/migrations/006-manual-admin-review.ts';
import { up as follows } from '../../../db/migrations/008-reader-follow-notifications.ts';
import { up as updates } from '../../../db/migrations/009-story-content-updates.ts';
import { up, down } from '../../../db/migrations/011-story-lifecycle.ts';
import { createStoryLifecycleRouter } from '../dist/routes/story-lifecycle.js';
import { createContentUpdatesRouter } from '../dist/routes/content-updates.js';
import { createReaderUpdatesRouter } from '../dist/routes/reader-updates.js';
import { createCatalogRouter } from '../dist/routes/catalog.js';
import { env } from '../dist/config/env.js';

const admin = '10000000-0000-4000-8000-000000000001';
const author = '10000000-0000-4000-8000-000000000002';
const other = '10000000-0000-4000-8000-000000000003';
const reader = '10000000-0000-4000-8000-000000000004';
const inactive = '10000000-0000-4000-8000-000000000005';
const unverified = '10000000-0000-4000-8000-000000000006';
const csrf = 'lifecycle-csrf-012345678901234567890123';
function sql(migration) { let text = ''; migration({ sql(s) { text += s; } }); return text; }

test('story lifecycle: real PostgreSQL, publication isolation, completion alerts and safe chapter additions', async t => {
  const db = new PGlite({ extensions: { citext, pg_trgm, unaccent } });
  let server = null;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); });
  await db.exec('CREATE EXTENSION citext; CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;');
  for (const migration of [core, submissions, dates, manualReview, follows, updates]) await db.exec(sql(migration));
  for (const [index, userId] of [admin, author, other, reader, inactive, unverified].entries()) {
    await db.query('INSERT INTO users(id,email,username,password_hash,display_name,role,is_active,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [userId, `person${index}@test.invalid`, `person${index}`, 'unused', `Tài khoản ${index}`, index === 0 ? 'admin' : index < 3 ? 'author' : 'user', userId !== inactive, userId === unverified ? null : new Date()]);
  }
  await db.query("INSERT INTO stories(id,owner_id,submitted_by,title,author,visibility,moderation_status,ai_review_status,reviewed_by) VALUES(12,$1,$1,'Truyện tiến hành','Tác giả','public','published','skipped',$2),(13,$1,$1,'Bản nháp','Tác giả','private','draft','not_started',NULL)", [author, admin]);
  await db.exec("INSERT INTO volumes(story_id,volume_order,title) VALUES(12,1,'Tập 1'); INSERT INTO chapters(story_id,volume_id,chapter_order,title,content) VALUES(12,1,1,'Chương đầu','Nội dung đầu'),(12,1,2,'Chương sau','Nội dung sau'); INSERT INTO genres(name,slug) VALUES('Fantasy','fantasy'); INSERT INTO story_genres(story_id,genre_id) SELECT 12,id FROM genres;");
  await db.query('INSERT INTO reading_progress(user_id,story_id,current_chapter_id,position_permille) VALUES($1,12,1,620)', [reader]);
  for (const userId of [reader, inactive, unverified]) await db.query('INSERT INTO story_follows(user_id,story_id) VALUES($1,12)', [userId]);
  await db.exec(sql(up));
  const database = { query: (text, values) => db.query(text, values), async connect() { return { query: (text, values) => db.query(text, values), release() {} }; } };
  const app = express(); app.use(express.json(), cookieParser());
  app.use('/api/v1', createStoryLifecycleRouter(database), createContentUpdatesRouter(database), createReaderUpdatesRouter(database), createCatalogRouter(database));
  app.use((error, _req, res, next) => res.headersSent ? next(error) : res.status(500).json({ error: { code: 'TEST_ERROR', message: error.message } }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function call(path, method = 'GET', body, user = author, withCsrf = true) {
    const access = user ? await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(user).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.authAccessSecret)) : '';
    return fetch(base + path, { method, headers: { cookie: `readlite_access=${access}; readlite_csrf=${csrf}`, ...(withCsrf ? { 'x-csrf-token': csrf } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const set = (status, expectedVersion, note = '', storyId = '12', user = author) => call(`/author/stories/${storyId}/lifecycle`, 'PATCH', { status, expectedVersion, note }, user);
  const count = async table => Number((await db.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);
  const updateBody = { title: 'Phần bổ sung', volumeTitle: 'Tập mới', targetVolumeId: null, chapters: [{ title: 'Chương bổ sung', content: 'Nội dung bổ sung' }] };
  let pendingId;
  await t.test('upgrade defaults to ongoing without changing chapters, progress or sending historical alerts', async () => {
    assert.equal((await db.query('SELECT lifecycle_status FROM stories WHERE id=12')).rows[0].lifecycle_status, 'ongoing');
    assert.equal(await count('reader_notifications'), 0); assert.equal(await count('chapters'), 2);
    assert.equal((await db.query('SELECT position_permille FROM reading_progress')).rows[0].position_permille, 620);
  });
  await t.test('ownership, verified contributor, CSRF, bounded ID, statuses, notes and versions are enforced', async () => {
    assert.equal((await call('/author/stories/12/lifecycle', 'GET', undefined, null)).status, 401);
    assert.equal((await set('paused', 0, 'Lý do', '12', reader)).status, 403);
    assert.equal((await set('paused', 0, 'Lý do', '12', inactive)).status, 403);
    assert.equal((await set('paused', 0, 'Lý do', '12', other)).status, 404);
    assert.equal((await call('/author/stories/12/lifecycle', 'PATCH', { status: 'paused', expectedVersion: 0, note: 'Lý do' }, author, false)).status, 403);
    for (const body of [{ status: 'unknown', expectedVersion: 0 }, { status: 'paused', expectedVersion: 0, note: ' ' }, { status: 'ongoing', expectedVersion: -1 }, { status: 'ongoing', expectedVersion: 0, note: 'x'.repeat(2001) }, { status: 'ongoing', expectedVersion: 0, visibility: 'public' }]) {
      assert.equal((await call('/author/stories/12/lifecycle', 'PATCH', body)).status, 400);
    }
    assert.equal((await set('completed', 0, '', '9223372036854775808')).status, 400);
    assert.equal((await set('completed', 0, '', '13')).status, 409);
    assert.equal(await count('story_lifecycle_events'), 0);
  });
  await t.test('pausing keeps published reading intact, logs reason and prevents new chapter submissions', async () => {
    assert.equal((await set('paused', 0, 'Tác giả cần nghỉ')).status, 200);
    const publicStory = await (await call('/stories/12')).json(); assert.equal(publicStory.story.lifecycleStatus, 'paused'); assert.equal(publicStory.story.lifecycleNote, undefined);
    assert.equal((await call('/stories/12/chapters/1')).status, 200);
    const rejected = await call('/author/stories/12/updates', 'POST', updateBody); assert.equal(rejected.status, 409); assert.equal((await rejected.json()).error.code, 'STORY_NOT_ONGOING');
    assert.equal(await count('reader_notifications'), 0);
    assert.equal((await db.query('SELECT moderation_status FROM stories WHERE id=12')).rows[0].moderation_status, 'published');
  });
  await t.test('a pending addition waits if the author completes the story before admin approval', async () => {
    assert.equal((await set('ongoing', 1)).status, 200);
    const created = await call('/author/stories/12/updates', 'POST', updateBody); assert.equal(created.status, 201); pendingId = (await created.json()).updateId;
    assert.equal((await call(`/author/content-updates/${pendingId}/submit`, 'POST')).status, 200);
    assert.equal((await set('completed', 2, 'Đã kết thúc')).status, 200);
    const decision = await call(`/admin/content-updates/${pendingId}/decision`, 'POST', { decision: 'approve' }, admin);
    assert.equal(decision.status, 409); assert.equal((await decision.json()).error.code, 'STORY_NOT_ONGOING');
    assert.equal(await count('chapters'), 2);
    await assert.rejects(db.query("INSERT INTO chapters(story_id,chapter_order,title,content) VALUES(12,3,'Sai','Không được')"), error => error.code === '23514');
  });
  await t.test('completion alerts go only to current active verified followers and open the story, with no duplicates', async () => {
    assert.equal(await count('reader_notifications'), 1);
    const list = await (await call('/me/notifications', 'GET', undefined, reader)).json();
    const notification = list.notifications[0]; assert.equal(notification.kind, 'story_completed'); assert.equal(notification.chapterId, null); assert.equal(notification.chapterAvailable, false);
    assert.equal((await set('completed', 2)).status, 200); assert.equal(await count('reader_notifications'), 1);
    const stale = await set('paused', 2, 'Trạng thái cũ', '12', admin); assert.equal(stale.status, 409);
    assert.equal((await call(`/me/notifications/${notification.id}/read`, 'PUT', undefined, reader)).status, 200);
    assert.equal((await call(`/me/notifications/${notification.id}/read`, 'PUT', undefined, other)).status, 404);
  });
  await t.test('reopening permits the pending chapter, retains original IDs/progress and adds the usual chapter notification', async () => {
    assert.equal((await set('ongoing', 3)).status, 200);
    assert.equal((await call(`/admin/content-updates/${pendingId}/decision`, 'POST', { decision: 'approve' }, admin)).status, 200);
    assert.equal(await count('chapters'), 3); assert.equal(await count('reader_notifications'), 2);
    assert.equal((await db.query('SELECT total_chapters FROM stories WHERE id=12')).rows[0].total_chapters, 3);
    assert.equal((await db.query('SELECT current_chapter_id,position_permille FROM reading_progress')).rows[0].current_chapter_id, 1);
    assert.equal((await db.query('SELECT position_permille FROM reading_progress')).rows[0].position_permille, 620);
    await set('completed', 4); assert.equal(await count('reader_notifications'), 2);
  });
  await t.test('catalog filters combine search/genre/lifecycle and hide drafts with correct pagination', async () => {
    await db.exec("INSERT INTO chapters(story_id,chapter_order,title,content) VALUES(13,1,'Nháp','Riêng tư');");
    assert.equal((await set('completed', 0, '', '13')).status, 200);
    const filtered = await (await call('/stories?lifecycle=completed&genre=fantasy&q=tiến&limit=1')).json();
    assert.equal(filtered.stories.length, 1); assert.equal(filtered.pagination.total, 1); assert.equal(filtered.stories[0].id, '12');
    assert.equal((await (await call('/stories?lifecycle=ongoing')).json()).pagination.total, 0);
    assert.equal((await (await call('/stories?lifecycle=completed&page=2&limit=1')).json()).stories.length, 0);
    assert.equal((await call('/stories?lifecycle=unknown')).status, 400);
    assert.equal((await call('/stories?lifecycle=paused&lifecycle=completed')).status, 400);
    assert.equal((await call('/stories/13')).status, 404);
  });
  await t.test('late followers receive no backlog; hidden completion alerts wait for public publication', async () => {
    assert.equal((await call('/stories/12/follow', 'PUT', undefined, other)).status, 200);
    assert.equal((await (await call('/me/notifications', 'GET', undefined, other)).json()).notifications.length, 0);
    await db.exec("UPDATE stories SET visibility='private',moderation_status='draft' WHERE id=12");
    await set('ongoing', 5); await set('completed', 6);
    assert.equal(await count('reader_notifications'), 2);
    assert.equal((await (await call('/me/notifications', 'GET', undefined, reader)).json()).notifications.length, 0);
    await db.query("UPDATE stories SET visibility='public',moderation_status='published',ai_review_status='skipped',reviewed_by=$1 WHERE id=12", [admin]);
    assert.equal(await count('reader_notifications'), 3);
    assert.equal((await (await call('/me/notifications', 'GET', undefined, other)).json()).notifications[0].kind, 'story_completed');
  });
  await t.test('moderation-pending stories cannot change lifecycle; history is private and paginated', async () => {
    await db.exec("UPDATE stories SET moderation_status='admin_review_pending' WHERE id=13");
    assert.equal((await set('paused', 1, 'Đợi', '13')).status, 409);
    assert.equal((await call('/author/stories/12/lifecycle', 'GET', undefined, other)).status, 404);
    const response = await call('/author/stories/12/lifecycle'); assert.equal(response.headers.get('cache-control'), 'no-store');
    const history = await response.json(); assert.equal(history.lifecycle.status, 'completed'); assert.equal(history.lifecycle.version, 7); assert.equal(history.events.length, 7);
    assert.equal(history.events[0].actorName, 'Tài khoản 1'); assert.ok(history.events[0].createdAt);
    assert.equal((await call('/author/stories/12/lifecycle?page=0')).status, 400);
  });
  await t.test('failure after the completion trigger rolls back lifecycle, audit and notifications together', async () => {
    await db.query("INSERT INTO stories(id,owner_id,submitted_by,title,visibility,moderation_status,ai_review_status,reviewed_by) VALUES(14,$1,$1,'Truyện lỗi','public','published','skipped',$2)", [author, admin]);
    await db.exec("INSERT INTO chapters(story_id,chapter_order,title,content) VALUES(14,1,'Một','Nội dung');");
    await db.query('INSERT INTO story_follows(user_id,story_id) VALUES($1,14)', [reader]);
    await db.exec("CREATE FUNCTION fail_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=14 AND NEW.lifecycle_status='completed' THEN RAISE EXCEPTION 'forced failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER z_fail_lifecycle AFTER UPDATE OF lifecycle_status ON stories FOR EACH ROW EXECUTE FUNCTION fail_lifecycle();");
    const before = await count('reader_notifications'); assert.equal((await set('completed', 0, '', '14')).status, 500);
    assert.equal((await db.query('SELECT lifecycle_status,lifecycle_version FROM stories WHERE id=14')).rows[0].lifecycle_status, 'ongoing');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM story_lifecycle_events WHERE story_id=14')).rows[0].n, 0);
    assert.equal(await count('reader_notifications'), before);
    await db.exec('DROP TRIGGER z_fail_lifecycle ON stories; DROP FUNCTION fail_lifecycle();');
  });
  await t.test('rollback preserves chapters, progress, follows and chapter notifications', async () => {
    const chapters = await count('chapters'); const followCount = await count('story_follows');
    const chapterAlerts = Number((await db.query("SELECT count(*) AS count FROM reader_notifications WHERE notification_kind='chapter'")).rows[0].count);
    await db.exec(sql(down)); assert.equal(await count('chapters'), chapters); assert.equal(await count('story_follows'), followCount); assert.equal(await count('reader_notifications'), chapterAlerts);
    assert.equal((await db.query('SELECT position_permille FROM reading_progress')).rows[0].position_permille, 620);
  });
});
