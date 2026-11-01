import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router, urlencoded } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { accountMailer, type AccountMailer } from '../services/account-mailer.js';
import { clearSessionCookies } from '../middleware/session-status.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '../validation/auth.js';
import { jwtVerify, SignJWT } from 'jose';
import { rateLimit } from 'express-rate-limit';

type RegisteredUser = {
  id: string;
  email: string;
  username: string;
  display_name: string;
};
type LoginUser = {
  id: string;
  role: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  email_verified_at: Date | null;
  is_active: boolean;
  session_version: number;
};

type CurrentUser = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  email_verified_at: Date | null;
  session_version: number;
};

let dummyPasswordHash: Promise<string> | undefined;
function makeAuthLimiter(limit: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
        },
      });
    },
  });
}

export async function readAccessUserId(accessToken: unknown): Promise<string | null> {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      accessToken,
      new TextEncoder().encode(env.authAccessSecret),
      { algorithms: ['HS256'] },
    );

    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
export function csrfTokensMatch(cookieToken: unknown, headerToken: string | undefined): boolean {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
    return false;
  }

  const cookieBytes = Buffer.from(cookieToken, 'utf8');
  const headerBytes = Buffer.from(headerToken, 'utf8');

  return (
    cookieBytes.length > 0 &&
    cookieBytes.length === headerBytes.length &&
    timingSafeEqual(cookieBytes, headerBytes)
  );
}

