import { WorkspaceHeading, useConfirm } from "./WorkspaceUI";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ModerationEmpty, ModerationHeading, ReviewDecisionPanel, ReviewJumpLinks } from "./ModerationUI";
import { createContentUpdate, decideContentUpdate, fetchContentUpdate, fetchContentUpdateQueue, fetchContentUpdates,
  fetchContributorDetail, importContentUpdate, mediaUrl, saveContentUpdate, saveContentUpdateStructure, submitContentUpdate,
  type ContentUpdate, type ContentUpdateDetail, type ContentUpdateChapter, type ManualUpdateInput, type ReadLiteUser } from "./api/admin";

const labels: Record<ContentUpdate["status"], string> = { draft: "Bản nháp", pending: "Chờ quản trị viên", changes_requested: "Cần chỉnh sửa", rejected: "Đã từ chối", published: "Đã xuất bản", cancelled: "Đã hủy" };
function ErrorNotice({ error }: { error: unknown }) {
  return error ? <div className="error-panel" role="alert">{error instanceof Error ? error.message : "Không thể hoàn tất yêu cầu."}</div> : null;
}
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return total > 20 ? <nav className="moderation-pager" aria-label="Phân trang bản bổ sung"><button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Trang trước</button><span>Trang {page} / {Math.ceil(total / 20)}</span><button className="button button-secondary" type="button" disabled={page * 20 >= total} onClick={() => onChange(page + 1)}>Trang sau</button></nav> : null;
}
function updateDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Chưa có thời gian gửi" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function UpdateRows({ updates }: { updates: ContentUpdate[] }) {
  return updates.length ? <ul className="update-review-list">{updates.map(update => <li key={update.id}><Link className="update-review-link" to={`/content-updates/${encodeURIComponent(update.id)}`}>
    <span className="update-review-copy"><strong>{update.title}</strong><span>{update.storyTitle}</span><small>{update.chapterCount} chương · {update.source === "epub" ? "EPUB" : "Nhập tay"} · {updateDate(update.submittedAt ?? update.createdAt)}</small></span><span className="update-review-state"><span className={`status-badge ${update.status === "changes_requested" ? "status-warning" : "status-neutral"}`}>{labels[update.status]}</span>{update.warnings.length > 0 && <small>{update.warnings.length} lưu ý nhập EPUB</small>}</span><span className="moderation-open">Xem nội dung</span>
  </Link></li>)}</ul> : <ModerationEmpty title="Chưa có bản bổ sung">Các bản bổ sung sẽ xuất hiện tại đây sau khi được tạo.</ModerationEmpty>;
}

export function StoryContentUpdates({ storyId, published }: { storyId: string; published: boolean }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["content-updates", "story", storyId, page], queryFn: () => fetchContentUpdates(storyId, page), retry: false });
  return <section className="manual-form-section"><div className="section-heading"><div><h2>Bổ sung chương</h2></div>{published && <Link className="button button-primary" to={`/submissions/${storyId}/updates/new`}>+ Bổ sung chương</Link>}</div>
    <p>Chương mới được lưu riêng để quản trị viên duyệt. Chương đã xuất bản và vị trí đọc của độc giả được giữ nguyên.</p>
    {query.isPending && <p role="status">Đang tải các bản bổ sung…</p>}<ErrorNotice error={query.error} />{query.data && <><UpdateRows updates={query.data.updates} /><Pager page={page} total={query.data.pagination.total} onChange={setPage} /></>}
  </section>;
}
export function ContentUpdateQueue() {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["content-updates", "queue", page], queryFn: () => fetchContentUpdateQueue(page), retry: false });
  return <div className="page-stack moderation-page"><ModerationHeading title="Duyệt chương bổ sung" description="Kiểm tra nội dung mới trước khi thêm vào truyện đang xuất bản. Đây là hàng đợi duyệt thủ công." />
    <div className="moderation-guidance"><strong>Chỉ duyệt các chương mới.</strong><span>Kiểm tra nội dung trùng lặp và ảnh minh họa. Các chương đã xuất bản tiếp tục đọc bình thường trong lúc chờ duyệt.</span></div>
    {query.isPending && <p role="status">Đang tải hàng đợi…</p>}<ErrorNotice error={query.error} />{query.isError && <button className="button button-secondary moderation-retry" type="button" onClick={() => void query.refetch()}>Thử lại</button>}{query.data && <><div className="moderation-list-heading"><div><h2>Nội dung đang chờ duyệt</h2><p>{query.data.pagination.total} bản chờ duyệt · tối đa 20 bản mỗi trang</p></div><span>Trang {page}</span></div>{query.data.updates.length ? <UpdateRows updates={query.data.updates} /> : <ModerationEmpty title="Chưa có chương mới chờ duyệt">Các bản bổ sung sẽ xuất hiện sau khi tác giả gửi duyệt.</ModerationEmpty>}<Pager page={page} total={query.data.pagination.total} onChange={setPage} /></>}
  </div>;
}

