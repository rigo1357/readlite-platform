import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { coverSource, type ContributorStory } from "./api/admin";
import { lifecycleLabel } from "./StoryLifecycle";

export type ImportResult = { index: number; name: string; id?: string; error?: string };
type LibraryFilter = "all" | "editable" | "pending" | "published" | "rejected";
const filters: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "Tất cả" }, { id: "editable", label: "Bản nháp / cần sửa" },
  { id: "pending", label: "Chờ duyệt" }, { id: "published", label: "Đã xuất bản" },
  { id: "rejected", label: "Đã từ chối" },
];
const labels: Record<string, string> = {
  draft: "Bản nháp", changes_requested: "Cần chỉnh sửa", ai_review_pending: "Đang chờ AI",
  admin_review_pending: "Chờ quản trị viên", published: "Đã xuất bản", rejected: "Đã từ chối",
};
export function isEditableDraft(story: ContributorStory): boolean {
  return ["draft", "changes_requested"].includes(story.moderationStatus);
}
function matchesStatus(story: ContributorStory, filter: LibraryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "editable") return isEditableDraft(story);
  if (filter === "pending") return ["ai_review_pending", "admin_review_pending"].includes(story.moderationStatus);
  return story.moderationStatus === filter;
}
function normalize(value: string): string {
  return value.toLocaleLowerCase("vi-VN").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
}
export function filterLibraryStories(stories: ContributorStory[], search: string, filter: LibraryFilter): ContributorStory[] {
  const needle = normalize(search);
  return stories.filter((story) => matchesStatus(story, filter) && normalize(`${story.title} ${story.author ?? ""}`).includes(needle));
}
export function publicationLabel(value: string | null): string {
  if (!value) return "Chưa đặt ngày phát hành";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Chưa đặt ngày phát hành" : `Phát hành ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(date)}`;
}
function updatedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function FileIcon() {
  return <svg aria-hidden="true" width="22" height="26" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2h9l6 6v18H5z" /><path d="M14 2v7h6M8 15h9M8 19h9" /></svg>;
}

export function EpubImportPanel({ files, results, busy, activeIndex, message, onFilesChange, onSubmit }: {
  files: File[]; results: ImportResult[]; busy: boolean; activeIndex: number | null; message: string;
  onFilesChange: (files: File[]) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const inputId = useId();
  const helpId = useId();
  const successful = results.filter((item) => item.id).length;
  const failed = results.filter((item) => !item.id && item.error).length;
  const complete = files.length > 0 && successful === files.length;
  return <section className="library-import" aria-labelledby={`${inputId}-heading`}>
    <div className="library-import-heading"><div><h2 id={`${inputId}-heading`}>Nhập nhiều truyện từ EPUB</h2><p id={helpId}>Tối đa 20 tệp mỗi lượt · 100 MiB mỗi tệp. Mỗi EPUB được lưu thành một bản nháp riêng.</p></div><span className="library-format">.epub</span></div>
    <form onSubmit={onSubmit}>
      <div className="library-file-controls"><label className={`file-picker library-file-picker${busy ? " is-disabled" : ""}`} htmlFor={inputId}><FileIcon /><span>{files.length ? "Chọn lại tệp EPUB" : "Chọn tệp EPUB"}</span><input accept=".epub,application/epub+zip" aria-describedby={helpId} disabled={busy} id={inputId} multiple onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))} type="file" /></label><p>{files.length ? `${files.length} tệp đã chọn` : "Có thể chọn nhiều tệp cùng lúc."}</p><button className="button button-primary" disabled={busy || !files.length || files.length > 20 || complete} type="submit">{busy ? "Đang nhập…" : complete ? "Đã nhập tất cả" : successful ? "Tiếp tục nhập tệp còn lại" : "Nhập các tệp đã chọn"}</button></div>
      {files.length > 0 && <>
        <div className="library-import-progress"><span>{successful} thành công · {failed} lỗi · {files.length - results.length} chưa xử lý</span><span>{results.length}/{files.length} đã xử lý</span><progress aria-label="Số tệp EPUB đã xử lý" max={files.length} value={results.length} /></div>
        <ol className="library-file-list" aria-label="Các tệp EPUB đã chọn">{files.map((file, index) => {
          const result = results.find((item) => item.index === index);
          const state = result?.id ? "success" : result?.error ? "error" : busy && activeIndex === index ? "active" : "waiting";
          return <li className={`library-file library-file-${state}`} key={index}><span className="library-file-number">{index + 1}</span><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MiB{result?.error && <span className="library-file-error">{result.error}</span>}</small></div>{result?.id ? <Link className="text-link" to={`/submissions/${encodeURIComponent(result.id)}`}>Mở bản nháp</Link> : <span className="library-file-state">{state === "active" ? "Đang nhập…" : state === "error" ? "Nhập thất bại" : "Chờ nhập"}</span>}</li>;
        })}</ol>
      </>}
    </form>
    {message && <p className={`library-import-message${!busy && (failed || successful < files.length) ? " has-warning" : ""}`} role="status" aria-live="polite">{message}</p>}
    <p className="library-import-note">Sau khi nhập, mở bản nháp để kiểm tra bìa, thông tin và chương trước khi gửi duyệt.</p>
  </section>;
}