export function createAuthRouter(database = pool, mailer: AccountMailer = accountMailer) {
  const router = Router();
  const loginLimiter = makeAuthLimiter(20);
  const registerLimiter = makeAuthLimiter(10);
  const forgotPasswordLimiter = makeAuthLimiter(5);
  const resetPasswordLimiter = makeAuthLimiter(5);
  const verifyEmailLimiter = makeAuthLimiter(10);
  const profileLimiter = makeAuthLimiter(10);
  const deleteAccountLimiter = makeAuthLimiter(5);
  const logoutLimiter = makeAuthLimiter(20);
  const logoutAllLimiter = makeAuthLimiter(10);
  const refreshLimiter = makeAuthLimiter(30);
  const changePasswordLimiter = makeAuthLimiter(5);
  const resendVerificationLimiter = makeAuthLimiter(5);

  // The dashboard stores this token per tab, while its cookies are shared between tabs.
  // A refreshed session can therefore leave an older tab with a stale token.
  router.get('/auth/csrf', (request, response) => {
    const token = request.cookies?.readlite_csrf;
    const hasSessionCookie = Boolean(
      request.cookies?.readlite_access || request.cookies?.readlite_refresh,
    );
    response.set('Cache-Control', 'no-store');
    if (typeof token !== 'string' || token.length < 32 || !hasSessionCookie) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }
    response.status(200).json({ csrfToken: token });
  });

  router.get('/auth/me', async (request, response) => {
    const accessToken = request.cookies?.readlite_access;

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    let userId: string;

    try {
      const { payload } = await jwtVerify(
        accessToken,
        new TextEncoder().encode(env.authAccessSecret),
        { algorithms: ['HS256'] },
      );

      if (typeof payload.sub !== 'string') {
        throw new Error('JWT không có subject.');
      }

      userId = payload.sub;
    } catch {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    const userResult = await database.query<CurrentUser>(
      `SELECT
       id,
       email::text AS email,
       username::text AS username,
       display_name,
       role,
       email_verified_at
     FROM users
     WHERE id = $1
       AND is_active = true`,
      [userId],
    );

    const user = userResult.rows[0];

    if (!user || !user.email_verified_at) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    response.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        emailVerified: true,
      },
    });
  });

  router.patch('/auth/me', profileLimiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      response.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'Yêu cầu không hợp lệ.',
        },
      });
      return;
    }

    const userId = await readAccessUserId(request.cookies?.readlite_access);

    if (!userId) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    const result = updateProfileSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Dữ liệu gửi lên không hợp lệ.',
        },
      });
      return;
    }

    try {
      const userResult = await database.query<CurrentUser>(
        `UPDATE users
         SET username = COALESCE($2, username),
             display_name = COALESCE($3, display_name)
         WHERE id = $1
           AND is_active = true
           AND email_verified_at IS NOT NULL
         RETURNING
           id,
           email::text AS email,
           username::text AS username,
           display_name,
           role,
           email_verified_at`,
        [userId, result.data.username ?? null, result.data.displayName ?? null],
      );

      const user = userResult.rows[0];

      if (!user) {
        response.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Vui lòng đăng nhập để tiếp tục.',
          },
        });
        return;
      }

      response.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          emailVerified: true,
        },
        message: 'Hồ sơ đã được cập nhật.',
      });
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : '';

      if (code === '23505') {
        response.status(409).json({
          error: {
            code: 'USERNAME_ALREADY_EXISTS',
            message: 'Tên người dùng đã được sử dụng.',
          },
        });
        return;
      }

      next(error);
    }
  });

  router.delete('/auth/me', deleteAccountLimiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      response.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'Yêu cầu không hợp lệ.',
        },
      });
      return;
    }

    const result = deleteAccountSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Dữ liệu gửi lên không hợp lệ.',
        },
      });
      return;
    }

    const userId = await readAccessUserId(request.cookies?.readlite_access);

    if (!userId) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    const client = await database.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      await client.query('SELECT pg_advisory_xact_lock(180718, 1)');

      const userResult = await client.query<{ password_hash: string; role: string }>(
        `SELECT password_hash, role
         FROM users
         WHERE id = $1
           AND is_active = true
           AND email_verified_at IS NOT NULL
         FOR UPDATE`,
        [userId],
      );

      const user = userResult.rows[0];

      if (!user || !(await bcrypt.compare(result.data.password, user.password_hash))) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        response.status(401).json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Email hoặc mật khẩu không đúng.',
          },
        });
        return;
      }

      if (user.role === 'admin') {
        const count = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM users WHERE role='admin' AND is_active=true AND email_verified_at IS NOT NULL");
        if (Number(count.rows[0]?.count ?? 0) <= 1) {
          await client.query('ROLLBACK'); transactionStarted = false;
          response.status(409).json({ error: { code: 'LAST_ADMIN', message: 'Cần giữ ít nhất một quản trị viên đang hoạt động trước khi xóa tài khoản.' } });
          return;
        }
      }

      await client.query(
        `UPDATE stories
         SET visibility = 'private'
         WHERE owner_id = $1 AND visibility = 'public'`,
        [userId],
      );

      await client.query('DELETE FROM users WHERE id = $1', [userId]);

      await client.query('COMMIT');
      transactionStarted = false;

      response.clearCookie('readlite_access', {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/api/v1',
      });
      response.clearCookie('readlite_refresh', {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/api/v1/auth',
      });
      response.clearCookie('readlite_csrf', {
        httpOnly: false,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/api/v1',
      });

      response.status(204).end();
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  router.post('/auth/login', loginLimiter, async (request, response) => {
    const result = loginSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Dữ liệu gửi lên không hợp lệ.',
        },
      });
      return;
    }

    const { email, password } = result.data;
    const userResult = await database.query<LoginUser>(
      `SELECT
       id,
       email::text AS email,
       username::text AS username,
       display_name,
       password_hash,
       email_verified_at,
       is_active,
       session_version,
       role
     FROM users
     WHERE email = $1`,
      [email],
    );

    const user = userResult.rows[0];
    let hashToCompare = user?.password_hash;

    if (!hashToCompare) {
      dummyPasswordHash ??= bcrypt.hash(randomBytes(32).toString('hex'), 12);
      hashToCompare = await dummyPasswordHash;
    }

    const passwordMatches = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatches || !user.email_verified_at) {
      response.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email hoặc mật khẩu không đúng.',
        },
      });
      return;
    }

    const refreshToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    let accessToken: string;
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      // Login, refresh and administrative suspension all lock the user before token rows.
      const locked = await client.query<LoginUser>(
        'SELECT id,email::text AS email,username::text AS username,display_name,password_hash,email_verified_at,is_active,role,session_version FROM users WHERE id=$1 FOR NO KEY UPDATE', [user.id]);
      const current = locked.rows[0];
      if (!current || current.password_hash !== user.password_hash || !current.email_verified_at) {
        await client.query('ROLLBACK');
        response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
        return;
      }
      if (!current.is_active) {
        await client.query('ROLLBACK');
        clearSessionCookies(response);
        response.status(403).json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' } });
        return;
      }
      Object.assign(user, current);
      accessToken = await new SignJWT({ email: user.email, username: user.username, role: user.role, sessionVersion: user.session_version ?? 0 })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(user.id).setIssuedAt().setExpirationTime('15m')
        .sign(new TextEncoder().encode(env.authAccessSecret));
      await client.query('INSERT INTO refresh_tokens(user_id,token_hash,expires_at,user_agent) VALUES($1,$2,$3,$4)',
        [user.id, refreshTokenHash, refreshExpiresAt, request.get('user-agent') ?? null]);
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      response.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Không thể tạo phiên đăng nhập. Vui lòng thử lại.' } });
      return;
    } finally { client.release(); }

    response.cookie('readlite_access', accessToken, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1',
      maxAge: 15 * 60 * 1000,
    });

    response.cookie('readlite_refresh', refreshToken, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    response.cookie('readlite_csrf', csrfToken, {
      httpOnly: false,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    response.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        emailVerified: true,
      },
      csrfToken,
      message: 'Đăng nhập thành công.',
    });
  });

  router.post('/auth/logout', logoutLimiter, async (request, response) => {
    const csrfIsValid = csrfTokensMatch(
      request.cookies?.readlite_csrf,
      request.get('x-csrf-token'),
    );

    if (!csrfIsValid) {
      response.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'Yêu cầu không hợp lệ.',
        },
      });
      return;
    }

    const refreshToken = request.cookies?.readlite_refresh;

    if (typeof refreshToken === 'string' && refreshToken.length > 0) {
      const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');

      await database.query(
        `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_hash = $1`,
        [refreshTokenHash],
      );
    }

    response.clearCookie('readlite_access', {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1',
    });

    response.clearCookie('readlite_refresh', {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });

    response.clearCookie('readlite_csrf', {
      httpOnly: false,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/api/v1',
    });

    response.status(204).end();
  });

  router.post('/auth/logout-all', logoutAllLimiter, async (request, response, next) => {
    const csrfCookie = request.cookies?.readlite_csrf;
    const csrfHeader = request.get('x-csrf-token');

    if (!csrfTokensMatch(csrfCookie, csrfHeader)) {
      response.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'Yêu cầu không hợp lệ.',
        },
      });
      return;
    }

    const accessToken = request.cookies?.readlite_access;

    if (!accessToken) {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    let userId: string;

    try {
      const { payload } = await jwtVerify(
        accessToken,
        new TextEncoder().encode(env.authAccessSecret),
        { algorithms: ['HS256'] },
      );

      if (typeof payload.sub !== 'string') {
        response.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Vui lòng đăng nhập để tiếp tục.',
          },
        });
        return;
      }

      userId = payload.sub;
    } catch {
      response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Vui lòng đăng nhập để tiếp tục.',
        },
      });
      return;
    }

    try {
      await database.query(
        `UPDATE refresh_tokens
       SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );

      response.clearCookie('readlite_access', {
        path: '/api/v1',
        secure: env.cookieSecure,
      });
      response.clearCookie('readlite_refresh', {
        path: '/api/v1/auth',
        secure: env.cookieSecure,
      });
      response.clearCookie('readlite_csrf', {
        path: '/api/v1',
        secure: env.cookieSecure,
      });

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/refresh', refreshLimiter, async (request, response) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      response.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'Yêu cầu không hợp lệ.',
        },
      });
      return;
    }

    const refreshToken = request.cookies?.readlite_refresh;

    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      response.status(401).json({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        },
      });
      return;
    }

    const oldTokenHash = createHash('sha256').update(refreshToken).digest('hex');

    const client = await database.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const candidate = await client.query<{ user_id: string }>(
        'SELECT user_id FROM refresh_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',
        [oldTokenHash],
      );

      const oldToken = candidate.rows[0];

      if (!oldToken) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        response.status(401).json({
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
          },
        });
        return;
      }

      const userResult = await client.query<CurrentUser>(
        `SELECT
         id,
         email::text AS email,
         username::text AS username,
         display_name,
         role,
         email_verified_at,
         session_version
       FROM users
       WHERE id = $1
         AND is_active = true
         AND email_verified_at IS NOT NULL
         FOR NO KEY UPDATE`,
        [oldToken.user_id],
      );

      const consumed = await client.query(
        'UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() RETURNING user_id',
        [oldTokenHash, oldToken.user_id]);
      if (!consumed.rows.length) {
        await client.query('ROLLBACK'); transactionStarted = false;
        response.status(401).json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' } });
        return;
      }

      const user = userResult.rows[0];

      if (!user) {
        await client.query('COMMIT');
        transactionStarted = false;

        response.status(401).json({
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
          },
        });
        return;
      }

      const accessToken = await new SignJWT({
        email: user.email,
        username: user.username,
        role: user.role,
        sessionVersion: user.session_version ?? 0,
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(new TextEncoder().encode(env.authAccessSecret));

      const newRefreshToken = randomBytes(32).toString('base64url');
      const newCsrfToken = randomBytes(32).toString('base64url');
      const newRefreshTokenHash = createHash('sha256').update(newRefreshToken).digest('hex');
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO refresh_tokens (
         user_id, token_hash, expires_at, user_agent
       )
       VALUES ($1, $2, $3, $4)`,
        [user.id, newRefreshTokenHash, refreshExpiresAt, request.get('user-agent') ?? null],
      );

      await client.query('COMMIT');
      transactionStarted = false;

      response.cookie('readlite_access', accessToken, {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/api/v1',
        maxAge: 15 * 60 * 1000,
      });

      response.cookie('readlite_refresh', newRefreshToken, {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      response.cookie('readlite_csrf', newCsrfToken, {
        httpOnly: false,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/api/v1',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      response.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          emailVerified: true,
        },
        csrfToken: newCsrfToken,
        message: 'Phiên đăng nhập đã được làm mới.',
      });
    } catch {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Không thể làm mới phiên đăng nhập ReadLite.');
      response.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Đã xảy ra lỗi hệ thống.',
        },
      });
    } finally {
      client.release();
    }
  });

  router.post('/auth/change-password', changePasswordLimiter, async (request, response, next) => {
    if (!csrfTokensMatch(request.cookies?.readlite_csrf, request.get('x-csrf-token'))) {
      return response
        .status(403)
        .json({ error: { code: 'CSRF_INVALID', message: 'Yêu cầu không hợp lệ.' } });
    }
    const userId = await readAccessUserId(request.cookies?.readlite_access);
    if (!userId)
      return response
        .status(401)
        .json({ error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để tiếp tục.' } });
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Mật khẩu cần ít nhất 8 ký tự và tối đa 72 byte.',
          },
        });
    try {
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL FOR NO KEY UPDATE',
          [userId],
        );
        if (!found.rows[0]) {
          await client.query('ROLLBACK');
          return response
            .status(401)
            .json({ error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để tiếp tục.' } });
        }
        if (!(await bcrypt.compare(parsed.data.currentPassword, found.rows[0].password_hash))) {
          await client.query('ROLLBACK');
          return response
            .status(400)
            .json({
              error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Mật khẩu hiện tại không đúng.' },
            });
        }
        const passwordHash = await bcrypt.hash(parsed.data.password, 12);
        await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
          userId,
          passwordHash,
        ]);
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [userId],
        );
        await client.query(
          'UPDATE password_resets SET used_at = COALESCE(used_at, now()) WHERE user_id = $1',
          [userId],
        );
        await client.query('COMMIT');
        response.clearCookie('readlite_access', {
          httpOnly: true,
          secure: env.cookieSecure,
          sameSite: 'lax',
          path: '/api/v1',
        });
        response.clearCookie('readlite_refresh', {
          httpOnly: true,
          secure: env.cookieSecure,
          sameSite: 'lax',
          path: '/api/v1/auth',
        });
        response.clearCookie('readlite_csrf', {
          httpOnly: false,
          secure: env.cookieSecure,
          sameSite: 'lax',
          path: '/api/v1',
        });
        return response.json({ message: 'Mật khẩu đã được thay đổi. Hãy đăng nhập lại.' });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/auth/resend-verification',
    resendVerificationLimiter,
    async (request, response, next) => {
      const parsed = forgotPasswordSchema.safeParse(request.body);
      if (!parsed.success)
        return response
          .status(400)
          .json({ error: { code: 'INVALID_REQUEST', message: 'Dữ liệu gửi lên không hợp lệ.' } });
      try {
        const client = await database.connect();
        let token: string | undefined;
        try {
          await client.query('BEGIN');
          const found = await client.query<{ id: string }>(
            'SELECT id FROM users WHERE email = $1 AND is_active = true AND email_verified_at IS NULL FOR NO KEY UPDATE',
            [parsed.data.email],
          );
          if (found.rows[0]) {
            token = randomBytes(32).toString('base64url');
            const tokenHash = createHash('sha256').update(token).digest('hex');
            await client.query(
              'UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
              [found.rows[0].id],
            );
            await client.query(
              'INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
              [found.rows[0].id, tokenHash, new Date(Date.now() + 24 * 60 * 60 * 1000)],
            );
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        if (token) {
          void mailer
            .sendVerification({ email: parsed.data.email, token })
            .catch(() =>
              console.error(
                'Không thể gửi email xác minh ReadLite. Người dùng có thể yêu cầu gửi lại.',
              ),
            );
        }
        return response
          .status(202)
          .json({
            message: 'Nếu email thuộc tài khoản chưa xác minh, hướng dẫn xác minh sẽ được gửi.',
          });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post('/auth/forgot-password', forgotPasswordLimiter, async (request, response, next) => {
    const result = forgotPasswordSchema.safeParse(request.body);

    if (!result.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Dữ liệu gửi lên không hợp lệ.',
        },
      });
      return;
    }

    try {
      const client = await database.connect();
      let rawToken: string | undefined;
      try {
        await client.query('BEGIN');
        const userResult = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE email = $1 AND is_active = true
         AND email_verified_at IS NOT NULL FOR NO KEY UPDATE`,
          [result.data.email],
        );
        const user = userResult.rows[0];
        if (user) {
          rawToken = randomBytes(32).toString('base64url');
          const tokenHash = createHash('sha256').update(rawToken).digest('hex');
          await client.query(
            'UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
            [user.id],
          );
          await client.query(
            'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [user.id, tokenHash, new Date(Date.now() + 30 * 60 * 1000)],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      if (rawToken) {
        void mailer
          .sendPasswordReset({ email: result.data.email, token: rawToken })
          .catch(() =>
            console.error(
              'Không thể gửi email đặt lại mật khẩu ReadLite. Người dùng có thể yêu cầu lại.',
            ),
          );
      }

      response.status(202).json({
        message: 'Nếu email thuộc tài khoản ReadLite, hướng dẫn đặt lại mật khẩu sẽ được gửi.',
      });
    } catch (error) {
      next(error);
    }
  });

  // A minimal browser fallback makes reset links usable without an installed Android app.
  router.get('/auth/reset-password', (request, response) => {
    const parsed = verifyEmailSchema.safeParse(request.query);
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (!parsed.success)
      return response
        .status(400)
        .type('html')
        .send(
          '<!doctype html><html lang="vi"><meta charset="utf-8"><title>ReadLite</title><p>Liên kết không hợp lệ. Hãy yêu cầu email đặt lại mật khẩu mới.</p></html>',
        );
    const token = parsed.data.token.replace(
      /[&<>"']/g,
      (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!,
    );
    const nonce = randomBytes(18).toString('base64');
    response.set(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    );
    return response
      .type('html')
      .send(
        `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đặt lại mật khẩu · ReadLite</title><style nonce="${nonce}">body{font:16px system-ui;background:#f4f5f1;color:#183b32;margin:0;padding:40px 20px}main{max-width:420px;margin:10vh auto;background:white;border-radius:18px;padding:28px}h1{font-size:26px}label,input,button{display:block;box-sizing:border-box;width:100%;margin-top:16px}input,button{padding:14px;border:1px solid #b8c9c1;border-radius:8px;font:inherit}button{background:#256550;color:white;cursor:pointer}p{line-height:1.6}</style></head><body><main><h1>Đặt lại mật khẩu</h1><p>Nhập mật khẩu mới cho tài khoản ReadLite. Liên kết chỉ sử dụng một lần và có hiệu lực 30 phút.</p><form method="post" action="/api/v1/auth/reset-password"><input type="hidden" name="token" value="${token}"><label for="password">Mật khẩu mới</label><input id="password" name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required><p>Ít nhất 8 ký tự, tối đa 72 byte.</p><button type="submit">Lưu mật khẩu</button></form></main></body></html>`,
      );
  });

  router.post(
    '/auth/reset-password',
    resetPasswordLimiter,
    urlencoded({ extended: false, limit: '10kb' }),
    async (request, response, next) => {
      const result = resetPasswordSchema.safeParse(request.body);

      if (!result.success) {
        response.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Dữ liệu gửi lên không hợp lệ.',
          },
        });
        return;
      }

      const tokenHash = createHash('sha256').update(result.data.token).digest('hex');

      const client = await database.connect();
      let transactionStarted = false;

      try {
        await client.query('BEGIN');
        transactionStarted = true;

        // Use the same user-first lock order as password changes and reset requests.
        const candidate = await client.query<{ user_id: string }>(
          'SELECT user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
          [tokenHash],
        );
        if (candidate.rows[0])
          await client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [
            candidate.rows[0].user_id,
          ]);

        const resetResult = await client.query<{ user_id: string }>(
          `UPDATE password_resets
         SET used_at = now()
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > now()
         RETURNING user_id`,
          [tokenHash],
        );

        const reset = resetResult.rows[0];

        if (!reset) {
          await client.query('ROLLBACK');
          transactionStarted = false;

          response.status(400).json({
            error: {
              code: 'INVALID_OR_EXPIRED_TOKEN',
              message: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
            },
          });
          return;
        }

        const passwordHash = await bcrypt.hash(result.data.password, 12);

        const userResult = await client.query(
          `UPDATE users
         SET password_hash = $2
         WHERE id = $1 AND is_active = true`,
          [reset.user_id, passwordHash],
        );

        if (userResult.rowCount !== 1) {
          await client.query('ROLLBACK');
          transactionStarted = false;

          response.status(400).json({
            error: {
              code: 'INVALID_OR_EXPIRED_TOKEN',
              message: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
            },
          });
          return;
        }

        await client.query(
          `UPDATE password_resets
         SET used_at = COALESCE(used_at, now())
         WHERE user_id = $1`,
          [reset.user_id],
        );

        await client.query(
          `UPDATE refresh_tokens
         SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
          [reset.user_id],
        );

        await client.query('COMMIT');
        transactionStarted = false;

        if (request.is('application/x-www-form-urlencoded')) {
          response
            .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
            .status(200)
            .type('html')
            .send(
              '<!doctype html><html lang="vi"><meta charset="utf-8"><title>ReadLite</title><h1>Đã đặt lại mật khẩu</h1><p>Hãy quay lại ứng dụng ReadLite và đăng nhập bằng mật khẩu mới.</p></html>',
            );
        } else {
          response.status(200).json({ message: 'Mật khẩu đã được đặt lại. Hãy đăng nhập lại.' });
        }
      } catch (error) {
        if (transactionStarted) {
          await client.query('ROLLBACK').catch(() => undefined);
        }
        next(error);
      } finally {
        client.release();
      }
    },
  );

  router.post('/auth/register', registerLimiter, async (request, response) => {
    const result = registerSchema.safeParse(request.body);

    if (!result.success) {
      return response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Dữ liệu gửi lên không hợp lệ.',
        },
      });
    }

    const { email, username, password, displayName } = result.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const client = await database.connect();
    let transactionStarted = false;
    let createdUser: RegisteredUser | undefined;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const userResult = await client.query<RegisteredUser>(
        `INSERT INTO users (email, username, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id,
         email::text AS email,
         username::text AS username,
         display_name`,
        [email, username, passwordHash, displayName],
      );

      createdUser = userResult.rows[0];

      if (!createdUser) {
        throw new Error('Không tạo được tài khoản.');
      }

      await client.query('INSERT INTO user_settings (user_id) VALUES ($1)', [createdUser.id]);

      await client.query(
        `INSERT INTO email_verifications (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
        [createdUser.id, tokenHash, tokenExpiresAt],
      );

      await client.query('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      const errorCode =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : '';

      if (errorCode === '23505') {
        return response.status(409).json({
          error: {
            code: 'ACCOUNT_ALREADY_EXISTS',
            message: 'Email hoặc tên người dùng đã được sử dụng.',
          },
        });
      }

      console.error('Không thể tạo tài khoản ReadLite.');
      return response.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Đã xảy ra lỗi hệ thống.',
        },
      });
    } finally {
      client.release();
    }

    if (!createdUser) {
      return response.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Đã xảy ra lỗi hệ thống.',
        },
      });
    }

    void mailer
      .sendVerification({ email: createdUser.email, token: rawToken })
      .catch(() =>
        console.error('Không thể gửi email xác minh ReadLite. Người dùng có thể yêu cầu gửi lại.'),
      );

    return response.status(201).json({
      user: {
        id: createdUser.id,
        email: createdUser.email,
        username: createdUser.username,
        displayName: createdUser.display_name,
        emailVerified: false,
      },
      message: 'Đăng ký thành công. Hãy xác minh email để tiếp tục.',
    });
  });
  router.get('/auth/verify-email', verifyEmailLimiter, async (request, response) => {
    const result = verifyEmailSchema.safeParse(request.query);

    if (!result.success) {
      return response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Dữ liệu gửi lên không hợp lệ.',
        },
      });
    }

    const tokenHash = createHash('sha256').update(result.data.token).digest('hex');

    const client = await database.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const candidate = await client.query<{ user_id: string }>(
        'SELECT user_id FROM email_verifications WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
        [tokenHash],
      );
      if (candidate.rows[0])
        await client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [
          candidate.rows[0].user_id,
        ]);

      const verificationResult = await client.query<{ user_id: string }>(
        `UPDATE email_verifications
       SET used_at = now()
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now()
       RETURNING user_id`,
        [tokenHash],
      );

      const verification = verificationResult.rows[0];

      if (!verification) {
        await client.query('ROLLBACK');
        transactionStarted = false;

        return response.status(400).json({
          error: {
            code: 'INVALID_OR_EXPIRED_TOKEN',
            message: 'Liên kết xác minh không hợp lệ hoặc đã hết hạn.',
          },
        });
      }

      const userResult = await client.query(
        `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, now())
       WHERE id = $1`,
        [verification.user_id],
      );

      if (userResult.rowCount !== 1) {
        throw new Error('Không tìm thấy tài khoản cần xác minh.');
      }

      await client.query('COMMIT');
      transactionStarted = false;

      return response.status(200).json({
        message: 'Email đã được xác minh.',
      });
    } catch {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => undefined);
      }

      console.error('Không thể xác minh email ReadLite.');
      return response.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Đã xảy ra lỗi hệ thống.',
        },
      });
    } finally {
      client.release();
    }
  });

  return router;
}
export const authRouter = createAuthRouter();
