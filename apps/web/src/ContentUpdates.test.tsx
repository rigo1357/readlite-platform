import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentUpdateDetailPage, NewContentUpdate, StoryContentUpdates } from './ContentUpdates';
import type { ContentUpdateDetail, ContributorDetail, ReadLiteUser } from './api/admin';

const author: ReadLiteUser = { id: 'u1', email: 'author@test.invalid', username: 'author', displayName: 'Author', role: 'author', emailVerified: true };
const story: ContributorDetail = {
  story: { id: '12', title: 'Truyện đã xuất bản', author: 'Tác giả', summary: '', language: 'vi', source: 'epub', moderationStatus: 'published', aiReviewStatus: 'skipped', aiReviewWarnings: [], coverUrl: null, coverMediaId: null, publicationDate: null, totalChapters: 4, genreIds: [], createdAt: '', updatedAt: '' },
  preview: { volumes: [{ id: '1', title: 'Tập 1', order: 1, chapters: [] }] },
};
function detail(status: ContentUpdateDetail['update']['status']): ContentUpdateDetail {
  return { update: { id: '7', storyId: '12', storyTitle: 'Truyện đã xuất bản', title: 'Phần tiếp theo', source: 'manual', status, targetVolumeId: '1', reviewReason: '<script>không chạy</script>', warnings: [], chapterCount: 1, createdAt: '', submittedAt: null, reviewedAt: null },
    chapters: [{ id: '8', chapterOrder: 1, volumeOrder: 1, volumeTitle: 'Tập 1', title: 'Chương mới', content: 'Nội dung mới', blocks: [], wordCount: 3 }] };
}
function render(options: { status?: ContentUpdateDetail['update']['status']; role?: ReadLiteUser['role']; path?: string; published?: boolean; lifecycleStatus?: 'ongoing' | 'completed' | 'paused' } = {}) {
  const { status = 'draft', role = 'author', path = '/content-updates/7', published = true, lifecycleStatus = 'ongoing' } = options;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['content-updates', 'detail', '7'], detail(status));
  client.setQueryData(['contributor', 'story', '12'], { ...story, story: { ...story.story, lifecycleStatus, moderationStatus: published ? 'published' : 'draft' } });
  client.setQueryData(['content-updates', 'story', '12', 1], { updates: [detail(status).update], pagination: { page: 1, limit: 20, total: 1 } });
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/content-updates/:updateId" element={<ContentUpdateDetailPage user={{ ...author, role }} />} />
    <Route path="/submissions/:storyId/updates/new" element={<NewContentUpdate />} />
    <Route path="/story" element={<StoryContentUpdates storyId="12" published={published} />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
describe('content addition workflow', () => {
  it('requires reopening completed or paused stories before preparing new chapters', () => {
    for (const lifecycleStatus of ['completed', 'paused'] as const) {
      const markup = render({ path: '/submissions/12/updates/new', lifecycleStatus });
      expect(markup).toContain('Chuyển truyện về Đang ra'); expect(markup).not.toContain('Lưu bản nháp bổ sung');
    }
  });
  it('offers manual and EPUB draft creation only for a published story', () => {
    const markup = render({ path: '/submissions/12/updates/new' });
    expect(markup).toContain('Nhập bằng tay'); expect(markup).toContain('Nhập từ EPUB'); expect(markup).toContain('Lưu bản nháp bổ sung');
    const unavailable = render({ path: '/submissions/12/updates/new', published: false });
    expect(unavailable).toContain('Chỉ bổ sung chương khi truyện đã được xuất bản'); expect(unavailable).not.toContain('<form');
  });
  it('authors can edit/submit a draft but cannot publish it', () => {
    const markup = render();
    expect(markup).toContain('Gửi duyệt chương mới'); expect(markup).toContain('Chương bổ sung 1');
    expect(markup).not.toContain('Duyệt và xuất bản chương');
    expect(markup).toContain('&lt;script&gt;'); expect(markup).not.toContain('<script>');
  });
  it('pending additions cannot be edited or resubmitted; only admin sees publication actions', () => {
    const authorMarkup = render({ status: 'pending' });
    expect(authorMarkup).not.toContain('Gửi duyệt chương mới'); expect(authorMarkup).not.toContain('Lưu bản nháp bổ sung');
    expect(authorMarkup).toContain('Hủy bản bổ sung'); expect(authorMarkup).not.toContain('Duyệt và xuất bản chương');
    expect(render({ status: 'pending', role: 'admin' })).toContain('Duyệt và xuất bản chương');
  });
  it('places chapter content before the admin decision and links back to its queue', () => {
    const markup = render({ status: 'pending', role: 'admin' });
    expect(markup.indexOf('id="review-content"')).toBeLessThan(markup.indexOf('id="review-decision"'));
    expect(markup).toContain('href="/chapter-updates"');
    expect(markup).toContain('href="#review-content"');
    expect(markup).toContain('href="#review-decision"');
    expect(markup).toContain('disabled="" type="button">Từ chối');
    expect(render({ status: 'pending' })).not.toContain('href="#review-decision"');
  });
  it('published additions retain preview/history but cannot be cancelled or published twice', () => {
    const markup = render({ status: 'published', role: 'admin' });
    expect(markup).toContain('Đã xuất bản'); expect(markup).toContain('Nội dung mới');
    expect(markup).not.toContain('Hủy bản bổ sung'); expect(markup).not.toContain('Duyệt và xuất bản chương');
  });
  it('story history remains accessible after a story is hidden; creation link is removed', () => {
    expect(render({ path: '/story' })).toContain('href="/submissions/12/updates/new"');
    const hidden = render({ path: '/story', published: false });
    expect(hidden).toContain('href="/content-updates/7"'); expect(hidden).not.toContain('href="/submissions/12/updates/new"');
  });
});
