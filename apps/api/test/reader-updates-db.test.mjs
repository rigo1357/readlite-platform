import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { up, down } from '../../../db/migrations/008-reader-follow-notifications.ts';
import { up as lifecycleUp, down as lifecycleDown } from '../../../db/migrations/011-story-lifecycle.ts';
import { createReaderUpdatesRouter } from '../dist/routes/reader-updates.js';
import { env } from '../dist/config/env.js';

// PostgreSQL runs entirely in memory. No connection to DATABASE_URL or personal media.
const reader = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const other = '26a04b4a-0f31-4690-9f65-0fd741f465d8';
const inactive = '36a04b4a-0f31-4690-9f65-0fd741f465d8';
const csrf = 'reader-updates-csrf-value-long-enough-32';
function migrationSql(fn) {
  let sql = '';
  fn({
    sql(value) {
      sql = value;
    },
  });
  return sql;
}

test('reader updates: PostgreSQL migration, publishing triggers and authenticated API', async (t) => {
  const db = new PGlite();
  let server = null;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY, is_active boolean DEFAULT true, email_verified_at timestamptz DEFAULT now());
    CREATE TABLE stories (id bigint PRIMARY KEY, title text NOT NULL, author text DEFAULT 'Tác giả',
      total_chapters int DEFAULT 0, visibility text DEFAULT 'private', moderation_status text DEFAULT 'draft');
    CREATE TABLE chapters (id bigint PRIMARY KEY, story_id bigint NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      title text NOT NULL, chapter_order int DEFAULT 1, UNIQUE(id, story_id));
    INSERT INTO users(id) VALUES ('${reader}'), ('${other}');
    INSERT INTO users(id,is_active) VALUES ('${inactive}',false);
    INSERT INTO stories(id,title,visibility,moderation_status) VALUES (12,'Truyện theo dõi','public','published'),(13,'Bản nháp','private','draft');
    INSERT INTO chapters(id,story_id,title) VALUES (1,12,'Chương cũ'),(2,13,'Chương bản nháp');
  `);
  await db.exec(migrationSql(up));
  await db.exec(migrationSql(lifecycleUp));
  const database = {
    query: (sql, values) => db.query(sql, values),
    async connect() {
      return { query: (sql, values) => db.query(sql, values), release() {} };
    },
  };
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/v1', createReaderUpdatesRouter(database));
  app.use((error, _req, res, next) => res.headersSent ? next(error) : res.status(500).json({ message: error.message }));
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function headers(user = reader) {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(env.authAccessSecret));
    return { cookie: `readlite_access=${token}; readlite_csrf=${csrf}`, 'x-csrf-token': csrf };
  }
  async function call(path, method = 'GET', user = reader) {
    return fetch(base + path, { method, headers: await headers(user) });
  }
  async function count(table) {
    return Number((await db.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);
  }

  await t.test(
    'migration preserves old chapters and creates no historical notifications',
    async () => {
      assert.equal(await count('chapters'), 2);
      assert.equal(await count('announced_chapters'), 1);
      assert.equal(await count('reader_notifications'), 0);
    },
  );
  await t.test(
    'follow requires CSRF/auth, published title, valid ID; repeated follow is idempotent',
    async () => {
      assert.equal((await fetch(base + '/me/following')).status, 401);
      assert.equal((await fetch(base + '/stories/12/follow', { method: 'PUT' })).status, 403);
      assert.equal((await call('/stories/12/follow', 'PUT', inactive)).status, 401);
      assert.equal((await call('/stories/13/follow', 'PUT')).status, 404);
      assert.equal((await call('/stories/9223372036854775808/follow', 'PUT')).status, 400);
      assert.equal((await call('/stories/12/follow', 'PUT')).status, 200);
      assert.equal((await call('/stories/12/follow', 'PUT')).status, 200);
      assert.equal(await count('story_follows'), 1);
      assert.deepEqual(await (await call('/stories/12/follow')).json(), { following: true });
      assert.equal(await count('reader_notifications'), 0);
    },
  );
  await t.test('new published chapter announces only to current followers', async () => {
    await db.query("INSERT INTO chapters(id,story_id,title) VALUES (3,12,'Chương mới')");
    const list = await (await call('/me/notifications')).json();
    assert.equal(list.notifications.length, 1);
    assert.equal(list.notifications[0].chapterId, '3');
    assert.equal(list.unreadCount, 1);
    assert.equal(list.notifications[0].chapterAvailable, true);
    assert.equal(
      (await (await call('/me/notifications', 'GET', other)).json()).notifications.length,
      0,
    );
    assert.equal((await call('/me/notifications')).headers.get('cache-control'), 'no-store');
  });
  await t.test('title edits and re-publication do not duplicate notifications', async () => {
    await db.exec(
      "UPDATE chapters SET title='Đổi tên' WHERE id=3; UPDATE stories SET visibility='private',moderation_status='draft' WHERE id=12;",
    );
    assert.equal((await (await call('/me/notifications')).json()).notifications.length, 0);
    const follows = await (await call('/me/following')).json();
    assert.equal(follows.stories[0].available, false);
    assert.equal(follows.stories[0].title, 'Truyện hiện không công khai');
    await db.exec(
      "UPDATE stories SET visibility='public',moderation_status='published' WHERE id=12",
    );
    assert.equal(await count('reader_notifications'), 1);
  });
  await t.test(
    'draft additions wait for publication; notifications follow the DB transaction',
    async () => {
      await db.exec(
        "UPDATE stories SET visibility='private',moderation_status='draft' WHERE id=12; INSERT INTO chapters(id,story_id,title) VALUES (4,12,'Chương cần duyệt');",
      );
      assert.equal(await count('reader_notifications'), 1);
      await db.exec(
        "UPDATE stories SET visibility='public',moderation_status='published' WHERE id=12;",
      );
      assert.equal(await count('reader_notifications'), 2);
      await db.exec(
        "BEGIN; INSERT INTO chapters(id,story_id,title) VALUES (5,12,'Bị rollback'); ROLLBACK;",
      );
      assert.equal(await count('reader_notifications'), 2);
      assert.equal(
        (await db.query('SELECT * FROM announced_chapters WHERE chapter_id=5')).rows.length,
        0,
      );
    },
  );
  await t.test(
    'read actions scope ownership, preserve first read time, and filter unread',
    async () => {
      const list = await (await call('/me/notifications')).json();
      const notificationId = list.notifications[0].id;
      assert.equal(
        (await call(`/me/notifications/${notificationId}/read`, 'PUT', other)).status,
        404,
      );
      assert.equal((await call(`/me/notifications/${notificationId}/read`, 'PUT')).status, 200);
      const first = (
        await db.query('SELECT read_at FROM reader_notifications WHERE id=$1', [notificationId])
      ).rows[0].read_at;
      await call(`/me/notifications/${notificationId}/read`, 'PUT');
      const second = (
        await db.query('SELECT read_at FROM reader_notifications WHERE id=$1', [notificationId])
      ).rows[0].read_at;
      assert.equal(first.toISOString(), second.toISOString());
      const unread = await (await call('/me/notifications?unread=true')).json();
      assert.equal(unread.notifications.length, 1);
      assert.equal(unread.pagination.total, 1);
      assert.equal((await call('/me/notifications?unread=anything')).status, 400);
      assert.equal((await call('/me/following?page=0')).status, 400);
    },
  );
  await t.test(
    'unfollow stops future notifications, retains history, and supports hidden titles',
    async () => {
      await db.exec(
        "UPDATE stories SET visibility='private',moderation_status='draft' WHERE id=12;",
      );
      assert.equal((await call('/stories/12/follow', 'DELETE')).status, 200);
      await db.exec(
        "UPDATE stories SET visibility='public',moderation_status='published' WHERE id=12; INSERT INTO chapters(id,story_id,title) VALUES (6,12,'Sau khi bỏ theo dõi');",
      );
      assert.equal(await count('reader_notifications'), 2);
      assert.equal((await (await call('/stories/12/follow')).json()).following, false);
      await call('/stories/12/follow', 'PUT');
      await call('/stories/12/follow', 'PUT', other);
      await db.exec("INSERT INTO chapters(id,story_id,title) VALUES (7,12,'Cho hai độc giả');");
      assert.equal(await count('reader_notifications'), 4);
      await call('/me/notifications/read-all', 'PUT');
      assert.equal((await (await call('/me/notifications/unread-count')).json()).unreadCount, 0);
      assert.equal(
        (await (await call('/me/notifications/unread-count', 'GET', other)).json()).unreadCount,
        1,
      );
    },
  );
  await t.test(
    'deleted chapters keep readable notification history without a dangling chapter',
    async () => {
      await db.exec('DELETE FROM chapters WHERE id=7');
      const item = (await (await call('/me/notifications', 'GET', other)).json()).notifications[0];
      assert.equal(item.chapterId, null);
      assert.equal(item.chapterAvailable, false);
      assert.equal(item.chapterTitle, 'Cho hai độc giả');
    },
  );
  await t.test('following and notifications paginate independently at20 rows', async () => {
    await db.exec(
      "INSERT INTO chapters(id,story_id,title) SELECT n,12,'Chương ' || n FROM generate_series(100,124) n;",
    );
    const first = await (await call('/me/notifications?page=1', 'GET', other)).json();
    const second = await (await call('/me/notifications?page=2', 'GET', other)).json();
    assert.equal(first.notifications.length, 20);
    assert.equal(first.notifications[0].chapterId, '124');
    assert.equal(first.pagination.total, 26);
    assert.equal(second.notifications.length, 6);
    assert.equal(
      new Set([...first.notifications, ...second.notifications].map((n) => n.id)).size,
      26,
    );
  });
  await t.test('deleting a story cascades only its follows and notifications', async () => {
    const before = await count('reader_notifications');
    await db.exec(
      "INSERT INTO stories(id,title,visibility,moderation_status) VALUES(99,'Truyện xóa','public','published');",
    );
    await call('/stories/99/follow', 'PUT');
    await db.exec("INSERT INTO chapters(id,story_id,title) VALUES(900,99,'Chương xóa');");
    assert.equal(await count('reader_notifications'), before + 1);
    await db.exec('DELETE FROM stories WHERE id=99');
    assert.equal(await count('reader_notifications'), before);
    assert.equal((await db.query('SELECT * FROM story_follows WHERE story_id=99')).rows.length, 0);
  });
  await t.test(
    'rollback of migration removes only feature tables; upgrading again is safe',
    async () => {
      const before = await count('chapters');
      await db.exec(migrationSql(lifecycleDown));
      await db.exec(migrationSql(down));
      assert.equal(await count('chapters'), before);
      assert.equal(await count('stories'), 2);
      await db.exec(migrationSql(up));
      assert.equal(await count('reader_notifications'), 0);
    },
  );
});