export function StoryInventory({ stories, selected, onSelect, submitBusy, onSubmit, submitMessage, admin }: {
  stories: ContributorStory[]; selected: string[]; onSelect: (ids: string[]) => void;
  submitBusy: boolean; onSubmit: () => void; submitMessage: string; admin: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const visible = filterLibraryStories(stories, search, filter);
  const selectable = visible.filter(isEditableDraft);
  const selectedIds = selected.filter((id) => stories.some((story) => story.id === id && isEditableDraft(story)));
  const allSelected = selectable.length > 0 && selectable.every((story) => selectedIds.includes(story.id));
  return <section className="library-inventory" aria-labelledby="library-inventory-title">
    <div className="library-inventory-heading"><div><h2 id="library-inventory-title">{admin ? "Tất cả truyện" : "Danh sách bản thảo"}</h2><p>{stories.length} truyện trong {admin ? "kho nội dung" : "danh sách của bạn"}</p></div><label className="library-search"><span>Tìm truyện hoặc tác giả</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Nhập tên truyện, tác giả…" type="search" value={search} /></label></div>
    <div className="library-filters" role="group" aria-label="Lọc theo trạng thái xuất bản">{filters.map((item) => <button aria-pressed={filter === item.id} key={item.id} onClick={() => setFilter(item.id)} type="button">{item.label}<span>{stories.filter((story) => matchesStatus(story, item.id)).length}</span></button>)}</div>
    <div className="library-selection-bar"><label><input checked={allSelected} disabled={submitBusy || !selectable.length} onChange={(event) => onSelect(event.target.checked ? [...new Set([...selectedIds, ...selectable.map((story) => story.id)])] : selectedIds.filter((id) => !selectable.some((story) => story.id === id)))} type="checkbox" />Chọn bản nháp đang hiển thị</label><span>{visible.length}/{stories.length} truyện</span></div>
    {selectedIds.length > 0 && <div className="library-bulk-actions"><span>Đã chọn <strong>{selectedIds.length}</strong> bản nháp <small>(kể cả ngoài bộ lọc hiện tại)</small></span><button className="button button-quiet" disabled={submitBusy} onClick={() => onSelect([])} type="button">Bỏ chọn</button><button className="button button-primary" disabled={submitBusy} onClick={onSubmit} type="button">{submitBusy ? "Đang gửi…" : `Gửi duyệt ${selectedIds.length} bản nháp`}</button></div>}
    {submitMessage && <p className="library-import-message" role="status">{submitMessage}</p>}
    {!visible.length ? <div className="library-empty"><h3>{stories.length ? "Không tìm thấy truyện phù hợp" : "Kho truyện đang trống"}</h3><p>{stories.length ? "Thử tên khác hoặc đổi bộ lọc trạng thái." : "Chọn tệp EPUB phía trên hoặc tạo truyện thủ công để bắt đầu."}</p>{stories.length > 0 && <button className="button button-secondary" onClick={() => { setSearch(""); setFilter("all"); }} type="button">Xóa bộ lọc</button>}</div> : <ul className="library-story-list">{visible.map((story) => <li className="library-story" key={story.id}>
      <div className="library-story-select">{isEditableDraft(story) && <input aria-label={`Chọn bản nháp ${story.title}`} checked={selectedIds.includes(story.id)} disabled={submitBusy} onChange={(event) => onSelect(event.target.checked ? [...selectedIds, story.id] : selectedIds.filter((id) => id !== story.id))} type="checkbox" />}</div>
      <Link className="library-story-link" to={`/submissions/${encodeURIComponent(story.id)}`}><span className="library-story-cover">{coverSource(story) ? <img alt="" loading="lazy" width="52" height="72" src={coverSource(story)!} /> : <FileIcon />}</span><span className="library-story-copy"><strong>{story.title || "Chưa có tên truyện"}</strong><span>{story.author || "Chưa có tác giả"} · {story.totalChapters} chương</span><small>{publicationLabel(story.publicationDate)}{updatedLabel(story.updatedAt) && ` · Cập nhật ${updatedLabel(story.updatedAt)}`}</small></span><span className="library-story-status"><span className={`status-badge ${story.moderationStatus === "published" ? "status-ok" : ["changes_requested", "rejected"].includes(story.moderationStatus) ? "status-warning" : "status-neutral"}`}>{labels[story.moderationStatus] ?? story.moderationStatus}</span><small>{lifecycleLabel(story.lifecycleStatus)}</small></span><svg className="library-chevron" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m7 4 6 6-6 6" /></svg></Link>
    </li>)}</ul>}
  </section>;
}
