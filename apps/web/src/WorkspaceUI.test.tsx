import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmationDialog } from "./WorkspaceUI";
import App from "./App";
import type { ContributorDetail, ReadLiteUser } from "./api/admin";

const admin: ReadLiteUser = { id: "admin-test", email: "admin@test.invalid", username: "admin", displayName: "Quản trị viên", role: "admin", emailVerified: true };
function render(path: string, user: ReadLiteUser | null = admin, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["session", "current-user"], user); seed?.(client);
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
}
describe("complete workspace", () => {
  it("keeps confirmation text escaped and gives destructive actions an explicit cancel path", () => {
    const markup = renderToStaticMarkup(<ConfirmationDialog options={{ title: "Xóa truyện", subject: '<img src=x onerror="alert(1)">', description: "Không thể hoàn tác.", confirmLabel: "Xóa vĩnh viễn", danger: true }} onAnswer={() => {}} />);
    expect(markup).toContain("aria-labelledby="); expect(markup).toContain("aria-describedby=");
    expect(markup).toContain("&lt;img"); expect(markup).not.toContain("<img");
    expect(markup).toContain('type="button">Hủy');
    expect(markup).toContain('button-danger"'); expect(markup).toContain("Xóa vĩnh viễn");
  });
  it("offers account details and role-specific information without admin controls for authors", () => {
    const markup = render("/account", { ...admin, role: "author" });
    expect(markup).toContain("Tài khoản của bạn"); expect(markup).toContain("admin@test.invalid");
    expect(markup).toContain("Đã xác minh"); expect(markup).toContain("Sửa hồ sơ trên ứng dụng Android");
    expect(markup).not.toContain('href="/users"'); expect(markup).toContain("Đăng xuất");
  });
  it("lets an authenticated reader leave a dashboard they cannot access", () => {
    const markup = render("/users", { ...admin, role: "user" });
    expect(markup).toContain("Bạn chưa có quyền vào khu vực này");
    expect(markup).toContain('type="button">Đăng xuất');
    expect(markup).not.toContain('id="workspace-navigation"');
  });
  it("shows actual queue totals and never invents a zero for unavailable data", () => {
    const markup = render("/", admin, client => {
      client.setQueryData(["admin", "queue"], []);
      client.setQueryData(["admin", "story-count"], 17);
      client.setQueryData(["content-updates", "queue", 1], { updates: [], pagination: { page: 1, limit: 20, total: 3 } });
      client.setQueryData(["admin", "reports", "open", 1], { reports: [], pagination: { page: 1, limit: 10, total: 2 } });
    });
    expect(markup).toContain("Hàng đợi đang trống"); expect(markup).toContain("<strong>17</strong>");
    expect(markup).toContain("<strong>3</strong>"); expect(markup).toContain("<strong>2</strong>");
    expect(render("/")).toContain("<strong>—</strong>");
  });
  it("renders an accessible mobile navigation toggle and password visibility control", () => {
    expect(render("/account")).toContain('aria-controls="workspace-navigation" aria-expanded="false"');
    const login = render("/login", null);
    expect(login).toContain('aria-label="Hiện mật khẩu" aria-pressed="false"');
    expect(login).toContain('autoComplete="current-password"');
  });
  it("locks metadata during moderation and uses distinct anchors for EPUB structure and preview", () => {
    const detail: ContributorDetail = { story: { id: "14", title: "EPUB", author: "Tác giả", summary: "Giới thiệu", language: "vi", source: "epub", moderationStatus: "draft", aiReviewStatus: "skipped", aiReviewWarnings: [], coverUrl: null, coverMediaId: null, genreIds: ["1"], publicationDate: null, totalChapters: 0, createdAt: "", updatedAt: "", lifecycleStatus: "ongoing" }, preview: { volumes: [] } };
    const draft = render("/submissions/14", admin, client => client.setQueryData(["contributor", "story", "14"], detail));
    expect((draft.match(/id="story-content"/g) ?? []).length).toBe(1);
    expect(draft).toContain('id="story-preview"'); expect(draft).toContain('href="#story-preview"');
    const pending = render("/submissions/14", admin, client => client.setQueryData(["contributor", "story", "14"], { ...detail, story: { ...detail.story, moderationStatus: "admin_review_pending" } }));
    expect(pending).toContain('class="metadata-fields" disabled=""');
    expect(pending).not.toContain('id="story-preview"');
  });
});
