import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveStoryLifecycle, changeAccountStatus, fetchAccountStatusHistory, fetchManagedUsersPage, decideReport, fetchAdminReports, fetchCurrentUser, importEpub, isApiUnavailable, logout } from './admin';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const invalidCsrf = { error: { code: 'CSRF_INVALID', message: 'Yêu cầu không hợp lệ.' } };

afterEach(() => vi.unstubAllGlobals());

describe('admin session recovery', () => {
  it('retries an EPUB upload with the CSRF token shared by the current cookies', async () => {
    const session = storage();
    session.setItem('readlite.admin.csrf', 'old-token');
    vi.stubGlobal('sessionStorage', session);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(invalidCsrf, 403))
      .mockResolvedValueOnce(json({ csrfToken: 'current-token' }, 200))
      .mockResolvedValueOnce(json({ story: { id: '123', title: 'Book' } }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(importEpub(new File(['epub'], 'book.epub'))).resolves.toEqual({
      story: { id: '123', title: 'Book' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/csrf');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('x-csrf-token')).toBe('old-token');
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('x-csrf-token')).toBe('current-token');
  });

  it('logs out after repairing a stale token and removes the tab token', async () => {
    const session = storage();
    session.setItem('readlite.admin.csrf', 'old-token');
    vi.stubGlobal('sessionStorage', session);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(invalidCsrf, 403))
      .mockResolvedValueOnce(json({ csrfToken: 'current-token' }, 200))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('x-csrf-token')).toBe('current-token');
    expect(session.getItem('readlite.admin.csrf')).toBeNull();
  });

  it('recovers an expired access cookie before loading the current user', async () => {
    const session = storage();
    session.setItem('readlite.admin.csrf', 'old-token');
    vi.stubGlobal('sessionStorage', session);
    const user = { id: 'u1', email: 'reader@example.test', username: 'reader', displayName: 'Reader', role: 'admin', emailVerified: true };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401))
      .mockResolvedValueOnce(json({ csrfToken: 'current-token' }, 200))
      .mockResolvedValueOnce(json({ csrfToken: 'rotated-token', user }, 200))
      .mockResolvedValueOnce(json({ user }, 200));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCurrentUser()).resolves.toEqual(user);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/auth/me', '/api/v1/auth/csrf', '/api/v1/auth/refresh', '/api/v1/auth/me',
    ]);
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get('x-csrf-token')).toBe('current-token');
    expect(session.getItem('readlite.admin.csrf')).toBe('rotated-token');
  });

  it('reports a proxy outage without claiming that logout succeeded', async () => {
    const session = storage();
    session.setItem('readlite.admin.csrf', 'current-token');
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));

    const error = await logout().catch((reason: unknown) => reason);
    expect(isApiUnavailable(error)).toBe(true);
    expect(error).toHaveProperty('message', 'Máy chủ API không phản hồi. Hãy kiểm tra API ở cổng 3000.');
    expect(session.getItem('readlite.admin.csrf')).toBe('current-token');
  });
});

describe('admin report moderation', () => {
  it('loads the requested status and page', async () => {
    const page = { reports: [], pagination: { page: 2, limit: 10, total: 11 } };
    const fetchMock = vi.fn().mockResolvedValue(json(page, 200));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchAdminReports('resolved', 2)).resolves.toEqual(page);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/reports?status=resolved&page=2');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin');
  });

  it('sends a CSRF-protected decision with the selected target action', async () => {
    const session = storage();
    session.setItem('readlite.admin.csrf', 'report-token');
    vi.stubGlobal('sessionStorage', session);
    const fetchMock = vi.fn().mockResolvedValue(json({ report: { id: '12', status: 'resolved' }, action: 'delete_review' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await decideReport('12', 'resolved', 'delete_review');
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/admin/reports/12');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('report-token');
    expect(JSON.parse(init.body)).toEqual({ status: 'resolved', action: 'delete_review' });
  });

  it('defaults dismissing a report to leaving the target content unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ report: { id: '13', status: 'dismissed' }, action: 'none' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    await decideReport('13', 'dismissed');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'dismissed', action: 'none' });
  });
});

describe('account status management', () => {
  it('sends lifecycle changes with CSRF, version and pause reason', async () => {
    const session = storage(); session.setItem('readlite.admin.csrf', 'lifecycle-token'); vi.stubGlobal('sessionStorage', session);
    const fetchMock = vi.fn().mockResolvedValue(json({ changed: true }, 200)); vi.stubGlobal('fetch', fetchMock);
    await saveStoryLifecycle('12', 'paused', 3, 'Tác giả nghỉ');
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/author/stories/12/lifecycle'); expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('lifecycle-token');
    expect(JSON.parse(init.body)).toEqual({ status: 'paused', expectedVersion: 3, note: 'Tác giả nghỉ' });
  });
  it('sends reason and the last observed version with CSRF to prevent stale state changes', async () => {
    const session = storage(); session.setItem('readlite.admin.csrf', 'status-token'); vi.stubGlobal('sessionStorage', session);
    const fetchMock = vi.fn().mockResolvedValue(json({ user: { id: 'u1', isActive: false }, changed: true }, 200)); vi.stubGlobal('fetch', fetchMock);
    await changeAccountStatus('u1', false, 'Spam liên tục', 3);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/admin/users/u1/status'); expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('status-token');
    expect(JSON.parse(init.body)).toEqual({ isActive: false, reason: 'Spam liên tục', expectedStatusVersion: 3 });
  });
  it('loads the selected account filter and history page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ users: [], events: [], pagination: { page: 2, limit: 20, total: 21 } }, 200)); vi.stubGlobal('fetch', fetchMock);
    await fetchManagedUsersPage('a+b@test.invalid', 'blocked', 2); await fetchAccountStatusHistory('u1', 2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/users?search=a%2Bb%40test.invalid&status=blocked&page=2');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/admin/users/u1/status-history?page=2');
  });
  it('notifies the app and discards its cached CSRF token after server suspension', async () => {
    const session = storage(); session.setItem('readlite.admin.csrf', 'old-status-token'); vi.stubGlobal('sessionStorage', session);
    const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'ACCOUNT_SUSPENDED', message: 'Tài khoản đã bị khóa.' } }, 403)));
    await expect(fetchCurrentUser()).rejects.toHaveProperty('code', 'ACCOUNT_SUSPENDED');
    expect(session.getItem('readlite.admin.csrf')).toBeNull(); expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].type).toBe('readlite:session-ended');
  });
  it('ends a cached session when cookies were already cleared by another request and refresh fails', async () => {
    const session = storage(); session.setItem('readlite.admin.csrf', 'stale-tab-token'); vi.stubGlobal('sessionStorage', session);
    const dispatchEvent = vi.fn(); vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập.' } }, 401)));
    await expect(fetchCurrentUser()).rejects.toHaveProperty('code', 'UNAUTHORIZED');
    expect(dispatchEvent).toHaveBeenCalledTimes(1); expect(session.getItem('readlite.admin.csrf')).toBeNull();
  });
});
