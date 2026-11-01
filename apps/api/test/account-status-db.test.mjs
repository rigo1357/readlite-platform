import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { SignJWT, decodeJwt } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { up as core } from '../../../db/migrations/002-core-schema.ts';
import { up as submissions } from '../../../db/migrations/003-story-submissions-media.ts';
import { up as roleHistory } from '../../../db/migrations/007-account-role-events.ts';
import { up, down } from '../../../db/migrations/010-account-status-management.ts';
import { createAdminUsersRouter } from '../dist/routes/admin-users.js';
import { createAuthRouter } from '../dist/routes/auth.js';
import { createSessionStatusGuard } from '../dist/middleware/session-status.js';
import { env } from '../dist/config/env.js';

const admin = '10000000-0000-4000-8000-000000000001';
const secondAdmin = '10000000-0000-4000-8000-000000000002';
const author = '10000000-0000-4000-8000-000000000003';
const reader = '10000000-0000-4000-8000-000000000004';
const csrf = 'account-status-csrf-01234567890123456789';
const password = 'AccountPassword123!';
function sql(migration) { let text = ''; migration({ sql(s) { text += s; } }); return text; }
function sessionCookies(response) {
  return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
}

test('account suspension: actual PostgreSQL migrations, audit, session revocation and login recovery', async t => {
  const db = new PGlite({ extensions: { citext, pg_trgm, unaccent } });
  let server = null;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); });
  await db.exec('CREATE EXTENSION citext; CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent;');
  for (const migration of [core, submissions, roleHistory, up]) await db.exec(sql(migration));
  const passwordHash = await bcrypt.hash(password, 4);
  for (const [id, username, role] of [[admin, 'admin', 'admin'], [secondAdmin, 'admin2', 'admin'], [author, 'author', 'author'], [reader, 'reader', 'user']]) {
    await db.query('INSERT INTO users(id,email,username,password_hash,display_name,role,email_verified_at) VALUES($1,$2,$3::citext,$4,$3::text,$5,now())', [id, username + '@test.invalid', username, passwordHash, role]);
  }
  const statements = [];
  const query = async (text, values) => { statements.push(text); const result = await db.query(text, values); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const database = { query, async connect() { return { query, release() {} }; } };
  const app = express(); app.use(express.json(), cookieParser());
  app.use('/api/v1', createSessionStatusGuard(database), createAdminUsersRouter(database), createAuthRouter(database, { async sendVerification() {}, async sendPasswordReset() {} }));
  app.get('/api/v1/private', (_req, res) => res.json({ accepted: true }));
  app.use((error, _req, res, next) => res.headersSent ? next(error) : res.status(500).json({ error: { code: 'TEST_ERROR', message: error.message } }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function token(id, version = 0) {
    return new SignJWT(version === null ? {} : { sessionVersion: version }).setProtectedHeader({ alg: 'HS256' }).setSubject(id).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(env.authAccessSecret));
  }
  async function call(path, method = 'GET', body, options = {}) {
    const cookies = options.cookies ?? (options.user === null ? '' : `readlite_access=${await token(options.user ?? admin, options.version ?? 0)}; readlite_csrf=${csrf}`);
    return fetch(base + path, { method, headers: { cookie: cookies, ...(options.csrf === false ? {} : { 'x-csrf-token': options.csrfToken ?? csrf }), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function status(id, active, version, reason = active ? 'Đã xử lý vi phạm' : 'Vi phạm nội quy', options = {}) {
    return call(`/admin/users/${id}/status`, 'PATCH', { isActive: active, expectedStatusVersion: version, reason }, options);
  }
  const countEvents = async () => Number((await db.query('SELECT count(*) AS count FROM account_status_events')).rows[0].count);
  async function login(username = 'author', pass = password) { return call('/auth/login', 'POST', { email: username + '@test.invalid', password: pass }, { user: null }); }
  async function refresh(cookies) { const match = /readlite_csrf=([^;]+)/.exec(cookies); return call('/auth/refresh', 'POST', {}, { cookies, csrfToken: match?.[1] ?? csrf }); }
  let originalCookies;
  let originalAccess;
  let recoveredCookies;
  await t.test('migration preserves active accounts and permits existing legacy tokens before suspension', async () => {
    assert.equal((await call('/private', 'GET', undefined, { cookies: `readlite_access=${await token(author, null)}` })).status, 200);
    const result = await db.query('SELECT session_version,is_active FROM users WHERE id=$1', [author]);
    assert.equal(result.rows[0].session_version, 0); assert.equal(result.rows[0].is_active, true); assert.equal(await countEvents(), 0);
  });
  await t.test('only admin may list, view history or mutate; CSRF, self-lock, UUID and strict reason/version validation', async () => {
    assert.equal((await call('/admin/users', 'GET', undefined, { user: null })).status, 401);
    assert.equal((await call('/admin/users', 'GET', undefined, { user: author })).status, 403);
    assert.equal((await call(`/admin/users/${author}/status-history`, 'GET', undefined, { user: reader })).status, 403);
    assert.equal((await status(author, false, 0, 'Lý do', { csrf: false })).status, 403);
    assert.equal((await status(admin, false, 0)).status, 409);
    assert.equal((await status(admin.toUpperCase(), false, 0)).status, 409);
    assert.equal((await status('not-a-uuid', false, 0)).status, 400);
    for (const body of [
      { isActive: false, reason: '   ', expectedStatusVersion: 0 },
      { isActive: false, reason: 'x'.repeat(2001), expectedStatusVersion: 0 },
      { isActive: 'false', reason: 'Vi phạm', expectedStatusVersion: 0 },
      { isActive: false, reason: 'Vi phạm', expectedStatusVersion: -1 },
      { isActive: false, reason: 'Vi phạm', expectedStatusVersion: 0, role: 'admin' },
    ]) assert.equal((await call(`/admin/users/${author}/status`, 'PATCH', body)).status, 400);
    assert.equal((await status('20000000-0000-4000-8000-000000000099', false, 0)).status, 404);
    assert.equal(await countEvents(), 0);
  });
  await t.test('login issues current-version access token and stores refresh token under the user lock', async () => {
    statements.length = 0;
    const res = await login(); assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    originalCookies = sessionCookies(res); originalAccess = /readlite_access=([^;]+)/.exec(originalCookies)[1];
    assert.equal(decodeJwt(originalAccess).sessionVersion, 0);
    assert.ok(statements.findIndex(s => s.includes('FOR NO KEY UPDATE')) < statements.findIndex(s => s.startsWith('INSERT INTO refresh_tokens')));
    assert.equal((await call('/auth/me', 'GET', undefined, { cookies: originalCookies })).status, 200);
  });
  await t.test('blocking is atomic, keeps content, records one event and invalidates current access and refresh sessions', async () => {
    await db.query("INSERT INTO stories(owner_id,title,source,visibility) VALUES($1,'Bản thảo được giữ','manual','private')", [author]);
    const result = await status(author, false, 0, '  Spam bình luận liên tục  '); assert.equal(result.status, 200);
    const payload = await result.json(); assert.equal(payload.user.isActive, false); assert.equal(payload.user.statusVersion, 1); assert.equal(payload.user.statusReason, 'Spam bình luận liên tục');
    assert.equal(await countEvents(), 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL', [author])).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stories WHERE owner_id=$1', [author])).rows[0].n, 1);
    const denied = await call('/auth/me', 'GET', undefined, { cookies: originalCookies });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'ACCOUNT_SUSPENDED');
    assert.ok(denied.headers.getSetCookie().some(c => c.startsWith('readlite_access=;')));
    assert.equal((await call('/private', 'GET', undefined, { cookies: originalCookies })).status, 403);
    assert.equal((await refresh(originalCookies)).status, 401);
    assert.equal((await login()).status, 403); assert.equal((await login('author', 'wrong password')).status, 401);
    const replay = await status(author, false, 0, 'Retry'); assert.equal(replay.status, 200); assert.equal((await replay.json()).changed, false); assert.equal(await countEvents(), 1);
  });
  await t.test('unlock requires a fresh login: access and refresh tokens captured before blocking remain invalid', async () => {
    assert.equal((await status(author, true, 1)).status, 200);
    const old = await call('/auth/me', 'GET', undefined, { cookies: originalCookies }); assert.equal(old.status, 401); assert.equal((await old.json()).error.code, 'SESSION_REVOKED');
    assert.equal((await refresh(originalCookies)).status, 401);
    assert.equal((await call('/private', 'GET', undefined, { cookies: `readlite_access=${await token(author, null)}` })).status, 401);
    const fresh = await login(); assert.equal(fresh.status, 200); recoveredCookies = sessionCookies(fresh);
    assert.equal(decodeJwt(/readlite_access=([^;]+)/.exec(recoveredCookies)[1]).sessionVersion, 2);
    assert.equal((await call('/auth/me', 'GET', undefined, { cookies: recoveredCookies })).status, 200);
    const renewed = await refresh(recoveredCookies); assert.equal(renewed.status, 200, JSON.stringify(await renewed.clone().json()));
    assert.equal(decodeJwt(/readlite_access=([^;]+)/.exec(sessionCookies(renewed))[1]).sessionVersion, 2);
    assert.equal(await countEvents(), 2);
  });
  await t.test('stale status screen cannot overwrite a more recent lock/unlock; roles remain unchanged', async () => {
    const stale = await status(author, false, 0); assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'ACCOUNT_STATUS_CHANGED');
    assert.equal((await db.query('SELECT role,is_active FROM users WHERE id=$1', [author])).rows[0].role, 'author');
    assert.equal(await countEvents(), 2);
  });
  await t.test('history gives actor/reason/date, paginates, filters accounts and disables caching', async () => {
    const history = await call(`/admin/users/${author}/status-history`); assert.equal(history.headers.get('cache-control'), 'no-store');
    const data = await history.json(); assert.equal(data.events.length, 2); assert.equal(data.events[0].newActive, true); assert.equal(data.events[1].reason, 'Spam bình luận liên tục');
    assert.equal(data.events[0].actorId, admin); assert.equal(data.events[0].actorName, 'admin'); assert.ok(data.events[0].createdAt);
    await status(reader, false, 0);
    const staleAdmin = await status(reader, true, 0, 'Màn hình cũ của admin khác', { user: secondAdmin });
    assert.equal(staleAdmin.status, 409); assert.equal((await staleAdmin.json()).error.code, 'ACCOUNT_STATUS_CHANGED');
    const blocked = await (await call('/admin/users?status=blocked')).json(); assert.equal(blocked.users.length, 1); assert.equal(blocked.users[0].id, reader);
    const match = await (await call('/admin/users?search=author&status=active')).json(); assert.equal(match.users.length, 1); assert.equal(match.users[0].statusVersion, 2);
    assert.equal((await (await call('/admin/users?search=%25')).json()).users.length, 0);
    assert.equal((await call('/admin/users?page=0')).status, 400); assert.equal((await call('/admin/users?status=other')).status, 400);
    assert.equal((await call(`/admin/users/${author}/status-history?page=0`)).status, 400);
    for (let i = 0; i < 21; i++) await db.query("INSERT INTO account_status_events(actor_id,actor_name,user_id,previous_active,new_active,reason) VALUES($1,'admin',$2,$3,$4,$5)", [admin, author, i % 2 === 0, i % 2 !== 0, 'Dữ liệu thử phân trang']);
    const page = await (await call(`/admin/users/${author}/status-history?page=2`)).json(); assert.equal(page.events.length, 3); assert.equal(page.pagination.total, 23);
  });
  await t.test('failed audit insert rolls back status, session version and token revocation together', async () => {
    const before = await countEvents();
    await db.query("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,'rollback-session',now()+interval '1 day')", [author]);
    await db.exec("CREATE FUNCTION fail_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$; CREATE TRIGGER fail_status_audit BEFORE INSERT ON account_status_events FOR EACH ROW EXECUTE FUNCTION fail_status_audit();");
    assert.equal((await status(author, false, 2)).status, 500);
    assert.equal((await db.query('SELECT is_active,session_version FROM users WHERE id=$1', [author])).rows[0].is_active, true);
    assert.equal((await db.query('SELECT session_version FROM users WHERE id=$1', [author])).rows[0].session_version, 2);
    assert.equal((await db.query("SELECT revoked_at FROM refresh_tokens WHERE token_hash='rollback-session'")).rows[0].revoked_at, null);
    assert.equal(await countEvents(), before);
    await db.exec('DROP TRIGGER fail_status_audit ON account_status_events; DROP FUNCTION fail_status_audit();');
  });
  await t.test('blocked admin cannot manage users; self-lock and deletion cannot remove the final active administrator', async () => {
    assert.equal((await status(secondAdmin, false, 0)).status, 200);
    assert.equal((await status(author, false, 2, 'Forbidden', { user: secondAdmin })).status, 403);
    assert.equal((await status(admin, false, 0)).status, 409);
    const deleted = await call('/auth/me', 'DELETE', { password }); assert.equal(deleted.status, 409); assert.equal((await deleted.json()).error.code, 'LAST_ADMIN');
    const demoted = await call(`/admin/users/${admin}/role`, 'PATCH', { role: 'user' }); assert.equal(demoted.status, 409);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND is_active=true")).rows[0].n, 1);
    const unverified = '10000000-0000-4000-8000-000000000009';
    await db.query("INSERT INTO users(id,email,username,password_hash,display_name,role) VALUES($1,'unverified@test.invalid','unverified',$2,'Chưa xác minh','admin')", [unverified, passwordHash]);
    assert.equal((await status(unverified, false, 0)).status, 200);
    await db.query('DELETE FROM users WHERE id=$1', [unverified]);
  });
  await t.test('logout remains available to a suspended session and clears its cookies', async () => {
    const response = await call('/auth/logout', 'POST', {}, { user: reader }); assert.equal(response.status, 204);
    assert.ok(response.headers.getSetCookie().some(c => c.startsWith('readlite_csrf=;')));
  });
  await t.test('history retains the administrator name even after that account is renamed and deleted', async () => {
    await db.query("INSERT INTO account_status_events(actor_id,actor_name,user_id,previous_active,new_active,reason) VALUES($1,'Admin đã xử lý',$2,true,false,'Giữ thông tin người xử lý')", [secondAdmin, reader]);
    await db.query("UPDATE users SET display_name='Tên mới' WHERE id=$1", [secondAdmin]);
    await db.query('DELETE FROM users WHERE id=$1', [secondAdmin]);
    const history = await (await call(`/admin/users/${reader}/status-history`)).json();
    assert.equal(history.events[0].actorName, 'Admin đã xử lý'); assert.equal(history.events[0].actorId, null);
  });
  await t.test('migration rollback preserves accounts and their blocked/active state', async () => {
    await db.exec(sql(down));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 3);
    assert.equal((await db.query('SELECT is_active FROM users WHERE id=$1', [reader])).rows[0].is_active, false);
  });
});