type Volume = { id: string; title: string };
function ManualEditor({ form, setForm, volumes, disabled }: { form: ManualUpdateInput; setForm: (v: ManualUpdateInput) => void; volumes: Volume[]; disabled: boolean }) {
  function changeChapter(index: number, field: "title" | "content", value: string) {
    setForm({ ...form, chapters: form.chapters.map((c, i) => index === i ? { ...c, [field]: value } : c) });
  }
  function move(index: number, offset: number) {
    const chapters = [...form.chapters]; [chapters[index], chapters[index + offset]] = [chapters[index + offset], chapters[index]];
    setForm({ ...form, chapters });
  }
  return <fieldset className="update-editor" disabled={disabled}>
    <div className="manual-field-grid"><label>Tên bản bổ sung<input maxLength={500} required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>Thêm nội dung vào<select value={form.targetVolumeId ?? ""} onChange={e => setForm({ ...form, targetVolumeId: e.target.value || null })}><option value="">Tập mới ở cuối truyện</option>{form.targetVolumeId && !volumes.slice(-1).some(v => v.id === form.targetVolumeId) && <option value={form.targetVolumeId}>Tập cũ — hãy chọn lại tập cuối</option>}{volumes.slice(-1).map(v => <option key={v.id} value={v.id}>{v.title} (tập cuối)</option>)}</select></label>
      {!form.targetVolumeId && <label>Tên tập mới<input maxLength={500} required value={form.volumeTitle} onChange={e => setForm({ ...form, volumeTitle: e.target.value })} /></label>}</div>
    <p className="field-hint">Chương mới luôn được nối sau các chương đã xuất bản. Tối đa 100 chương mỗi bản nhập tay.</p>
    <div className="manual-chapter-list">{form.chapters.map((chapter, index) => <section className="manual-chapter-card" key={index}>
      <div className="manual-chapter-heading"><strong>Chương bổ sung {index + 1}</strong><div><button type="button" className="button button-quiet" aria-label={`Chuyển chương ${index + 1} lên`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="button button-quiet" aria-label={`Chuyển chương ${index + 1} xuống`} disabled={index === form.chapters.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="button button-quiet" disabled={form.chapters.length <= 1} onClick={() => setForm({ ...form, chapters: form.chapters.filter((_, i) => i !== index) })}>Xóa</button></div></div>
      <label>Tên chương<input maxLength={500} required value={chapter.title} onChange={e => changeChapter(index, "title", e.target.value)} /></label><label>Nội dung<textarea maxLength={500000} required rows={9} value={chapter.content} onChange={e => changeChapter(index, "content", e.target.value)} /></label>
    </section>)}</div>
    <button className="button button-secondary" type="button" disabled={form.chapters.length >= 100} onClick={() => setForm({ ...form, chapters: [...form.chapters, { title: "", content: "" }] })}>+ Thêm chương</button>
  </fieldset>;
}
export function NewContentUpdate() {
  const { storyId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contributor", "story", storyId], queryFn: () => fetchContributorDetail(storyId), retry: false });
  const [form, setForm] = useState<ManualUpdateInput>({ title: "Chương mới", targetVolumeId: null, volumeTitle: "Phần tiếp theo", chapters: [{ title: "", content: "" }] });
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"manual" | "epub">("manual");
  const mutation = useMutation({ mutationFn: async () => {
    if (mode === "manual") return createContentUpdate(storyId, form);
    if (!file || !file.name.toLowerCase().endsWith(".epub") || file.size > 100 * 1024 * 1024) throw new Error("Chọn tệp EPUB không quá 100 MiB.");
    return importContentUpdate(storyId, file);
  }, onSuccess: async ({ updateId }) => { await client.invalidateQueries({ queryKey: ["content-updates"] }); navigate(`/content-updates/${updateId}`); } });
  return <div className="page-stack editor-page"><Link className="back-link" to={`/submissions/${storyId}`}>← Chi tiết truyện</Link><WorkspaceHeading title={query.data?.story.title ?? "Nội dung mới"} description="Lưu bản nháp, kiểm tra nội dung rồi gửi quản trị viên duyệt." />
    <ErrorNotice error={query.error} />{query.isError && <button className="button button-secondary" type="button" onClick={() => void query.refetch()}>Thử lại</button>}{query.isPending && <p role="status">Đang tải truyện…</p>}{query.data && (query.data.story.moderationStatus !== "published" ? <p>Chỉ bổ sung chương khi truyện đã được xuất bản.</p> : (query.data.story.lifecycleStatus ?? "ongoing") !== "ongoing" ? <p>Chuyển truyện về Đang ra ở trang chi tiết trước khi bổ sung chương.</p> : <form className="manual-story-form" onSubmit={e => { e.preventDefault(); mutation.mutate(); }}>
      <div className="editor-mode-switch" role="group" aria-label="Cách bổ sung chương"><button type="button" aria-pressed={mode === "manual"} disabled={mutation.isPending} className="button button-secondary" onClick={() => setMode("manual")}>Nhập bằng tay</button><button type="button" aria-pressed={mode === "epub"} disabled={mutation.isPending} className="button button-secondary" onClick={() => setMode("epub")}>Nhập từ EPUB</button></div>
      {mode === "manual" ? <ManualEditor disabled={mutation.isPending} form={form} setForm={setForm} volumes={query.data.preview.volumes} /> : <section className="manual-form-section"><h2>EPUB của phần tiếp theo</h2><p>Mỗi tập trong EPUB sẽ được nối ở cuối truyện. Chọn tệp chỉ chứa nội dung mới để tránh trùng chương. Ảnh minh họa được giữ lại; thông tin và bìa truyện đang xuất bản vẫn giữ nguyên.</p><label className="file-picker">Chọn EPUB<input type="file" accept=".epub,application/epub+zip" disabled={mutation.isPending} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><span className="selected-file">{file?.name ?? "Chưa chọn tệp"}</span></section>}
      <ErrorNotice error={mutation.error} /><button className="button button-primary" disabled={mutation.isPending || (mode === "epub" && !file)} type="submit">{mutation.isPending ? "Đang lưu…" : "Lưu bản nháp bổ sung"}</button>
    </form>)}
  </div>;
}

function UpdatePreview({ chapters }: { chapters: ContentUpdateChapter[] }) {
  return <section className="chapter-preview" id="review-content"><div className="section-heading"><h2>Xem trước {chapters.length} chương bổ sung</h2><span>Mở chương để đọc nội dung</span></div>{chapters.map((chapter, chapterIndex) => <details className="chapter-card" open={chapterIndex === 0} key={chapter.id}><summary><span className="chapter-number">{String(chapterIndex + 1).padStart(2, "0")}</span><span><small>{chapter.volumeTitle}</small><strong>{chapter.title}</strong></span><svg className="moderation-chevron" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 7 5 5 5-5" /></svg></summary>
    <div className="chapter-content"><div className="reader-copy">{chapter.blocks?.length ? chapter.blocks.map((block, index) => block.type === "image" ? <img className="update-illustration" loading="lazy" key={index} src={mediaUrl(block.mediaId) ?? ""} alt={block.altText ?? "Ảnh minh họa"} /> : <p key={index}>{block.runs.map((run, i) => <span key={i} style={{ fontWeight: run.bold ? "bold" : undefined, fontStyle: run.italic ? "italic" : undefined }}>{run.text}</span>)}</p>) : <div className="update-content-text">{chapter.content}</div>}</div></div>
  </details>)}</section>;
}

function UpdateDetailEditor({ detail, user, volumes }: { detail: ContentUpdateDetail; user: ReadLiteUser; volumes: Volume[] }) {
  const confirm = useConfirm();
  const { update } = detail;
  const client = useQueryClient();
  const initialForm: ManualUpdateInput = { title: update.title, targetVolumeId: update.targetVolumeId, volumeTitle: detail.chapters[0]?.volumeTitle ?? "Phần tiếp theo", chapters: detail.chapters.map(c => ({ title: c.title, content: c.content ?? "" })) };
  const initialStructure = detail.chapters.map(c => ({ id: c.id, title: c.title, volumeTitle: c.volumeTitle, volumeOrder: c.volumeOrder }));
  const [form, setForm] = useState(initialForm);
  const [structure, setStructure] = useState(initialStructure);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const canEdit = ["draft", "changes_requested"].includes(update.status);
  const dirty = update.source === "manual" ? JSON.stringify(form) !== JSON.stringify(initialForm) : JSON.stringify(structure) !== JSON.stringify(initialStructure);
  const mutation = useMutation({ mutationFn: async (action: "save" | "submit" | "cancel" | "approve" | "changes_requested" | "reject") => {
    if (action === "save") {
      if (update.source === "manual") await saveContentUpdate(update.id, form);
      else await saveContentUpdateStructure(update.id, structure.map(({ id, title, volumeTitle }) => ({ id, title, volumeTitle })));
    } else if (action === "submit" || action === "cancel") await submitContentUpdate(update.id, action);
    else await decideContentUpdate(update.id, action, reason.trim() || undefined);
    return action;
  }, onSuccess: async action => {
    setMessage(action === "approve" ? "Đã xuất bản chương mới. Người theo dõi sẽ thấy thông báo trong app." : action === "submit" ? "Đã gửi quản trị viên duyệt." : action === "cancel" ? "Đã hủy bản bổ sung." : action === "reject" ? "Đã từ chối bản bổ sung." : action === "changes_requested" ? "Đã yêu cầu chỉnh sửa bản bổ sung." : "Đã lưu thay đổi.");
    await client.invalidateQueries({ queryKey: ["content-updates"] });
    await client.invalidateQueries({ queryKey: ["contributor"] });
  } });
  async function decide(action: "approve" | "changes_requested" | "reject") {
    if (mutation.isPending || (action !== "approve" && !reason.trim())) return;
    if (!await confirm({ title: action === "approve" ? "Xuất bản chương bổ sung" : "Lưu quyết định kiểm duyệt", subject: `${update.storyTitle}\n${update.title}`, description: action === "approve" ? `Xuất bản ${detail.chapters.length} chương bổ sung vào truyện này và thông báo người theo dõi?` : "Lưu quyết định kiểm duyệt bản bổ sung?", confirmLabel: "Xác nhận quyết định", danger: action === "reject" })) return;
    mutation.mutate(action);
  }
  function reorder(index: number, offset: number) {
    const next = [...structure]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setStructure(next);
  }
  return <><section className="submission-actions"><div><strong>{labels[update.status]}</strong><p>{update.status === "pending" ? "Truyện đã xuất bản tiếp tục đọc bình thường trong lúc chờ duyệt." : "Các chương đã xuất bản và tiến độ đọc của độc giả vẫn được giữ lại."}</p>{update.reviewReason && <p>Lý do kiểm duyệt: {update.reviewReason}</p>}</div><div className="decision-actions">{canEdit && <button className="button button-primary" disabled={mutation.isPending || dirty} onClick={() => mutation.mutate("submit")}>Gửi duyệt chương mới</button>}{["draft", "pending", "changes_requested"].includes(update.status) && <button className="button button-secondary" disabled={mutation.isPending} onClick={async () => { if (await confirm({ title: "Hủy bản bổ sung", subject: update.title, description: "Các chương đã xuất bản vẫn được giữ lại.", confirmLabel: "Hủy bản bổ sung", danger: true })) mutation.mutate("cancel"); }}>Hủy bản bổ sung</button>}</div></section>
    {dirty && <p role="status">Bạn có thay đổi chưa lưu. Lưu bản nháp trước khi gửi duyệt.</p>}{message && <div className="success-panel" role="status">{message}</div>}{!(user.role === "admin" && update.status === "pending") && <ErrorNotice error={mutation.error} />}
    {update.warnings.length > 0 && <section className="info-banner"><div><strong>Lưu ý khi nhập EPUB</strong><ul>{update.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div></section>}
    {canEdit && (update.source === "manual" ? <form onSubmit={e => { e.preventDefault(); mutation.mutate("save"); }}><ManualEditor disabled={mutation.isPending} volumes={volumes} form={form} setForm={setForm} /><button className="button button-secondary" type="submit" disabled={mutation.isPending || !dirty}>Lưu bản nháp bổ sung</button></form> : <section className="manual-form-section"><h2>Chỉnh mục lục EPUB</h2><p>Đổi tên tập/chương và di chuyển chương trong cùng tập. Nội dung và ảnh được giữ nguyên.</p><fieldset className="update-editor" disabled={mutation.isPending}>{structure.map((c, index) => <div className="manual-chapter-card" key={c.id}>
      {(index === 0 || structure[index - 1].volumeOrder !== c.volumeOrder) && <label>Tên tập<input maxLength={500} value={c.volumeTitle} onChange={e => setStructure(structure.map(item => item.volumeOrder === c.volumeOrder ? { ...item, volumeTitle: e.target.value } : item))} /></label>}
      <label>Tên chương<input maxLength={500} value={c.title} onChange={e => setStructure(structure.map(item => item.id === c.id ? { ...item, title: e.target.value } : item))} /></label><div className="decision-actions"><button className="button button-quiet" aria-label={`Chuyển chương ${index + 1} lên`} disabled={index === 0 || structure[index - 1]?.volumeOrder !== c.volumeOrder} onClick={() => reorder(index, -1)}>↑</button><button className="button button-quiet" aria-label={`Chuyển chương ${index + 1} xuống`} disabled={index === structure.length - 1 || structure[index + 1]?.volumeOrder !== c.volumeOrder} onClick={() => reorder(index, 1)}>↓</button></div>
    </div>)}<button className="button button-secondary" disabled={!dirty || structure.some(c => !c.title.trim() || !c.volumeTitle.trim())} onClick={() => mutation.mutate("save")}>Lưu mục lục</button></fieldset></section>)}
    <UpdatePreview chapters={detail.chapters} />
    {user.role === "admin" && update.status === "pending" && <ReviewDecisionPanel reason={reason} onReasonChange={setReason} onDecide={decide} busy={mutation.isPending} approveLabel="Duyệt và xuất bản chương" error={mutation.error} description="Chương mới sẽ nối ở cuối truyện; chỉ duyệt nội dung không trùng chương đã có. Khi xuất bản, hệ thống sẽ thông báo cho người theo dõi." />}

  </>;
}
export function ContentUpdateDetailPage({ user }: { user: ReadLiteUser }) {
  const { updateId = "" } = useParams();
  const query = useQuery({ queryKey: ["content-updates", "detail", updateId], queryFn: () => fetchContentUpdate(updateId), retry: false });
  const storyId = query.data?.update.storyId;
  const story = useQuery({ queryKey: ["contributor", "story", storyId], queryFn: () => fetchContributorDetail(storyId!), enabled: Boolean(storyId), retry: false });
  return <div className="page-stack moderation-page"><Link className="back-link" to={user.role === "admin" ? "/chapter-updates" : storyId ? `/submissions/${storyId}` : "/submissions"}>{user.role === "admin" ? "← Hàng đợi chương mới" : "← Chi tiết truyện"}</Link>{query.isPending && <p role="status">Đang tải bản bổ sung…</p>}<ErrorNotice error={query.error} />{query.isError && <button className="button button-secondary moderation-retry" type="button" onClick={() => void query.refetch()}>Thử lại</button>}<ErrorNotice error={story.error} />{query.data && <><ModerationHeading title={query.data.update.title} description={`Bổ sung chương cho truyện: ${query.data.update.storyTitle}`}><Link className="button button-secondary" to={`/submissions/${encodeURIComponent(query.data.update.storyId)}`}>Chi tiết truyện</Link></ModerationHeading><ReviewJumpLinks decision={user.role === "admin" && query.data.update.status === "pending"} /><UpdateDetailEditor detail={query.data} user={user} volumes={story.data?.preview.volumes ?? []} key={updateId} /></>}</div>;
}
