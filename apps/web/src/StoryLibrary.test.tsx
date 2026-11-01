import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { EpubImportPanel, StoryInventory, filterLibraryStories, publicationLabel } from "./StoryLibrary";
import type { ContributorStory } from "./api/admin";

const story: ContributorStory = { id: "1", title: "Đường về kỳ ảo", author: "Nguyễn An", summary: null, language: "vi", moderationStatus: "draft", aiReviewStatus: null, aiReviewWarnings: [], coverUrl: null, source: "epub", publicationDate: "2026-10-21T17:00:00.000Z", totalChapters: 28, createdAt: "", updatedAt: "", lifecycleStatus: "ongoing" };
const stories = [story, { ...story, id: "2", title: "Chuyện khác", moderationStatus: "published" }, { ...story, id: "3", moderationStatus: "admin_review_pending" }, { ...story, id: "4", moderationStatus: "changes_requested" }, { ...story, id: "5", moderationStatus: "rejected" }];
function renderInventory(selected: string[]) {
  return renderToStaticMarkup(<MemoryRouter><StoryInventory stories={stories} selected={selected} onSelect={() => {}} submitBusy={false} onSubmit={() => {}} submitMessage="" admin /></MemoryRouter>);
}
describe("story library", () => {
  it("combines Vietnamese search without accents with publication state", () => {
    expect(filterLibraryStories(stories, "duong ve", "editable").map((item) => item.id)).toEqual(["1", "4"]);
    expect(filterLibraryStories(stories, "NGUYEN", "published").map((item) => item.id)).toEqual(["2"]);
    expect(filterLibraryStories(stories, "", "pending").map((item) => item.id)).toEqual(["3"]);
    expect(filterLibraryStories(stories, "", "rejected").map((item) => item.id)).toEqual(["5"]);
  });
  it("only offers eligible drafts for bulk submission, including after data refresh", () => {
    const markup = renderInventory(["1", "2", "stale-id"]);
    expect(markup).toContain("Gửi duyệt 1 bản nháp");
    expect(markup).not.toContain("Gửi duyệt 3 bản nháp");
    expect((markup.match(/aria-label="Chọn bản nháp /g) ?? []).length).toBe(2);
    expect(markup).toContain('href="/submissions/2"');
  });
  it("shows distinct success, error, active and waiting file states while locking file selection", () => {
    const files = ["đã nhập.epub", "hỏng.epub", "đang nhập.epub", "chờ.epub"].map((name) => new File(["test"], name));
    const markup = renderToStaticMarkup(<MemoryRouter><EpubImportPanel files={files} results={[{ index: 0, name: files[0].name, id: "12" }, { index: 1, name: files[1].name, error: "Không đọc được EPUB <script>" }]} busy activeIndex={2} message="Đang nhập" onFilesChange={() => {}} onSubmit={() => {}} /></MemoryRouter>);
    expect(markup).toContain('href="/submissions/12"');
    expect(markup).toContain("library-file-error"); expect(markup).toContain("library-file-active"); expect(markup).toContain("library-file-waiting");
    expect(markup).toContain("1 thành công · 1 lỗi · 2 chưa xử lý");
    expect(markup).toContain('max="4" value="2"');
    expect(markup).toMatch(/<input[^>]*disabled=""[^>]*multiple=""/);
    expect(markup).toContain("&lt;script&gt;"); expect(markup).not.toContain("<script>");
  });
  it("offers retry for partial success and disables import once all files succeeded", () => {
    const files = [new File(["test"], "book.epub")];
    const partial = renderToStaticMarkup(<MemoryRouter><EpubImportPanel files={[...files, new File(["test"], "retry.epub")]} results={[{ index: 0, name: "book.epub", id: "1" }, { index: 1, name: "retry.epub", error: "Tệp bị lỗi" }]} busy={false} activeIndex={null} message="Đã nhập 1/2 tệp" onFilesChange={() => {}} onSubmit={() => {}} /></MemoryRouter>);
    expect(partial).toContain('type="submit">Tiếp tục nhập tệp còn lại');
    expect(partial).toContain("has-warning");
    const markup = renderToStaticMarkup(<MemoryRouter><EpubImportPanel files={files} results={[{ index: 0, name: "book.epub", id: "1" }]} busy={false} activeIndex={null} message="Đã nhập 1/1 tệp" onFilesChange={() => {}} onSubmit={() => {}} /></MemoryRouter>);
    expect(markup).toContain('disabled="" type="submit">Đã nhập tất cả');
    expect(markup).not.toContain("has-warning");
  });
  it("formats dates for presentation and handles missing or invalid metadata", () => {
    expect(publicationLabel(story.publicationDate)).not.toContain("T17:");
    expect(publicationLabel(null)).toBe("Chưa đặt ngày phát hành");
    expect(publicationLabel("invalid")).toBe("Chưa đặt ngày phát hành");
  });
});
