import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoryLifecycleEditor } from './StoryLifecycle';

function render(moderationStatus = 'published') {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['story-lifecycle', '12', 1], {
    lifecycle: { storyId: '12', status: 'completed', version: 3, note: '<script>ghi chú</script>', changedAt: null },
    events: [{ id: '1', actorId: 'u1', actorName: 'Tác giả A', previousStatus: 'ongoing', newStatus: 'completed', note: '<img src=x onerror=alert(1)>', createdAt: '2026-10-29T10:00:00Z' }],
    pagination: { page: 1, limit: 20, total: 21 },
  });
  return renderToStaticMarkup(<QueryClientProvider client={client}><StoryLifecycleEditor storyId="12" moderationStatus={moderationStatus} /></QueryClientProvider>);
}
describe('story publication progress', () => {
  it('shows three distinct lifecycle options, private history and escaped notes', () => {
    const markup = render();
    expect(markup).toContain('Đang ra'); expect(markup).toContain('Hoàn thành'); expect(markup).toContain('Tạm ngưng');
    expect(markup).toContain('kiểm duyệt riêng'); expect(markup).toContain('Tác giả A'); expect(markup).toContain('Trang sau');
    expect(markup).toContain('&lt;script&gt;'); expect(markup).not.toContain('<script>'); expect(markup).toContain('&lt;img');
  });
  it('prevents status changes while the story awaits moderation', () => {
    const markup = render('admin_review_pending');
    expect(markup).toMatch(/select aria-label="Trạng thái tiến hành" disabled=""/);
    expect(markup).toContain('Truyện đang chờ duyệt');
  });
});
