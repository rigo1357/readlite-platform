import { useConfirm } from "./WorkspaceUI";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStoryLifecycle, saveStoryLifecycle, type ContributorDetail, type StoryLifecycle, type StoryLifecycleStatus } from "./api/admin";

export const lifecycleLabels: Record<StoryLifecycleStatus, string> = { ongoing: "Đang ra", completed: "Hoàn thành", paused: "Tạm ngưng" };
export function lifecycleLabel(status?: string) { return lifecycleLabels[status as StoryLifecycleStatus] ?? "Đang ra"; }
function LifecycleForm({ lifecycle, disabled, onSaved }: { lifecycle: StoryLifecycle; disabled: boolean; onSaved: () => void }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState(lifecycle.status);
  const [note, setNote] = useState("");
  const mutation = useMutation({ mutationFn: () => saveStoryLifecycle(lifecycle.storyId, status, lifecycle.version, note.trim()),
    onSuccess: async result => {
      onSaved();
      // Update only lifecycle fields; keep any unsaved metadata/chapter edits on the page.
      client.setQueryData<ContributorDetail>(["contributor", "story", lifecycle.storyId], previous => previous ? {
        ...previous, story: { ...previous.story, lifecycleStatus: result.lifecycle.status, lifecycleVersion: result.lifecycle.version },
      } : previous);
      await client.invalidateQueries({ queryKey: ["story-lifecycle", lifecycle.storyId] });
      await client.invalidateQueries({ queryKey: ["contributor", "stories"] });
    },
  });
  async function submit() {
    if (disabled || mutation.isPending || status === lifecycle.status || (status === "paused" && !note.trim())) return;
    const message = status === "completed" ? "Đánh dấu truyện hoàn thành? Người đang theo dõi có thể nhận thông báo trong app. Muốn bổ sung chương sau này, cần chuyển lại Đang ra." : status === "paused" ? "Tạm ngưng cập nhật truyện? Các chương hiện có vẫn đọc được; chuyển lại Đang ra trước khi thêm chương." : "Chuyển truyện về Đang ra để tiếp tục cập nhật chương?";
    if (await confirm({ title: "Đổi trạng thái tiến hành", subject: `${lifecycleLabel(lifecycle.status)} → ${lifecycleLabel(status)}`, description: message, confirmLabel: "Lưu trạng thái" })) mutation.mutate();
  }
  return <form className="lifecycle-form" onSubmit={event => { event.preventDefault(); submit(); }}>
    <label>Trạng thái tiến hành<select aria-label="Trạng thái tiến hành" disabled={disabled || mutation.isPending} value={status} onChange={event => setStatus(event.target.value as StoryLifecycleStatus)}><option value="ongoing">Đang ra</option><option value="completed">Hoàn thành</option><option value="paused">Tạm ngưng</option></select></label>
    {status !== lifecycle.status && <label>Ghi chú {status === "paused" ? "(bắt buộc khi tạm ngưng)" : "(không bắt buộc)"}<textarea maxLength={2000} rows={3} required={status === "paused"} disabled={mutation.isPending || disabled} value={note} onChange={event => setNote(event.target.value)} /></label>}
    {lifecycle.note && <p className="account-status-reason">Ghi chú lần thay đổi gần nhất: {lifecycle.note}</p>}
    {disabled && <p>Truyện đang chờ duyệt. Có thể cập nhật trạng thái sau khi kiểm duyệt kết thúc.</p>}
    {mutation.error && <p className="error-panel" role="alert">{mutation.error instanceof Error ? mutation.error.message : "Không thể cập nhật. Hãy tải lại trạng thái."}</p>}
    <button className="button button-secondary" type="submit" disabled={disabled || mutation.isPending || status === lifecycle.status || (status === "paused" && !note.trim())}>{mutation.isPending ? "Đang lưu…" : "Lưu trạng thái tiến hành"}</button>
  </form>;
}
export function StoryLifecycleEditor({ storyId, moderationStatus }: { storyId: string; moderationStatus: string }) {
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["story-lifecycle", storyId, page], queryFn: () => fetchStoryLifecycle(storyId, page), retry: false });
  return <section className="manual-form-section lifecycle-section" id="story-lifecycle"><div className="section-heading"><div><h2>Trạng thái tiến hành</h2>{query.data && <span className="status-badge status-neutral">{lifecycleLabel(query.data.lifecycle.status)}</span>}</div><button className="button button-quiet" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Tải lại trạng thái</button></div>
    <p>Đang ra, hoàn thành và tạm ngưng thể hiện tiến độ sáng tác. Việc công khai truyện vẫn cần quyết định kiểm duyệt riêng. Truyện hoàn thành hoặc tạm ngưng vẫn đọc được khi đang công khai.</p>
    {query.isPending && <p role="status">Đang tải trạng thái…</p>}{query.error && <p className="error-panel" role="alert">{query.error instanceof Error ? query.error.message : "Không thể tải trạng thái."}</p>}
    {notice && <p className="success-panel" role="status">{notice}</p>}
    {query.data && <><LifecycleForm onSaved={() => setNotice("Đã cập nhật trạng thái tiến hành.")} lifecycle={query.data.lifecycle} disabled={["ai_review_pending", "admin_review_pending"].includes(moderationStatus)} key={`${storyId}-${query.data.lifecycle.version}`} />
      <details className="editor-history"><summary>Lịch sử trạng thái · {query.data.pagination.total} lần thay đổi</summary>{query.data.events.length ? <ol className="account-status-history">{query.data.events.map(event => <li key={event.id}><strong>{lifecycleLabel(event.previousStatus)} → {lifecycleLabel(event.newStatus)}</strong><p className="account-status-reason">{event.note || "Không có ghi chú"}</p><small>{event.actorName} · {new Date(event.createdAt).toLocaleString("vi-VN")}</small></li>)}</ol> : <p>Chưa có lần thay đổi trạng thái.</p>}
      {(page > 1 || query.data.pagination.total > 20) && <div className="decision-actions"><button className="button button-quiet" type="button" disabled={query.isFetching || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button><span>Trang {page}</span><button className="button button-quiet" type="button" disabled={query.isFetching || page * 20 >= query.data.pagination.total} onClick={() => setPage(page + 1)}>Trang sau</button></div>}</details>
    </>}
  </section>;
}
