import type { RequestHandler, Response } from 'express';
import { jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

interface Database {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie('readlite_access', { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/api/v1' });
  response.clearCookie('readlite_refresh', { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/api/v1/auth' });
  response.clearCookie('readlite_csrf', { httpOnly: false, secure: env.cookieSecure, sameSite: 'lax', path: '/api/v1' });
}

// These flows authenticate independently or must remain usable after a session is revoked.
const independentPaths = new Set(['/health', '/auth/login', '/auth/register', '/auth/refresh', '/auth/csrf',
  '/auth/logout', '/auth/forgot-password', '/auth/reset-password', '/auth/resend-verification', '/auth/verify-email']);

export function createSessionStatusGuard(database: Database = pool): RequestHandler {
  return async (request, response, next) => {
    const path = request.path.replace(/\/+$/u, '').toLowerCase() || '/';
    if (independentPaths.has(path) || request.method === 'OPTIONS') return next();
    const token: unknown = request.cookies?.readlite_access;
    if (typeof token !== 'string' || !token) return next();
    let userId: string;
    let version: unknown;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.authAccessSecret), { algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(payload.sub)) return next();
      userId = payload.sub;
      // Tokens issued before migration 010 are valid until the account's first revocation.
      version = payload.sessionVersion ?? 0;
    } catch { return next(); }
    try {
      const found = await database.query<{ isActive: boolean; sessionVersion: number }>(
        'SELECT is_active AS "isActive",session_version AS "sessionVersion" FROM users WHERE id=$1', [userId]);
      const user = found.rows[0];
      if (user && !user.isActive) {
        clearSessionCookies(response);
        response.setHeader('Cache-Control', 'no-store');
        response.status(403).json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' } });
        return;
      }
      if (!user || !Number.isInteger(version) || version !== user.sessionVersion) {
        clearSessionCookies(response);
        response.setHeader('Cache-Control', 'no-store');
        response.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'Phiên đăng nhập đã được thu hồi. Vui lòng đăng nhập lại.' } });
        return;
      }
      return next();
    } catch (error) { return next(error); }
  };
}
