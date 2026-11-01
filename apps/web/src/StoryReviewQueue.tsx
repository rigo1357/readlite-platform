import { useConfirm } from "./WorkspaceUI";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { decideReview, fetchAdminQueue, type ReviewSubmission } from "./api/admin";
import { AiReviewBadge, ModerationEmpty, ModerationHeading, type ReviewDecision } from "./ModerationUI";

type AiFilter = "all" | "warnings" | "skipped" | "passed";
type Result = { id: string; title: string; error?: string };
const filters: Array<{ id: AiFilter; label: string }> = [
  { id: "all", label: "Tất cả" }, { id: "warnings", label: "Có cảnh báo AI" },
  { id: "skipped", label: "Duyệt thủ công" }, { id: "passed", label: "AI đã rà soát" },
];
export function filterReviewQueue(items: ReviewSubmission[], search: string, filter: AiFilter): ReviewSubmission[] {
  const normalized = (text: string) => text.toLocaleLowerCase("vi-VN").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
  const needle = normalized(search);
  return items.filter((item) => (filter === "all" || item.aiReviewStatus === filter) && normalized(`${item.title} ${item.author ?? ""} ${item.submittedByName ?? ""}`).includes(needle));
}
function submittedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Chưa có ngày gửi" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
export async function processReviewBatch(targets: ReviewSubmission[], decision: ReviewDecision, reason: string,
  onProgress: (message: string) => void, onResults: (results: Result[]) => void): Promise<Result[]> {
  const completed: Result[] = [];
  for (let index = 0; index < targets.length; index++) {
    const item = targets[index];
    onProgress(`Đang xử lý ${index + 1}/${targets.length}: ${item.title}`);
    try { await decideReview(item.id, decision, reason.trim() || undefined); completed.push({ id: item.id, title: item.title }); }
    catch (error) { completed.push({ id: item.id, title: item.title, error: error instanceof Error ? error.message : "Không thể lưu quyết định." }); }
    onResults([...completed]);
  }
  return completed;
}
export function StoryReviewQueue() {
  const confirm = useConfirm();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "queue"], queryFn: fetchAdminQueue, retry: false });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AiFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [decision, setDecision] = useState<ReviewDecision>("approve");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const items = query.data ?? [];
  const visible = filterReviewQueue(items, search, filter);
  const targets = items.filter((item) => selected.includes(item.id));
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selected.includes(item.id));
  async function reviewSelected() {
    if (!targets.length || busy || (decision !== "approve" && !reason.trim())) return;
    const warningCount = targets.filter((item) => item.aiReviewStatus === "warnings").length;
    const manualCount = targets.filter((item) => item.aiReviewStatus !== "passed" && item.aiReviewStatus !== "warnings").length;
    const label = decision === "approve" ? "duyệt và xuất bản" : decision === "reject" ? "từ chối" : "yêu cầu chỉnh sửa";
    if (!await confirm({ title: `Xác nhận ${label} ${targets.length} truyện`, subject: targets.map(item => item.title).join("\n"), description: `${warningCount ? `Có ${warningCount} truyện có cảnh báo AI. ` : ""}${manualCount ? `Có ${manualCount} truyện chưa có kết quả rà soát AI. ` : ""}Hãy kiểm tra nội dung trước khi tiếp tục. Mỗi quyết định được lưu riêng.`, confirmLabel: "Xác nhận quyết định", danger: decision === "reject" })) return;
    setBusy(true); setResults([]);
    try {
      const completed = await processReviewBatch(targets, decision, reason, setProgress, setResults);
      setSelected(completed.filter((item) => item.error).map((item) => item.id));
      setProgress(`Hoàn tất ${completed.filter((item) => !item.error).length}/${targets.length} truyện.`);
      await Promise.all([client.invalidateQueries({ queryKey: ["admin"] }), client.invalidateQueries({ queryKey: ["contributor", "stories"] })]);
    } finally { setBusy(false); }
  }
  return <div className="page-stack moderation-page">
    <ModerationHeading title="Duyệt truyện" description="Đọc nội dung và kiểm tra cảnh báo AI trước khi quyết định xuất bản." />
    <div className="moderation-guidance"><strong>Quản trị viên quyết định xuất bản.</strong><span>AI chỉ hỗ trợ rà soát. Với truyện duyệt thủ công, cần đọc và kiểm tra nội dung trước khi duyệt.</span></div>
    {query.isError && <div className="error-panel" role="alert"><span>{query.error instanceof Error ? query.error.message : "Không thể tải hàng đợi."}</span><button className="button button-secondary" type="button" onClick={() => void query.refetch()}>Thử lại</button></div>}
    {query.isPending ? <p role="status">Đang tải truyện chờ duyệt…</p> : query.data && <>
      <div className="moderation-list-heading"><div><h2>Hàng đợi kiểm duyệt</h2><p>{items.length} truyện đang chờ bạn xem xét</p></div><label className="moderation-search">Tìm truyện, tác giả hoặc người gửi<input type="search" placeholder="Nhập tên để tìm…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      <div className="moderation-filters" role="group" aria-label="Lọc kết quả rà soát AI">{filters.map((item) => <button aria-pressed={item.id === filter} key={item.id} onClick={() => setFilter(item.id)} type="button">{item.label}<span>{filterReviewQueue(items, "", item.id).length}</span></button>)}</div>
      {items.length > 0 && <div className="moderation-select-row"><label><input checked={allVisibleSelected} disabled={busy || !visible.length} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map((item) => item.id)])] : selected.filter((id) => !visible.some((item) => item.id === id)))} type="checkbox" />Chọn truyện đang hiển thị</label><span>{visible.length}/{items.length} truyện</span></div>}
      {targets.length > 0 && <section className="moderation-bulk" aria-label="Xử lý các truyện đã chọn"><div className="moderation-bulk-heading"><strong>Đã chọn {targets.length} truyện</strong><small>Kể cả truyện ngoài bộ lọc hiện tại</small><button className="button button-quiet" disabled={busy} type="button" onClick={() => setSelected([])}>Bỏ chọn</button></div><div className="moderation-bulk-controls"><label>Quyết định hàng loạt<select disabled={busy} onChange={(event) => setDecision(event.target.value as ReviewDecision)} value={decision}><option value="approve">Duyệt và xuất bản</option><option value="changes_requested">Yêu cầu chỉnh sửa</option><option value="reject">Từ chối</option></select></label>{decision !== "approve" && <label className="moderation-bulk-reason">Lý do kiểm duyệt · bắt buộc<textarea disabled={busy} maxLength={2000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}<button className={`button ${decision === "reject" ? "button-danger" : "button-primary"}`} disabled={busy || (decision !== "approve" && !reason.trim())} onClick={() => void reviewSelected()} type="button">{busy ? "Đang xử lý…" : `Áp dụng cho ${targets.length} truyện`}</button></div></section>}
      {progress && <p className="moderation-progress" role="status">{progress}</p>}
      {results.length > 0 && <ul className="moderation-results" aria-label="Kết quả xử lý từng truyện">{results.map((item) => <li key={item.id}><strong>{item.title}</strong><span className={item.error ? "moderation-result-error" : ""}>{item.error ?? "Đã lưu quyết định"}</span></li>)}</ul>}
      {visible.length ? <ul className="moderation-story-list">{visible.map((item) => <li key={item.id}><div className="moderation-row-check"><input aria-label={`Chọn truyện ${item.title}`} checked={selected.includes(item.id)} disabled={busy} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} type="checkbox" /></div><Link className="moderation-story-link" to={`/reviews/${encodeURIComponent(item.id)}`}><span className="moderation-story-copy"><strong>{item.title || "Chưa có tên truyện"}</strong><span>{item.author || "Chưa có tác giả"} · {item.totalChapters} chương</span><small>Người gửi: {item.submittedByName || "Không rõ"} · {submittedDate(item.createdAt)}</small></span><AiReviewBadge status={item.aiReviewStatus} warnings={item.aiReviewWarnings} /><span className="moderation-open">Xem nội dung</span></Link></li>)}</ul> : <ModerationEmpty title={items.length ? "Không tìm thấy truyện phù hợp" : "Chưa có truyện chờ duyệt"}>{items.length ? "Thử tên khác hoặc đổi bộ lọc kết quả AI." : "Truyện sẽ xuất hiện sau khi được gửi duyệt."}</ModerationEmpty>}
    </>}
  </div>;
}
