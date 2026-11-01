import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManagedUsers, StatusDialog, HistoryDialog } from './ManagedUsers';
import type { ManagedUser, ReadLiteUser } from './api/admin';
import type { ReactNode } from 'react';

const currentUser: ReadLiteUser = { id: 'admin', email: 'admin@test.invalid', username: 'admin', displayName: 'Admin', role: 'admin', emailVerified: true };
const own: ManagedUser = { ...currentUser, isActive: true, statusVersion: 0 };
const blocked: ManagedUser = { id: 'blocked', email: 'blocked@test.invalid', username: 'reader', displayName: 'Reader', role: 'user', isActive: false, emailVerified: true, statusVersion: 1, statusReason: '<script>alert(1)</script>', statusChangedAt: '2026-10-28T10:00:00Z' };
function render(component: ReactNode, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  seed?.(client);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}
describe('account administration', () => {
  it('disables self-lock and own-role controls, permits unlocking a blocked account and escapes its reason', () => {
    const markup = render(<ManagedUsers currentUser={currentUser} />, client => client.setQueryData(['admin', 'users', '', 'all', 1], { users: [own, blocked], pagination: { page: 1, limit: 20, total: 21 } }));
    expect(markup).toContain('Quản lý tài khoản'); expect(markup).toContain('Lọc trạng thái tài khoản'); expect(markup).toContain('Trang sau');
    expect(markup).toContain('Lịch sử khóa/mở'); expect(markup).toContain('Mở khóa'); expect(markup).toContain('&lt;script&gt;'); expect(markup).not.toContain('<script>');
    const cards = markup.split('<article');
    expect(cards[1]).toMatch(/disabled=""[^>]*>Khóa tài khoản/);
    expect(cards[1]).toMatch(/aria-label="Vai trò của admin@test.invalid" disabled=""/);
    expect(cards[2]).toMatch(/aria-label="Vai trò của blocked@test.invalid" disabled=""/);
    expect(cards[2]).toMatch(/type="button">Mở khóa/);
  });
  it('requires a reason before confirming lock or unlock and explains session revocation', () => {
    const markup = render(<StatusDialog account={blocked} onClose={() => {}} onSaved={() => {}} />);
    expect(markup).toContain('<dialog'); expect(markup).toContain('Lý do mở khóa');
    expect(markup).toMatch(/textarea[^>]*required=""[^>]*maxLength="2000"/);
    expect(markup).toContain('Các phiên đã thu hồi vẫn bị vô hiệu');
    expect(markup).toMatch(/type="submit" disabled="">Xác nhận mở khóa/);
  });
  it('history includes actor, reason and time and is paginated', () => {
    const markup = render(<HistoryDialog account={blocked} onClose={() => {}} />, client => client.setQueryData(['admin', 'user-status-history', blocked.id, 1], {
      user: blocked, events: [{ id: '1', actorId: 'admin-id', actorName: 'Quản trị viên A', previousActive: true, newActive: false, reason: '<img src=x onerror=alert(1)>', createdAt: '2026-10-28T10:00:00Z' }], pagination: { page: 1, limit: 20, total: 21 },
    }));
    expect(markup).toContain('Quản trị viên A'); expect(markup).toContain('admin-id'); expect(markup).toContain('<time>'); expect(markup).toContain('Trang sau');
    expect(markup).toContain('&lt;img'); expect(markup).not.toContain('<img src=x');
  });
});
