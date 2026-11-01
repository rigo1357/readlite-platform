import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}
interface Database extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}
type Account = {
  id: string; email: string; username: string; displayName: string;
  role: 'user' | 'author' | 'admin'; isActive: boolean; emailVerified: boolean;
  statusVersion: number; statusReason: string | null; statusChangedAt: string | null;
};

const roleSchema = z.object({ role: z.enum(['user', 'author', 'admin']) }).strict();
const statusSchema = z.object({ isActive: z.boolean(), reason: z.string().trim().min(1).max(2000),
  expectedStatusVersion: z.number().int().min(0).max(2147483647) }).strict();
const accountFields = 'id::text AS id,email::text AS email,username::text AS username,' +
  'display_name AS "displayName",role,is_active AS "isActive",' +
  '(email_verified_at IS NOT NULL) AS "emailVerified",session_version AS "statusVersion",' +
  'account_status_reason AS "statusReason",account_status_changed_at AS "statusChangedAt"';
function pageOf(value: unknown): number | null {
  return typeof value === 'string' && /^[1-9]\d{0,5}$/u.test(value) ? Number(value) : null;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}

async function adminId(request: Request, response: Response, database: Queryable): Promise<string | null> {
  const id = await readAccessUserId(request.cookies?.readlite_access);
  if (!id) {
    fail(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }
  const result = await database.query<{ id: string }>(
    "SELECT id::text AS id FROM users WHERE id = $1 AND role = 'admin' AND is_active = true AND email_verified_at IS NOT NULL",
    [id],
  );
  if (!result.rows[0]) {
    fail(response, 403, 'FORBIDDEN', 'Chỉ quản trị viên được quản lý tài khoản.');
    return null;
  }
  return id;
}

export function createAdminUsersRouter(database: Database = pool): Router {
  const router = Router();
  router.use('/admin/users', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  const statusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
    handler: (_request, response) => fail(response, 429, 'RATE_LIMITED', 'Quá nhiều thao tác tài khoản. Vui lòng thử lại sau.') });

  router.get('/admin/users', async (request, response, next) => {
    try {
      if (!await adminId(request, response, database)) return;
      const rawSearch = request.query.search;
      if (rawSearch !== undefined && (typeof rawSearch !== 'string' || rawSearch.length > 100)) {
        return fail(response, 400, 'INVALID_REQUEST', 'Từ khóa tìm kiếm không hợp lệ.');
      }
      const search = (rawSearch ?? '').trim();
      const status = request.query.status ?? 'all';
      const page = pageOf(request.query.page ?? '1');
      if (!page || typeof status !== 'string' || !['all', 'active', 'blocked'].includes(status)) {
        return fail(response, 400, 'INVALID_REQUEST', 'Bộ lọc hoặc trang không hợp lệ.');
      }
      const where = 'WHERE ($1::text = \'\' OR email::text ILIKE $2 OR username::text ILIKE $2 OR display_name ILIKE $2) ' +
        "AND ($3::text='all' OR ($3='active' AND is_active=true) OR ($3='blocked' AND is_active=false)) ";
      const values: unknown[] = [search, `%${search.replace(/[\\%_]/g, '\\$&')}%`, status];
      const count = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM users ' + where, values);
      const result = await database.query<Account>(
        'SELECT ' + accountFields + ' FROM users ' + where + 'ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET $4',
        [...values, (page - 1) * 20],
      );
      return response.status(200).json({ users: result.rows, pagination: { page, limit: 20, total: count.rows[0]!.total } });
    } catch (error) { return next(error); }
  });

  router.get('/admin/users/:userId/status-history', async (request, response, next) => {
    try {
      if (!await adminId(request, response, database)) return;
      const id = request.params.userId;
      const page = pageOf(request.query.page ?? '1');
      if (typeof id !== 'string' || !uuidPattern.test(id) || !page) return fail(response, 400, 'INVALID_REQUEST', 'Tài khoản hoặc trang không hợp lệ.');
      const found = await database.query<Account>('SELECT ' + accountFields + ' FROM users WHERE id=$1', [id]);
      if (!found.rows[0]) return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
      const count = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM account_status_events WHERE user_id=$1', [id]);
      const events = await database.query('SELECT e.id::text,e.actor_id::text AS "actorId",e.actor_name AS "actorName",' +
        'e.previous_active AS "previousActive",e.new_active AS "newActive",e.reason,e.created_at AS "createdAt" ' +
        'FROM account_status_events e WHERE e.user_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 20 OFFSET $2', [id, (page - 1) * 20]);
      return response.json({ user: found.rows[0], events: events.rows, pagination: { page, limit: 20, total: count.rows[0]!.total } });
    } catch (error) { return next(error); }
  });

  router.patch('/admin/users/:userId/status', statusLimiter, async (request, response, next) => {
    try {
      const actorId = await adminId(request, response, database); if (!actorId) return;
      if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      const targetId = request.params.userId;
      const parsed = statusSchema.safeParse(request.body);
      if (typeof targetId !== 'string' || !uuidPattern.test(targetId) || !parsed.success) return fail(response, 400, 'INVALID_REQUEST', 'Nhập lý do từ 1–2000 ký tự và tải lại trạng thái tài khoản trước khi xử lý.');
      if (targetId.toLowerCase() === actorId.toLowerCase()) return fail(response, 409, 'SELF_STATUS_CHANGE', 'Không thể tự khóa hoặc thay đổi trạng thái tài khoản của mình.');
      const client = await database.connect(); let started = false;
      try {
        await client.query('BEGIN'); started = true;
        // Share the lock with role changes and account deletion to preserve the final active admin.
        await client.query('SELECT pg_advisory_xact_lock(180718, 1)');
        const actor = await client.query<{ id: string; actorName: string }>("SELECT id,display_name AS \"actorName\" FROM users WHERE id=$1 AND role='admin' AND is_active=true AND email_verified_at IS NOT NULL", [actorId]);
        if (!actor.rows.length) { await client.query('ROLLBACK'); started = false; return fail(response, 403, 'FORBIDDEN', 'Phiên quản trị không còn quyền quản lý tài khoản.'); }
        const target = await client.query<Account>('SELECT ' + accountFields + ' FROM users WHERE id=$1 FOR UPDATE', [targetId]);
        const user = target.rows[0];
        if (!user) { await client.query('ROLLBACK'); started = false; return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy tài khoản.'); }
        if (user.isActive === parsed.data.isActive) { await client.query('COMMIT'); started = false; return response.json({ user, changed: false }); }
        if (user.statusVersion !== parsed.data.expectedStatusVersion) { await client.query('ROLLBACK'); started = false; return fail(response, 409, 'ACCOUNT_STATUS_CHANGED', 'Trạng thái tài khoản đã thay đổi. Hãy tải lại trước khi xử lý.'); }
        if (user.role === 'admin' && user.isActive && user.emailVerified && !parsed.data.isActive) {
          const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE role='admin' AND is_active=true AND email_verified_at IS NOT NULL");
          if (Number(count.rows[0]?.count ?? 0) <= 1) { await client.query('ROLLBACK'); started = false; return fail(response, 409, 'LAST_ADMIN', 'Cần giữ ít nhất một quản trị viên đang hoạt động.'); }
        }
        const updated = await client.query<Account>('UPDATE users SET is_active=$2,session_version=session_version+1,account_status_reason=$3,account_status_changed_at=now() WHERE id=$1 RETURNING ' + accountFields,
          [targetId, parsed.data.isActive, parsed.data.reason]);
        await client.query('UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [targetId]);
        await client.query('INSERT INTO account_status_events(actor_id,user_id,previous_active,new_active,reason,actor_name) VALUES($1,$2,$3,$4,$5,$6)',
          [actorId, targetId, user.isActive, parsed.data.isActive, parsed.data.reason, actor.rows[0]!.actorName]);
        await client.query('COMMIT'); started = false;
        return response.json({ user: updated.rows[0], changed: true });
      } catch (error) { if (started) await client.query('ROLLBACK').catch(() => undefined); throw error; }
      finally { client.release(); }
    } catch (error) { return next(error); }
  });

  router.patch('/admin/users/:userId/role', async (request, response, next) => {
    try {
      const actorId = await adminId(request, response, database);
      if (!actorId) return;
      if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
        return fail(response, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      }
      const targetId = request.params.userId;
      const parsed = roleSchema.safeParse(request.body);
      if (typeof targetId !== 'string' || !uuidPattern.test(targetId) || !parsed.success) {
        return fail(response, 400, 'INVALID_REQUEST', 'Tài khoản hoặc vai trò không hợp lệ.');
      }
      if (targetId.toLowerCase() === actorId.toLowerCase()) {
        return fail(response, 409, 'SELF_ROLE_CHANGE', 'Không thể tự thay đổi quyền của chính mình.');
      }

      const client = await database.connect();
      let started = false;
      try {
        await client.query('BEGIN');
        started = true;
        // Serialize role changes so concurrent demotions cannot remove the final admin.
        await client.query('SELECT pg_advisory_xact_lock(180718, 1)');
        const actor = await client.query<{ id: string }>(
          "SELECT id::text AS id FROM users WHERE id = $1 AND role = 'admin' AND is_active = true AND email_verified_at IS NOT NULL",
          [actorId],
        );
        if (!actor.rows[0]) {
          await client.query('ROLLBACK'); started = false;
          return fail(response, 403, 'FORBIDDEN', 'Phiên quản trị không còn quyền phân quyền.');
        }
        const target = await client.query<Account>(
          'SELECT id::text AS id, email::text AS email, username::text AS username, ' +
            'display_name AS "displayName", role, is_active AS "isActive", ' +
            '(email_verified_at IS NOT NULL) AS "emailVerified" FROM users WHERE id = $1 FOR UPDATE',
          [targetId],
        );
        const user = target.rows[0];
        if (!user) {
          await client.query('ROLLBACK'); started = false;
          return fail(response, 404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
        }
        if (!user.isActive || !user.emailVerified) {
          await client.query('ROLLBACK'); started = false;
          return fail(response, 409, 'ACCOUNT_NOT_READY', 'Tài khoản phải hoạt động và đã xác minh email.');
        }
        if (user.role === 'admin' && parsed.data.role !== 'admin') {
          const count = await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM users WHERE role = 'admin' AND is_active = true AND email_verified_at IS NOT NULL",
          );
          if (Number(count.rows[0]?.count ?? 0) <= 1) {
            await client.query('ROLLBACK'); started = false;
            return fail(response, 409, 'LAST_ADMIN', 'Cần giữ ít nhất một quản trị viên đang hoạt động.');
          }
        }
        if (user.role !== parsed.data.role) {
          await client.query('UPDATE users SET role = $2 WHERE id = $1', [targetId, parsed.data.role]);
          await client.query(
            'INSERT INTO account_role_events (actor_id, user_id, previous_role, new_role) VALUES ($1, $2, $3, $4)',
            [actorId, targetId, user.role, parsed.data.role],
          );
        }
        await client.query('COMMIT'); started = false;
        return response.status(200).json({ user: { ...user, role: parsed.data.role } });
      } catch (error) {
        if (started) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    } catch (error) { return next(error); }
  });

  return router;
}

export const adminUsersRouter = createAdminUsersRouter();
