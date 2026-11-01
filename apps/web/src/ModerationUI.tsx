import { WorkspaceHeading } from "./WorkspaceUI";
import { useId, type ReactNode } from "react";

export type ReviewDecision = "approve" | "changes_requested" | "reject";
export function reviewWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : item && typeof item === "object" && "message" in item && typeof item.message === "string" ? item.message : "Có cảnh báo AI cần được xem xét.");
}
export function aiReviewLabel(status: string): string {
  return ({ warnings: "AI có cảnh báo", passed: "AI đã rà soát", skipped: "Duyệt thủ công · chưa rà soát AI", not_started: "Chưa rà soát AI", pending: "Đang chờ AI" } as Record<string, string>)[status] ?? "Chưa có kết quả AI";
}
export function AiReviewBadge({ status, warnings }: { status: string; warnings?: unknown }) {
  const count = reviewWarnings(warnings).length;
  return <span className={`status-badge ${status === "warnings" || count ? "status-warning" : status === "passed" ? "status-ok" : "status-neutral"}`}>{aiReviewLabel(status)}{count > 0 && <small>{count} cảnh báo</small>}</span>;
}
export const ModerationHeading = WorkspaceHeading;
export function ModerationEmpty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="moderation-empty"><h2>{title}</h2><p>{children}</p></div>;
}
export function ReviewDecisionPanel({ reason, onReasonChange, onDecide, busy, approveLabel, description, error }: {
  reason: string; onReasonChange: (reason: string) => void; onDecide: (decision: ReviewDecision) => void;
  busy: boolean; approveLabel: string; description: string; error?: unknown;
}) {
  const id = useId();
  return <section className="moderation-decision" id="review-decision" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Quyết định của quản trị viên</h2><p>{description}</p>
    <label htmlFor={id}>Ghi chú kiểm duyệt <span>· bắt buộc khi yêu cầu sửa hoặc từ chối</span></label>
    <textarea disabled={busy} id={id} maxLength={2000} onChange={(event) => onReasonChange(event.target.value)} placeholder="Nêu rõ phần cần sửa hoặc lý do từ chối…" rows={3} value={reason} />
    {Boolean(error) && <div className="error-panel" role="alert">{error instanceof Error ? error.message : "Không thể lưu quyết định. Hãy thử lại."}</div>}
    <div className="decision-actions"><button className="button button-primary" disabled={busy} onClick={() => onDecide("approve")} type="button">{busy ? "Đang xử lý…" : approveLabel}</button><button className="button button-secondary" disabled={busy || !reason.trim()} onClick={() => onDecide("changes_requested")} type="button">Yêu cầu chỉnh sửa</button><button className="button button-danger" disabled={busy || !reason.trim()} onClick={() => onDecide("reject")} type="button">Từ chối</button></div>
  </section>;
}
export function ReviewJumpLinks({ decision = true }: { decision?: boolean }) {
  return <nav className="review-jump-links" aria-label="Đi đến phần kiểm duyệt"><a href="#review-content">Đọc nội dung</a>{decision && <a href="#review-decision">Đến phần quyết định</a>}</nav>;
}
