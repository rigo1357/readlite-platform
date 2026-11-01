import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AdminReport, AdminReportsPage, ReadLiteUser } from './api/admin';
import App from './App';

function renderRoute(path: string, user: ReadLiteUser | null = null, reports?: AdminReportsPage): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  queryClient.setQueryData(['session', 'current-user'], user);
  if (reports) queryClient.setQueryData(['admin', 'reports', 'open', 1], reports);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const admin: ReadLiteUser = {
  id: 'admin-id', email: 'admin@example.test', username: 'readlite_admin',
  displayName: 'ReadLite Admin', role: 'admin', emailVerified: true,
};
const author: ReadLiteUser = {
  id: 'author-id', email: 'author@example.test', username: 'readlite_author',
  displayName: 'ReadLite Author', role: 'author', emailVerified: true,
};

describe('ReadLite content dashboard', () => {
  it('shows an admin login form when the session is missing', () => {
    const markup = renderRoute('/login');

    expect(markup).toContain('<h1>Chào mừng trở lại</h1>');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('Tài khoản cần xác minh email');
  });

  it('shows the moderation dashboard to an administrator', () => {
    const markup = renderRoute('/', admin);

    expect(markup).toContain('Kiểm soát nội dung ứng dụng');
    expect(markup).toContain('<h1>Chào mừng đến ReadLite</h1>');
    expect(markup).toContain('Hàng đợi kiểm duyệt');
    expect(markup).toContain('Duyệt truyện');
    expect(markup).toContain('Phân quyền');
    expect(markup).toContain('href="/reports"');
  });

  it('shows the submission workspace to an author without admin navigation', () => {
    const markup = renderRoute('/submissions', author);

    expect(markup).toContain('Quản lý truyện của bạn');
    expect(markup).toContain('<h1>Bản thảo</h1>');
    expect(markup).toContain('Tạo truyện thủ công');
    expect(markup).not.toContain('Duyệt truyện');
    expect(markup).not.toContain('Phân quyền');
    expect(markup).not.toContain('href="/reports"');
  });

  it('shows account role controls only on the admin page', () => {
    const markup = renderRoute('/users', admin);
    expect(markup).toContain('Quản lý tài khoản');
    expect(markup).toContain('Tìm tài khoản');
    expect(renderRoute('/users', author)).toContain('Bạn chưa có quyền vào khu vực này');
  });

  it('allows an author to select multiple EPUB files', () => {
    const markup = renderRoute('/submissions', author);
    expect(markup).toContain('Nhập nhiều truyện từ EPUB');
    expect(markup).toContain('multiple=""');
  });

  it('blocks a regular reader from the content dashboard', () => {
    const markup = renderRoute('/', { ...author, role: 'user' });

    expect(markup).toContain('Bạn chưa có quyền vào khu vực này');
  });

  it('keeps reports restricted to administrators even with a direct URL', () => {
    expect(renderRoute('/reports', author)).toContain('Bạn chưa có quyền vào khu vực này');
    expect(renderRoute('/reports', { ...author, role: 'user' })).toContain('Bạn chưa có quyền vào khu vực này');
    expect(renderRoute('/reports', admin)).toContain('Đang tải báo cáo');
  });

  it('restricts the chapter-addition queue to admin and exposes its navigation', () => {
    expect(renderRoute('/chapter-updates', admin)).toContain('Duyệt chương bổ sung');
    expect(renderRoute('/chapter-updates', author)).toContain('Bạn chưa có quyền vào khu vực này');
    expect(renderRoute('/submissions', author)).not.toContain('href="/chapter-updates"');
  });

  it('shows target-specific report actions and escapes submitted content', () => {
    const base: AdminReport = {
      id: 'r1', reporterName: 'Độc giả A', targetType: 'story', targetId: '12',
      reason: 'Nội dung không phù hợp', status: 'open', createdAt: '2026-10-25T00:00:00Z',
      targetTitle: 'Tên truyện', targetContent: '<script>alert(1)</script>', targetAvailable: true,
    };
    const markup = renderRoute('/reports', admin, {
      reports: [base, { ...base, id: 'r2', targetType: 'comment' }, { ...base, id: 'r3', targetType: 'review' }],
      pagination: { page: 1, limit: 10, total: 21 },
    });
    expect(markup).toContain('Báo cáo của độc giả');
    expect(markup).toContain('Độc giả A');
    expect(markup).toContain('Nội dung không phù hợp');
    expect(markup).toContain('value="hide_story"');
    expect(markup).toContain('value="delete_comment"');
    expect(markup).toContain('value="delete_review"');
    expect(markup).toContain('Trang 1 / 3');
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
  });

  it('offers no content removal when a reported target is unavailable', () => {
    const markup = renderRoute('/reports', admin, {
      reports: [{ id: 'r4', reporterName: 'Reader', targetType: 'comment', targetId: '5', reason: 'Spam', status: 'open', createdAt: '', targetTitle: null, targetContent: null, targetAvailable: false }],
      pagination: { page: 1, limit: 10, total: 1 },
    });
    expect(markup).toContain('Nội dung đã bị xóa hoặc không còn tồn tại');
    expect(markup).toContain('Chỉ đánh dấu đã xử lý');
    expect(markup).toContain('Bỏ qua báo cáo');
    expect(markup).not.toContain('value="delete_comment"');
  });

  it('shows a clear empty state for reports', () => {
    const markup = renderRoute('/reports', admin, { reports: [], pagination: { page: 1, limit: 10, total: 0 } });
    expect(markup).toContain('Chưa có báo cáo');
    expect(markup).not.toContain('Xử lý báo cáo</button>');
  });
});
