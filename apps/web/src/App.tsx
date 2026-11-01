import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ContentUpdateDetailPage, ContentUpdateQueue, NewContentUpdate, StoryContentUpdates } from "./ContentUpdates";
import { ManagedUsers } from "./ManagedUsers";
import { AppIcon, ConfirmationProvider, WorkspaceHeading, useConfirm } from "./WorkspaceUI";
import { StoryReviewQueue } from "./StoryReviewQueue";
import { AiReviewBadge, ModerationHeading, ReviewDecisionPanel, ReviewJumpLinks } from "./ModerationUI";
import { StoryLifecycleEditor } from "./StoryLifecycle";
import { EpubImportPanel, StoryInventory, isEditableDraft, type ImportResult } from "./StoryLibrary";
import {
  ApiError, isApiUnavailable, type ContentBlock, type ContributorDetail, type GenreOption, type ManualChapterInput,
  type ReadLiteUser, type ReviewChapter,
  type ReviewDetail, type ReviewSubmission, decideReview, fetchAdminQueue, fetchContributorDetail,
  fetchContributorStories, fetchCurrentUser, fetchGenres, fetchPublicStoryCount, fetchReviewDetail, fetchContentUpdateQueue,
  createManualStory, importEpub, login, logout, mediaUrl, saveEpubStructure, saveManualChapters, saveMetadata,
  submitStory, uploadCover, hideStory, deleteStory, coverSource, repairStoryMedia,
  fetchAdminReports, decideReport, type AdminReport, type ReportAction, type ReportStatus,
} from "./api/admin";

type Theme = "light" | "dark";
type EditableEpubVolume = { id: string; title: string; chapters: Array<{ id: string; title: string }> };
function displayStatus(value: string | null | undefined): string {
  const values: Record<string, string> = {
    draft: "Bản nháp", ai_review_pending: "Đang chờ AI", admin_review_pending: "Chờ quản trị viên",
    changes_requested: "Cần chỉnh sửa", rejected: "Đã từ chối", published: "Đã xuất bản",
    skipped: "Duyệt thủ công · chưa rà soát AI", not_started: "Chưa gửi duyệt", passed: "AI đã rà soát", warnings: "AI có cảnh báo",
  };
  return value ? values[value] ?? value : "Chưa có trạng thái";
}
function warningsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object" && "message" in entry && typeof (entry as { message: unknown }).message === "string") {
      return (entry as { message: string }).message;
    }
    return "Có cảnh báo AI cần được xem xét.";
  });
}
function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function localDateInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function Message({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <section className="message-panel"><AppIcon name="info" className="message-mark" /><h2>{title}</h2><p>{body}</p>{action}</section>;
}
function Loading({ text = "Đang tải dữ liệu…" }: { text?: string }) {
  return <div className="loading-panel" role="status"><span className="spinner" />{text}</div>;
}
function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const text = error instanceof Error ? error.message : "Không thể tải dữ liệu.";
  return <div className="error-panel" role="alert"><span>{text}</span>{retry && <button className="button button-quiet" onClick={retry} type="button">Thử lại</button>}</div>;
}
function Shell({ user, theme, toggleTheme, onLogout, logoutError, loggingOut, children }: {
  user: ReadLiteUser; theme: Theme; toggleTheme: () => void; onLogout: () => void;
  logoutError?: string; loggingOut: boolean; children: ReactNode;
}) {
  const admin = user.role === "admin";
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return <div className="admin-app">
    <aside className="sidebar">
      <div className="sidebar-brand-row"><Link className="brand" to="/" aria-label="ReadLite — bảng điều khiển"><span className="brand-mark">r</span><span><strong>ReadLite</strong><small>BẢNG ĐIỀU KHIỂN</small></span></Link><button className="icon-button mobile-nav-toggle" type="button" aria-label={menuOpen ? "Đóng điều hướng" : "Mở điều hướng"} aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><AppIcon name={menuOpen ? "close" : "menu"} /></button></div>
      <p className="sidebar-section-title">QUẢN LÝ NỘI DUNG</p>
      <nav className="side-nav" id="workspace-navigation" data-open={menuOpen} aria-label="Điều hướng quản trị" onClick={() => setMenuOpen(false)}>
        {admin && <NavLink end to="/"><AppIcon name="overview" />Tổng quan</NavLink>}
        {admin && <NavLink to="/reviews"><AppIcon name="check" />Duyệt truyện</NavLink>}
        {admin && <NavLink to="/chapter-updates"><AppIcon name="chapters" />Duyệt chương mới</NavLink>}
        {admin && <NavLink to="/reports"><AppIcon name="report" />Báo cáo</NavLink>}
        <NavLink to="/submissions"><AppIcon name="books" />{admin ? "Kho truyện" : "Bản thảo"}</NavLink>
        {admin && <NavLink to="/users"><AppIcon name="users" />Phân quyền</NavLink>}
      </nav>
      <div className="sidebar-bottom">
        <button className="side-action" onClick={toggleTheme} type="button"><AppIcon name={theme === "light" ? "moon" : "sun"} />Giao diện {theme === "light" ? "tối" : "sáng"}</button>
        <NavLink className="account-link" to="/account"><span className="avatar">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span><span className="account-summary"><strong>{user.displayName || user.username}</strong><small>{admin ? "Quản trị viên" : "Tác giả"}</small></span><AppIcon name="chevron" className="account-chevron" /></NavLink>
        <button className="side-action logout-action" disabled={loggingOut} onClick={onLogout} type="button"><AppIcon name="logout" />{loggingOut ? "Đang thoát…" : "Đăng xuất"}</button>
        {logoutError && <p className="logout-error" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="workspace"><header className="topbar"><div><strong>{admin ? "Kiểm soát nội dung ứng dụng" : "Quản lý truyện của bạn"}</strong><span className="workspace-role">{admin ? "Không gian quản trị ReadLite" : "Không gian sáng tác ReadLite"}</span></div><span className="secure-chip"><AppIcon name="check" />Phiên làm việc bảo mật</span></header><main className="workspace-content">{children}</main><footer className="workspace-footer"><span>ReadLite</span><span>Quản lý nội dung trước khi đến với độc giả.</span></footer></div>
  </div>;
}

function LoginPage({ onLogin, notice }: { onLogin: (user: ReadLiteUser) => void; notice?: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  const mutation = useMutation({ mutationFn: () => login(email.trim(), password), onSuccess: user => { onLogin(user); navigate(user.role === "author" ? "/submissions" : "/", { replace: true }); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); }
  return <main className="login-page"><section className="login-card">
    <div className="brand login-brand"><span className="brand-mark">r</span><span><strong>ReadLite</strong><small>BẢNG ĐIỀU KHIỂN</small></span></div>
    <h1>Chào mừng trở lại</h1><p className="login-copy">Đăng nhập để quản lý bản thảo, kiểm tra nội dung và xuất bản truyện.</p>
    {notice && <div className="error-panel" role="alert">{notice}</div>}
    <form className="login-form" onSubmit={submit}><label>Email<input autoComplete="username" disabled={mutation.isPending} onChange={event => setEmail(event.target.value)} required type="email" value={email} /></label>
      <div className="login-password-group"><label htmlFor={passwordId}>Mật khẩu</label><span className="password-field"><input id={passwordId} autoComplete="current-password" disabled={mutation.isPending} onChange={event => setPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={password} /><button className="icon-button" disabled={mutation.isPending} type="button" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><AppIcon name={showPassword ? "eyeOff" : "eye"} /></button></span></div>
      {mutation.error && <ErrorBox error={mutation.error} />}<button className="button button-primary full-width" disabled={mutation.isPending} type="submit">{mutation.isPending ? "Đang đăng nhập…" : "Đăng nhập"}</button>
    </form><p className="login-footnote">Tài khoản cần xác minh email và được cấp quyền quản trị hoặc tác giả.</p>
  </section></main>;
}

function Dashboard() {
  const queueQuery = useQuery({ queryKey: ["admin", "queue"], queryFn: fetchAdminQueue, retry: false });
  const countQuery = useQuery({ queryKey: ["admin", "story-count"], queryFn: fetchPublicStoryCount, retry: false });
  const updateQuery = useQuery({ queryKey: ["content-updates", "queue", 1], queryFn: () => fetchContentUpdateQueue(1), retry: false });
  const reportsQuery = useQuery({ queryKey: ["admin", "reports", "open", 1], queryFn: () => fetchAdminReports("open", 1), retry: false });
  const items = queueQuery.data ?? [];
  const metrics = [
    { to: "/reviews", icon: "check", label: "Truyện chờ duyệt", value: queueQuery.isPending || queueQuery.isError ? "—" : items.length, action: "Mở hàng đợi" },
    { to: "/chapter-updates", icon: "chapters", label: "Bản bổ sung chờ duyệt", value: updateQuery.isPending || updateQuery.isError ? "—" : updateQuery.data?.pagination.total, action: "Kiểm tra chương mới" },
    { to: "/reports", icon: "report", label: "Báo cáo chờ xử lý", value: reportsQuery.isPending || reportsQuery.isError ? "—" : reportsQuery.data?.pagination.total, action: "Xem báo cáo độc giả" },
    { to: "/submissions", icon: "books", label: "Truyện đang công khai", value: countQuery.isPending || countQuery.isError ? "—" : countQuery.data, action: "Quản lý kho truyện" },
  ] as const;
  return <div className="page-stack dashboard-page">
    <section className="dashboard-welcome" aria-label="Chào mừng quản trị viên"><div className="dashboard-welcome-copy"><h1>Chào mừng đến ReadLite</h1><p>Một không gian cho những câu chuyện mới.<br />Kiểm duyệt, chăm chút nội dung và đưa truyện đến với độc giả.</p><div className="dashboard-welcome-actions"><Link className="button button-primary" to="/reviews">Duyệt truyện <AppIcon name="chevron" /></Link><Link className="button dashboard-create" to="/submissions/new">Tạo truyện mới</Link></div></div></section>
    <section className="dashboard-counts" aria-label="Thống kê nội dung">{metrics.map((metric) => <Link key={metric.to} to={metric.to}><div className="dashboard-metric-top"><span className="dashboard-metric-icon"><AppIcon name={metric.icon} /></span><AppIcon name="chevron" /></div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.action}</small></Link>)}</section>
    {countQuery.isError && <ErrorBox error={countQuery.error} retry={() => void countQuery.refetch()} />}{updateQuery.isError && <ErrorBox error={updateQuery.error} retry={() => void updateQuery.refetch()} />}{reportsQuery.isError && <ErrorBox error={reportsQuery.error} retry={() => void reportsQuery.refetch()} />}
    <div className="dashboard-work-grid"><section className="dashboard-review-section"><div className="section-heading"><div><h2>Hàng đợi kiểm duyệt</h2><p>Kiểm tra nội dung trước khi xuất bản.</p></div><Link className="text-link" to="/reviews">Mở hàng đợi <AppIcon name="chevron" /></Link></div>{queueQuery.isError && <ErrorBox error={queueQuery.error} retry={() => void queueQuery.refetch()} />}{queueQuery.isPending ? <Loading text="Đang kiểm tra hàng đợi…" /> : !queueQuery.isError && <ReviewRows items={items.slice(0, 4)} emptyTitle="Hàng đợi đang trống" emptyBody="Truyện sẽ xuất hiện sau khi được gửi duyệt." />}</section>
      <section className="dashboard-tools"><h2>Bắt đầu công việc</h2><p>Đi nhanh đến phần bạn cần quản lý.</p><div><Link to="/submissions"><AppIcon name="books" /><span><strong>Kho truyện</strong><small>Nhập EPUB và quản lý bản thảo</small></span><AppIcon name="chevron" /></Link><Link to="/chapter-updates"><AppIcon name="chapters" /><span><strong>Chương bổ sung</strong><small>Kiểm tra nội dung mới gửi</small></span><AppIcon name="chevron" /></Link><Link to="/users"><AppIcon name="users" /><span><strong>Quản lý tài khoản</strong><small>Phân quyền và xem lịch sử</small></span><AppIcon name="chevron" /></Link></div><Link className="dashboard-account-link" to="/account">Thông tin tài khoản của bạn <AppIcon name="chevron" /></Link></section>
    </div>
    <section className="info-banner"><AppIcon name="info" /><p><strong>Quyết định xuất bản thuộc về quản trị viên.</strong><br />AI hỗ trợ rà soát khi được cấu hình. Với nội dung duyệt thủ công, cần đọc và kiểm tra trước khi xuất bản.</p></section>
  </div>;
}

function ReviewRows({ items, emptyTitle, emptyBody }: { items: ReviewSubmission[]; emptyTitle: string; emptyBody: string }) {
  if (!items.length) return <Message title={emptyTitle} body={emptyBody} />;
  return <div className="submission-list">{items.map((item) => {
    return <Link className="submission-row" key={item.id} to={"/reviews/" + encodeURIComponent(item.id)}>
      <span className="submission-cover"><AppIcon name="books" /></span><span className="submission-main"><strong>{item.title || "Chưa có tên truyện"}</strong><span>{item.author || "Chưa có tác giả"} · {item.totalChapters} chương</span><small>Người gửi: {item.submittedByName || "Không rõ"} · {formatDate(item.createdAt)}</small></span>
      <AiReviewBadge status={item.aiReviewStatus} warnings={item.aiReviewWarnings} /><AppIcon name="chevron" className="row-chevron" />
    </Link>;
  })}</div>;
}
function ReaderBlocks({ blocks, fallback }: { blocks?: ContentBlock[]; fallback?: string | null }) {
  if (!blocks?.length) return <div className="reader-copy">{(fallback || "Chương chưa có nội dung xem trước.").split(/\n{2,}/u).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
  return <div className="reader-copy">{blocks.map((block, index) => {
    if (block.type === "image") {
      const src = mediaUrl(block.mediaId);
      return src ? <figure className="reader-figure" key={index}><img alt={block.altText || "Ảnh trong truyện"} loading="lazy" src={src} />{block.caption && <figcaption>{block.caption}</figcaption>}</figure> : null;
    }
    const runs = block.runs.map((run, runIndex) => <span key={runIndex}>{run.bold && run.italic ? <strong><em>{run.text}</em></strong> : run.bold ? <strong>{run.text}</strong> : run.italic ? <em>{run.text}</em> : run.text}</span>);
    if (block.kind === "heading") return <h4 key={index}>{runs}</h4>;
    if (block.kind === "quote") return <blockquote key={index}>{runs}</blockquote>;
    return <p key={index}>{runs}</p>;
  })}</div>;
}
function ChapterPreview({ chapter, index }: { chapter: ReviewChapter; index: number }) {
  return <details className="chapter-card" open={index === 0}><summary><span className="chapter-number">{String(index + 1).padStart(2, "0")}</span><span>{chapter.volumeTitle && <small>{chapter.volumeTitle}</small>}<strong>{chapter.title || "Chương " + (index + 1)}</strong></span><AppIcon name="chevron" className="chapter-toggle" /></summary><div className="chapter-content"><ReaderBlocks blocks={chapter.blocks} fallback={chapter.content} /></div></details>;
}
function ReviewDetailPage() {
  const confirm = useConfirm();
  const { storyId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "review", storyId], queryFn: () => fetchReviewDetail(storyId), enabled: Boolean(storyId), retry: false });
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: (value: { decision: "approve" | "reject" | "changes_requested"; reason?: string }) => decideReview(storyId, value.decision, value.reason),
    onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["admin", "queue"] }), client.invalidateQueries({ queryKey: ["admin", "story-count"] }), client.invalidateQueries({ queryKey: ["contributor", "stories"] })]); navigate("/reviews"); },
  });
  const detail: ReviewDetail | undefined = query.data;
  const story = detail?.story;
  const warnings = warningsOf(story?.aiReviewWarnings);
  async function decide(value: "approve" | "reject" | "changes_requested") {
    if (!story || mutation.isPending) return;
    if (value !== "approve" && !reason.trim()) return;
    if (value === "approve" && (story.aiReviewStatus === "warnings" || story.aiReviewStatus === "skipped") && !await confirm({ title: "Xác nhận xuất bản", subject: story.title, description: "Bạn đã kiểm tra nội dung và muốn duyệt xuất bản lên app?", confirmLabel: "Duyệt và xuất bản" })) return;
    mutation.mutate({ decision: value, reason: reason.trim() || undefined });
  }
  return <div className="page-stack moderation-page"><Link className="back-link" to="/reviews">← Quay lại hàng đợi</Link>
    {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
    {query.isPending ? <Loading text="Đang tải bản xem trước…" /> : story && detail && <>
      <ModerationHeading title={story.title} description="Đọc nội dung, kiểm tra kết quả AI rồi chọn hướng xử lý." />
      <ReviewJumpLinks />
      <section className="review-overview"><div className="cover-frame">{coverSource(story) ? <img alt={"Bìa truyện " + story.title} src={coverSource(story) ?? ""} /> : <span>ReadLite</span>}</div><div className="review-metadata"><div className="detail-badges"><AiReviewBadge status={story.aiReviewStatus} warnings={story.aiReviewWarnings} /><span className="status-badge status-neutral">{displayStatus(story.moderationStatus)}</span></div><p><strong>Tác giả:</strong> {story.author || "Chưa cập nhật"}</p><p><strong>Người gửi:</strong> {story.submittedByName || "Không rõ"}</p><p><strong>Ngôn ngữ:</strong> {story.language || "Chưa xác định"}</p><p><strong>Số chương:</strong> {story.totalChapters}</p><p className="story-summary">{story.summary || "Chưa có giới thiệu."}</p></div></section>
      <section className={"moderation-ai" + (warnings.length ? " has-warnings" : "")}><h2>{warnings.length ? "Có nội dung cần xem xét" : story.aiReviewStatus === "passed" ? "AI không ghi nhận cảnh báo" : "Cần kiểm tra nội dung thủ công"}</h2>{warnings.length ? <ul>{warnings.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>{story.aiReviewStatus === "passed" ? "AI đã hoàn tất rà soát. Quyết định xuất bản vẫn thuộc về quản trị viên." : "Chưa có kết quả rà soát AI. Quản trị viên cần đọc và kiểm tra nội dung trước khi xuất bản."}</p>}</section>
      <section className="chapter-preview" id="review-content"><div className="section-heading"><h2>Xem trước chương</h2><span>{detail.chapters.length} chương</span></div>{detail.chapters.length ? <div className="chapter-list">{detail.chapters.map((chapter, index) => <ChapterPreview chapter={chapter} index={index} key={chapter.id} />)}</div> : <Message title="Chưa có chương" body="Bản xem trước không có chương để hiển thị." />}</section>
      <ReviewDecisionPanel reason={reason} onReasonChange={setReason} onDecide={decide} busy={mutation.isPending} approveLabel="Duyệt và xuất bản" description="Chỉ xuất bản sau khi đã kiểm tra nội dung và các cảnh báo ở trên." error={mutation.error} />
    </>}
  </div>;
}

function normalizeGenreSearch(value: string): string {
  return value.toLocaleLowerCase("vi-VN").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
}
function GenrePicker({ genres, selected, onChange, disabled = false }: {
  genres: GenreOption[]; selected: string[]; onChange: (values: string[]) => void; disabled?: boolean;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const query = normalizeGenreSearch(search);
  const matches = query ? genres.filter((genre) => normalizeGenreSearch(genre.name).includes(query)) : [];
  const visibleMatches = matches.slice(0, 20);
  const selectedGenres = selected
    .map((id) => genres.find((genre) => genre.id === id))
    .filter((genre): genre is GenreOption => Boolean(genre));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }
  return <fieldset className="genre-picker" disabled={disabled}>
    <legend>Thể loại <span>· chọn ít nhất một</span></legend>
    <label className="genre-search" htmlFor={searchId}>
      <span>Tìm thể loại theo tên</span>
      <input autoComplete="off" id={searchId} onChange={(event) => setSearch(event.target.value)} placeholder="Ví dụ: Fantasy hoặc kỳ ảo" type="search" value={search} />
    </label>
    {selectedGenres.length > 0 && <div aria-label="Thể loại đã chọn" className="selected-genre-list">
      {selectedGenres.map((genre) => <span className="selected-genre-chip" key={genre.id}>
        {genre.name}
        <button aria-label={"Bỏ thể loại " + genre.name} onClick={() => toggle(genre.id)} type="button">×</button>
      </span>)}
    </div>}
    {!query ? <p className="field-hint">Nhập tên tiếng Anh hoặc tiếng Việt để tìm thể loại.</p>
      : visibleMatches.length ? <>
        <div aria-label="Kết quả tìm thể loại" className="genre-options">
          {visibleMatches.map((genre) => <label className="genre-option" key={genre.id}>
            <input checked={selected.includes(genre.id)} onChange={() => toggle(genre.id)} type="checkbox" />{genre.name}
          </label>)}
        </div>
        {matches.length > visibleMatches.length && <p className="field-hint">Đang hiện {visibleMatches.length} trong {matches.length} kết quả. Nhập thêm để thu hẹp.</p>}
      </> : <p className="field-hint">Không tìm thấy thể loại phù hợp.</p>}
  </fieldset>;
}
function ChapterEditor({ chapters, onChange, disabled = false }: {
  chapters: ManualChapterInput[]; onChange: (chapters: ManualChapterInput[]) => void; disabled?: boolean;
}) {
  function update(index: number, key: keyof ManualChapterInput, value: string) {
    onChange(chapters.map((chapter, chapterIndex) => chapterIndex === index ? { ...chapter, [key]: value } : chapter));
  }
  function move(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= chapters.length) return;
    const reordered = [...chapters];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange(reordered);
  }
  return <div className="manual-chapter-list">{chapters.map((chapter, index) => <section className="manual-chapter-card" key={index}>
    <div className="manual-chapter-heading"><strong>Chương {index + 1}</strong><div>
      <button aria-label={"Chuyển chương " + (index + 1) + " lên"} className="button button-quiet" disabled={disabled || index === 0} onClick={() => move(index, -1)} type="button">↑</button>
      <button aria-label={"Chuyển chương " + (index + 1) + " xuống"} className="button button-quiet" disabled={disabled || index === chapters.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
      <button className="button button-quiet" disabled={disabled || chapters.length <= 1} onClick={() => onChange(chapters.filter((_, chapterIndex) => chapterIndex !== index))} type="button">Xóa</button>
    </div></div>
    <label>Tên chương<input maxLength={500} onChange={(event) => update(index, "title", event.target.value)} required value={chapter.title} /></label>
    <label>Nội dung chương<textarea maxLength={500000} minLength={1} onChange={(event) => update(index, "content", event.target.value)} required rows={9} value={chapter.content} /></label>
  </section>)}</div>;
}
function EpubStructureEditor({ volumes, onChange, disabled = false }: {
  volumes: EditableEpubVolume[]; onChange: (volumes: EditableEpubVolume[]) => void; disabled?: boolean;
}) {
  function moveVolume(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= volumes.length) return;
    const reordered = [...volumes];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange(reordered);
  }
  function moveChapter(volumeIndex: number, chapterIndex: number, offset: number) {
    const destination = chapterIndex + offset;
    const chapters = volumes[volumeIndex]?.chapters ?? [];
    if (destination < 0 || destination >= chapters.length) return;
    onChange(volumes.map((volume, index) => {
      if (index !== volumeIndex) return volume;
      const reordered = [...volume.chapters];
      [reordered[chapterIndex], reordered[destination]] = [reordered[destination], reordered[chapterIndex]];
      return { ...volume, chapters: reordered };
    }));
  }
  return <div className="epub-structure-list">{volumes.map((volume, volumeIndex) => <section className="epub-volume-editor" key={volume.id}>
    {volumes.length > 1 && <div className="epub-volume-heading"><label>Tên tập<input disabled={disabled} maxLength={500} onChange={(event) => onChange(volumes.map((item, index) => index === volumeIndex ? { ...item, title: event.target.value } : item))} required value={volume.title} /></label><div><button aria-label={"Chuyển tập " + (volumeIndex + 1) + " lên"} className="button button-quiet" disabled={disabled || volumeIndex === 0} onClick={() => moveVolume(volumeIndex, -1)} type="button">↑</button><button aria-label={"Chuyển tập " + (volumeIndex + 1) + " xuống"} className="button button-quiet" disabled={disabled || volumeIndex === volumes.length - 1} onClick={() => moveVolume(volumeIndex, 1)} type="button">↓</button></div></div>}
    <p className="field-hint">{volume.chapters.length} chương</p>
    {volume.chapters.map((chapter, chapterIndex) => <div className="epub-chapter-editor" key={chapter.id}><label>Chương {chapterIndex + 1}<input disabled={disabled} maxLength={500} onChange={(event) => onChange(volumes.map((item, index) => index === volumeIndex ? { ...item, chapters: item.chapters.map((entry, itemIndex) => itemIndex === chapterIndex ? { ...entry, title: event.target.value } : entry) } : item))} required value={chapter.title} /></label><div><button aria-label={"Chuyển chương " + (chapterIndex + 1) + " lên"} className="button button-quiet" disabled={disabled || chapterIndex === 0} onClick={() => moveChapter(volumeIndex, chapterIndex, -1)} type="button">↑</button><button aria-label={"Chuyển chương " + (chapterIndex + 1) + " xuống"} className="button button-quiet" disabled={disabled || chapterIndex === volume.chapters.length - 1} onClick={() => moveChapter(volumeIndex, chapterIndex, 1)} type="button">↓</button></div></div>)}
  </section>)}</div>;
}
function SubmissionsPage({ user }: { user: ReadLiteUser }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contributor", "stories"], queryFn: fetchContributorStories, retry: false });
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [activeImportIndex, setActiveImportIndex] = useState<number | null>(null);
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  async function submitSelectedDrafts() {
    const targets = (query.data ?? []).filter((story) => selectedDrafts.includes(story.id) && isEditableDraft(story));
    if (!targets.length || submitBusy || !await confirm({ title: `Gửi duyệt ${targets.length} bản nháp`, subject: targets.map(story => story.title).join("\n"), description: "Hãy kiểm tra thông tin và ảnh từng truyện trước khi gửi.", confirmLabel: "Gửi kiểm duyệt" })) return;
    setSubmitBusy(true);
    const failed: string[] = [];
    for (const story of targets) {
      try { await submitStory(story.id); }
      catch (error) { failed.push(`${story.title}: ${error instanceof Error ? error.message : "Không thể gửi duyệt."}`); }
    }
    setSelectedDrafts([]);
    setSubmitMessage(`Đã gửi ${targets.length - failed.length}/${targets.length} bản nháp.${failed.length ? " Lỗi: " + failed.join("; ") : ""}`);
    await client.invalidateQueries({ queryKey: ["contributor", "stories"] });
    setSubmitBusy(false);
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!files.length || busy) { if (!files.length) setMessage("Chọn ít nhất một tệp EPUB."); return; }
    if (files.length > 20) { setMessage("Mỗi lượt chọn tối đa 20 tệp EPUB."); return; }
    setBusy(true);
    const completed = new Map<number, ImportResult>(
      importResults.filter((item) => item.id).map((item) => [item.index, item]),
    );
    setImportResults([...completed.values()]);
    const record = (item: ImportResult) => {
      completed.set(item.index, item);
      setImportResults([...completed.values()].sort((left, right) => left.index - right.index));
    };
    let apiUnavailable = false;
    try {
      for (let index = 0; index < files.length; index++) {
        if (completed.get(index)?.id) continue;
        const file = files[index];
        setActiveImportIndex(index);
        setMessage(`Đang nhập ${index + 1}/${files.length}: ${file.name}`);
        if (!file.name.toLowerCase().endsWith(".epub") || file.size > 100 * 1024 * 1024) {
          record({ index, name: file.name, error: "Tệp phải có đuôi .epub và không quá 100 MiB." });
          continue;
        }
        try { const result = await importEpub(file); record({ index, name: file.name, id: result.story.id }); }
        catch (error) {
          record({ index, name: file.name, error: error instanceof Error ? error.message : "Không thể nhập EPUB." });
          if (isApiUnavailable(error)) { apiUnavailable = true; break; }
        }
      }
      const imported = [...completed.values()].filter((item) => item.id).length;
      setMessage(apiUnavailable
        ? `API đang ngừng phản hồi. Đã nhập ${imported}/${files.length} tệp; hãy bật lại API rồi chọn “Tiếp tục nhập” để không nhập trùng.`
        : `Đã nhập ${imported}/${files.length} tệp. Mở từng bản nháp để kiểm tra trước khi gửi duyệt.`);
      await client.invalidateQueries({ queryKey: ["contributor", "stories"] });
      const singleStoryId = completed.get(0)?.id;
      if (files.length === 1 && singleStoryId) navigate("/submissions/" + encodeURIComponent(singleStoryId));
    } finally { setBusy(false); setActiveImportIndex(null); }
  }
  return <div className="page-stack library-page">
    <div className="submission-page-heading library-heading"><div><h1>{user.role === "admin" ? "Kho truyện của ứng dụng" : "Bản thảo"}</h1><p>Quản lý cùng nguồn truyện với Android: tạo, nhập EPUB, chỉnh sửa và xuất bản.</p></div><Link className="button button-secondary" to="/submissions/new">Tạo truyện thủ công</Link></div>
    <EpubImportPanel files={files} results={importResults} busy={busy} activeIndex={activeImportIndex} message={message} onFilesChange={(next) => { if (busy) return; setFiles(next); setImportResults([]); setMessage(next.length > 20 ? "Mỗi lượt chọn tối đa 20 tệp EPUB. Hãy chọn lại ít tệp hơn." : ""); }} onSubmit={(event) => void upload(event)} />
    {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
    {query.isPending ? <Loading text="Đang tải bản thảo…" /> : query.data && <StoryInventory stories={query.data} selected={selectedDrafts} onSelect={setSelectedDrafts} submitBusy={submitBusy} onSubmit={() => void submitSelectedDrafts()} submitMessage={submitMessage} admin={user.role === "admin"} />}

  </div>;
}
function ManualStoryPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const genresQuery = useQuery({ queryKey: ["catalog", "genres"], queryFn: fetchGenres, retry: false });
  const [form, setForm] = useState({ title: "", author: "", summary: "", language: "vi", publicationDate: localDateInput(), volumeTitle: "Tập 1", genreIds: [] as string[] });
  const [chapters, setChapters] = useState<ManualChapterInput[]>([{ title: "Chương 1", content: "" }]);
  const [cover, setCover] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [createdStoryId, setCreatedStoryId] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: async () => {
      const result = await createManualStory({
        ...form,
        publicationDate: form.publicationDate || null,
        chapters,
      });
      let coverError: string | null = null;
      if (cover) {
        try { await uploadCover(result.story.id, cover); }
        catch (error) { coverError = error instanceof Error ? error.message : "Không tải được ảnh bìa."; }
      }
      return { story: result.story, coverError };
    },
    onSuccess: async ({ story, coverError }) => {
      setCreatedStoryId(story.id);
      await client.invalidateQueries({ queryKey: ["contributor", "stories"] });
      if (coverError) {
        setMessage("Đã tạo bản nháp, nhưng ảnh bìa chưa tải lên được. Mở bản nháp để thử lại.");
        return;
      }
      navigate("/submissions/" + encodeURIComponent(story.id));
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createMutation.isPending || createdStoryId) return;
    setMessage("");
    if (!form.genreIds.length) { setMessage("Chọn ít nhất một thể loại."); return; }
    if (chapters.some((chapter) => !chapter.title.trim() || !chapter.content.trim())) {
      setMessage("Mỗi chương cần có tên và nội dung."); return;
    }
    if (cover && cover.size > 10 * 1024 * 1024) { setMessage("Ảnh bìa tối đa 10 MiB."); return; }
    createMutation.mutate();
  }
  return <div className="page-stack editor-page"><Link className="back-link" to="/submissions">← Quay lại bản thảo</Link>
    <WorkspaceHeading title="Tạo truyện mới" description="Nhập thông tin truyện và nội dung từng chương. Bản nháp sẽ ở chế độ riêng tư cho đến khi được duyệt." />
    {genresQuery.isError && <ErrorBox error={genresQuery.error} retry={() => void genresQuery.refetch()} />}
    <form className="manual-story-form" onSubmit={submit}><fieldset className="editor-fieldset" disabled={createMutation.isPending || Boolean(createdStoryId)}>
      <section className="manual-form-section" id="story-metadata"><div className="section-heading"><div><h2>Thông tin chung</h2></div></div>
        <div className="manual-field-grid">
          <label>Tên truyện<input autoComplete="off" maxLength={500} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
          <label>Tác giả<input autoComplete="off" maxLength={500} onChange={(event) => setForm({ ...form, author: event.target.value })} required value={form.author} /></label>
          <label>Ngôn ngữ<input maxLength={35} onChange={(event) => setForm({ ...form, language: event.target.value })} required value={form.language} /></label>
          <label>Ngày phát hành<input onChange={(event) => setForm({ ...form, publicationDate: event.target.value })} required type="date" value={form.publicationDate} /></label>
          <label className="manual-field-wide">Giới thiệu chi tiết<textarea maxLength={20000} onChange={(event) => setForm({ ...form, summary: event.target.value })} required rows={5} value={form.summary} /></label>
        </div>
        {genresQuery.data && <GenrePicker genres={genresQuery.data} onChange={(genreIds) => setForm({ ...form, genreIds })} selected={form.genreIds} />}
        <div className="manual-cover-row"><div><strong>Ảnh bìa</strong><p>Không bắt buộc · JPEG, PNG hoặc WebP · tối đa 10 MiB</p></div><label className="file-picker">Chọn ảnh bìa<input accept="image/jpeg,image/png,image/webp" onChange={(event) => setCover(event.target.files?.[0] ?? null)} disabled={createMutation.isPending || Boolean(createdStoryId)} type="file" /></label><span className="selected-file">{cover?.name || "Chưa chọn ảnh"}</span></div>
      </section>
      <section className="manual-form-section"><div className="section-heading"><div><h2>Nội dung chương · {chapters.length} chương</h2></div><button className="button button-secondary" onClick={() => setChapters([...chapters, { title: "Chương " + (chapters.length + 1), content: "" }])} type="button">+ Thêm chương</button></div>
        <ChapterEditor chapters={chapters} disabled={createMutation.isPending || Boolean(createdStoryId)} onChange={setChapters} />
      </section>
      {message && <div className="error-panel" role="status">{message}{createdStoryId && <Link className="button button-secondary" to={"/submissions/" + encodeURIComponent(createdStoryId)}>Mở bản nháp</Link>}</div>}
      {createMutation.error && <ErrorBox error={createMutation.error} />}
      <div className="manual-submit-row"><p>Số chương được tính tự động từ danh sách nội dung ở trên.</p><button className="button button-primary" disabled={createMutation.isPending || Boolean(createdStoryId) || genresQuery.isPending || !genresQuery.data?.length} type="submit">{createMutation.isPending ? "Đang lưu bản nháp…" : createdStoryId ? "Đã tạo bản nháp" : "Lưu bản nháp"}</button></div>
    </fieldset></form>
  </div>;
}
function SubmissionDetailPage({ user }: { user: ReadLiteUser }) {
  const confirm = useConfirm();
  const { storyId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contributor", "story", storyId], queryFn: () => fetchContributorDetail(storyId), enabled: Boolean(storyId), retry: false });
  const genresQuery = useQuery({ queryKey: ["catalog", "genres"], queryFn: fetchGenres, retry: false });
  const detail: ContributorDetail | undefined = query.data;
  const story = detail?.story;
  const [form, setForm] = useState({ title: "", author: "", summary: "", language: "vi", publicationDate: localDateInput(), genreIds: [] as string[] });
  const [volumeTitle, setVolumeTitle] = useState("Tập 1");
  const [chapters, setChapters] = useState<ManualChapterInput[]>([]);
  const [epubVolumes, setEpubVolumes] = useState<EditableEpubVolume[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState(false);
  useEffect(() => {
    if (story) {
      setForm({
        title: story.title || "", author: story.author || "", summary: story.summary || "",
        language: story.language || "vi", publicationDate: story.publicationDate?.slice(0, 10) || "",
        genreIds: story.genreIds || [],
      });
    }
  }, [story?.id, story?.title, story?.author, story?.summary, story?.language, story?.publicationDate, story?.genreIds]);
  useEffect(() => {
    const firstVolume = detail?.preview.volumes[0];
    if (story?.source === "epub" && detail) {
      setEpubVolumes(detail.preview.volumes.map((volume) => ({
        id: volume.id,
        title: volume.title,
        chapters: volume.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
      })));
    }
    if (firstVolume) {
      setVolumeTitle(firstVolume.title);
      if (story?.source === "manual") {
        setChapters(firstVolume.chapters.map((chapter) => ({ title: chapter.title, content: chapter.content || "" })));
      }
    }
  }, [detail?.preview, story?.source]);
  async function refreshSavedPart(part: "metadata" | "content" | "cover" | "media") {
    const fresh = await fetchContributorDetail(storyId);
    client.setQueryData<ContributorDetail>(["contributor", "story", storyId], previous => {
      if (!previous) return fresh;
      const nextStory = part === "metadata" ? {
        ...previous.story, title: fresh.story.title, author: fresh.story.author, summary: fresh.story.summary,
        language: fresh.story.language, publicationDate: fresh.story.publicationDate, genreIds: fresh.story.genreIds,
        updatedAt: fresh.story.updatedAt,
      } : part === "cover" || part === "media" ? {
        ...previous.story, coverUrl: fresh.story.coverUrl, coverMediaId: fresh.story.coverMediaId, updatedAt: fresh.story.updatedAt,
      } : { ...previous.story, totalChapters: fresh.story.totalChapters, updatedAt: fresh.story.updatedAt };
      return { ...previous, story: nextStory, ...(part === "content" || part === "media" ? { preview: fresh.preview } : {}) };
    });
    await client.invalidateQueries({ queryKey: ["contributor", "stories"] });
  }
  const saveMutation = useMutation({
    mutationFn: () => saveMetadata(storyId, {
      title: form.title, author: form.author, summary: form.summary,
      ...(form.language.trim().length >= 2 ? { language: form.language.trim() } : {}),
      publicationDate: form.publicationDate || null,
      genreIds: form.genreIds,
    }),
    onSuccess: async () => { setMessage("Đã lưu thông tin bản thảo."); setErrorMessage(false); await refreshSavedPart("metadata"); },
  });
  const chaptersMutation = useMutation({
    mutationFn: () => saveManualChapters(storyId, { volumeTitle, chapters }),
    onSuccess: async () => { setMessage("Đã lưu nội dung " + chapters.length + " chương."); setErrorMessage(false); await refreshSavedPart("content"); },
  });
  const structureMutation = useMutation({
    mutationFn: () => saveEpubStructure(storyId, { volumes: epubVolumes }),
    onSuccess: async () => { setMessage("Đã lưu tên và thứ tự tập/chương."); setErrorMessage(false); await refreshSavedPart("content"); },
  });
  const coverMutation = useMutation({
    mutationFn: () => {
      if (!cover) throw new Error("Chọn ảnh bìa trước.");
      if (cover.size > 10 * 1024 * 1024) throw new Error("Ảnh bìa tối đa 10 MiB.");
      return uploadCover(storyId, cover);
    },
    onSuccess: async () => { setMessage("Đã cập nhật ảnh bìa."); setErrorMessage(false); setCover(null); await refreshSavedPart("cover"); },
  });
  const submitMutation = useMutation({
    mutationFn: () => submitStory(storyId),
    onSuccess: async () => { setMessage("Đã gửi duyệt. Quản trị viên có thể xem trong mục Duyệt truyện."); setErrorMessage(false); await client.invalidateQueries({ queryKey: ["contributor"] }); await client.invalidateQueries({ queryKey: ["admin"] }); },
    onError: (error) => {
      setMessage(error instanceof ApiError && error.code === "AI_REVIEW_UNAVAILABLE"
        ? "Bản nháp vẫn được lưu riêng. AI chưa được cấu hình nên chưa thể chuyển sang bước kiểm duyệt."
        : error instanceof Error ? error.message : "Không thể gửi bản thảo.");
      setErrorMessage(true);
    },
  });
  const repairMutation = useMutation({ mutationFn: () => repairStoryMedia(storyId), onSuccess: async (result) => {
    setMessage(result.coverRestored || result.restoredChapters ? `Đã khôi phục ${result.coverRestored ? "ảnh bìa và " : ""}ảnh trong ${result.restoredChapters} chương.` : "Đã kiểm tra EPUB. Không có ảnh bổ sung; bạn có thể tải ảnh bìa riêng.");
    setErrorMessage(false); await refreshSavedPart("media");
  } });
  const hideMutation = useMutation({ mutationFn: () => hideStory(storyId), onSuccess: async () => { setMessage("Đã ẩn truyện khỏi app, nội dung vẫn còn trong kho."); setErrorMessage(false); await client.invalidateQueries(); } });
  const deleteMutation = useMutation({ mutationFn: () => deleteStory(storyId), onSuccess: async () => { await client.invalidateQueries(); navigate("/submissions"); } });
  if (query.isPending) return <div className="page-stack"><Loading text="Đang tải bản xem trước…" /></div>;
  if (query.isError || !detail || !story) return <div className="page-stack"><Link className="back-link" to="/submissions">← Danh sách bản thảo</Link><ErrorBox error={query.error} retry={() => void query.refetch()} /></div>;
  const canSubmit = story.moderationStatus === "draft" || story.moderationStatus === "changes_requested";
  const canEdit = canSubmit || (user.role === "admin" && ["published", "rejected"].includes(story.moderationStatus));
  const singleVolume = detail.preview.volumes.length === 1;
  const originalEpubVolumes = detail.preview.volumes.map((volume) => ({
    id: volume.id,
    title: volume.title,
    chapters: volume.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
  }));
  const epubStructureDirty = story.source === "epub" && JSON.stringify(epubVolumes) !== JSON.stringify(originalEpubVolumes);
  const metadataDirty = JSON.stringify(form) !== JSON.stringify({
    title: story.title || "", author: story.author || "", summary: story.summary || "", language: story.language || "vi",
    publicationDate: story.publicationDate?.slice(0, 10) || "", genreIds: story.genreIds || [],
  });
  const originalManual = detail.preview.volumes[0];
  const chaptersDirty = story.source === "manual" && (volumeTitle !== (originalManual?.title || "Tập 1") || JSON.stringify(chapters) !== JSON.stringify((originalManual?.chapters ?? []).map(chapter => ({ title: chapter.title, content: chapter.content || "" }))));
  const unsaved = metadataDirty || epubStructureDirty || chaptersDirty;
  return <div className="page-stack editor-page"><Link className="back-link" to="/submissions">← Danh sách bản thảo</Link><WorkspaceHeading title={story.title} description="Kiểm tra thông tin, bìa và nội dung trước khi gửi rà soát." /><nav className="editor-section-links" aria-label="Các phần của truyện"><a href="#story-metadata">Thông tin và ảnh bìa</a><a href="#story-lifecycle">Trạng thái tiến hành</a><a href="#story-content">Nội dung chương</a>{story.source === "epub" && canEdit && <a href="#story-preview">Xem nội dung</a>}</nav>
    <section className="draft-editor" id="story-metadata"><div className="draft-cover-large">{coverSource(story) ? <img alt={"Bìa " + story.title} src={coverSource(story) ?? ""} /> : <span>{story.source === "epub" ? "Không có bìa" : story.title.slice(0, 1) || "R"}</span>}</div>{<form className="metadata-form" onSubmit={(event) => { event.preventDefault(); if (canEdit && !saveMutation.isPending) saveMutation.mutate(); }}><fieldset className="metadata-fields" disabled={!canEdit || saveMutation.isPending}>
      <label>Tên truyện<input maxLength={500} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
      <label>Tác giả<input maxLength={500} onChange={(event) => setForm({ ...form, author: event.target.value })} required value={form.author} /></label>
      <label>Ngôn ngữ<input maxLength={35} onChange={(event) => setForm({ ...form, language: event.target.value })} value={form.language} /></label>
      <label>Ngày phát hành<input onChange={(event) => setForm({ ...form, publicationDate: event.target.value })} type="date" value={form.publicationDate} /></label>
      <label className="metadata-wide">Giới thiệu chi tiết<textarea maxLength={20000} onChange={(event) => setForm({ ...form, summary: event.target.value })} rows={4} value={form.summary} /></label>
      {genresQuery.isError && <ErrorBox error={genresQuery.error} retry={() => void genresQuery.refetch()} />}
      {genresQuery.data && <div className="metadata-wide"><GenrePicker disabled={!canEdit} genres={genresQuery.data} onChange={(genreIds) => setForm({ ...form, genreIds })} selected={form.genreIds} /></div>}
      <button className="button button-secondary" disabled={!canEdit || saveMutation.isPending} type="submit">{saveMutation.isPending ? "Đang lưu…" : "Lưu thông tin"}</button>
    </fieldset></form>}</section>
    {canEdit && <section className="cover-upload"><div><h2>Ảnh bìa</h2><p>JPEG, PNG hoặc WebP; tối đa 10 MiB.</p></div><label className="file-picker">Chọn ảnh<input accept="image/jpeg,image/png,image/webp" onChange={(event) => setCover(event.target.files?.[0] ?? null)} disabled={coverMutation.isPending} type="file" /></label><span className="selected-file">{cover?.name || "Chưa chọn ảnh"}</span><button className="button button-secondary" disabled={!cover || coverMutation.isPending} onClick={() => coverMutation.mutate()} type="button">{coverMutation.isPending ? "Đang tải…" : "Tải ảnh bìa"}</button>{coverMutation.error && <ErrorBox error={coverMutation.error} />}</section>}
    {story.source === "epub" && canEdit && <section className="cover-upload"><div><h2>Ảnh từ EPUB đã nhập</h2><p>Đọc lại tệp gốc để bổ sung bìa và ảnh còn thiếu, giữ nguyên truyện và tiến độ đọc.</p></div><button className="button button-secondary" disabled={repairMutation.isPending || epubStructureDirty} onClick={() => repairMutation.mutate()}>{repairMutation.isPending ? "Đang khôi phục…" : "Khôi phục ảnh EPUB"}</button>{repairMutation.error && <ErrorBox error={repairMutation.error} />}</section>}
    {user.role === "admin" && <section className="submission-actions"><div><strong>Quản lý trên ứng dụng</strong><p>Thay đổi tại đây áp dụng cho cùng truyện trên Android khi tải lại.</p></div><div className="decision-actions">
      {story.moderationStatus === "published" && <button className="button button-secondary" disabled={hideMutation.isPending} onClick={async () => { if (await confirm({ title: "Ẩn truyện khỏi app", subject: story.title, description: "Nội dung và tiến độ đọc vẫn được giữ lại. Truyện sẽ không xuất hiện trong danh mục công khai.", confirmLabel: "Ẩn truyện" })) hideMutation.mutate(); }}>Ẩn khỏi app</button>}
      {story.moderationStatus === "admin_review_pending" && <Link className="button button-primary" to={"/reviews/" + storyId}>Mở trang duyệt</Link>}
      <button className="button button-danger" disabled={deleteMutation.isPending || story.moderationStatus === "ai_review_pending"} onClick={async () => { if (await confirm({ title: "Xóa vĩnh viễn truyện", subject: story.title, description: "Truyện cùng các chương và tiến độ liên quan sẽ bị xóa. Thao tác này không thể hoàn tác.", confirmLabel: "Xóa vĩnh viễn", danger: true })) deleteMutation.mutate(); }}>Xóa truyện</button>
    </div>{hideMutation.error && <ErrorBox error={hideMutation.error} />}{deleteMutation.error && <ErrorBox error={deleteMutation.error} />}</section>}
    {message && <div className={errorMessage ? "error-panel" : "success-panel"} role="status">{message}</div>}
    {saveMutation.error && <ErrorBox error={saveMutation.error} />}
    {chaptersMutation.error && <ErrorBox error={chaptersMutation.error} />}
    {structureMutation.error && <ErrorBox error={structureMutation.error} />}
    <StoryLifecycleEditor storyId={storyId} moderationStatus={story.moderationStatus} />
    <StoryContentUpdates storyId={storyId} published={story.moderationStatus === "published" && (story.lifecycleStatus ?? "ongoing") === "ongoing"} />
    <section className="submission-actions"><div><strong>{displayStatus(story.moderationStatus)}</strong><p>{unsaved ? "Bạn có thay đổi chưa lưu. Hãy lưu thông tin, mục lục hoặc nội dung trước khi gửi kiểm duyệt." : "AI hỗ trợ rà soát; quản trị viên là người quyết định xuất bản."}</p></div>{canSubmit && <button className="button button-primary" disabled={submitMutation.isPending || structureMutation.isPending || saveMutation.isPending || chaptersMutation.isPending || unsaved} onClick={() => submitMutation.mutate()} type="button">{submitMutation.isPending ? "Đang gửi…" : "Gửi kiểm duyệt"}</button>}</section>
    {story.source === "epub" && canEdit && <section className="manual-form-section" id="story-content"><div className="section-heading"><div><h2>Mục lục EPUB · {detail.preview.volumes.reduce((total, volume) => total + volume.chapters.length, 0)} chương</h2></div><button className="button button-secondary" disabled={!epubStructureDirty || structureMutation.isPending} onClick={() => structureMutation.mutate()} type="button">{structureMutation.isPending ? "Đang lưu…" : "Lưu mục lục"}</button></div><p className="field-hint">Bạn có thể sửa tên và thứ tự. Nội dung chương, bìa, ảnh và thông tin truyện vẫn lấy từ EPUB.</p><EpubStructureEditor disabled={structureMutation.isPending} onChange={setEpubVolumes} volumes={epubVolumes} /></section>}
    {story.source === "manual" && canEdit && story.moderationStatus !== "published" && !story.hasPublishedUpdates ? <section className="manual-form-section" id="story-content"><div className="section-heading"><div><h2>Nội dung chương · {chapters.length} chương</h2></div><button className="button button-secondary" onClick={() => setChapters([...chapters, { title: "Chương " + (chapters.length + 1), content: "" }])} type="button">+ Thêm chương</button></div>
      <ChapterEditor chapters={chapters} disabled={chaptersMutation.isPending} onChange={setChapters} />
      <div className="manual-submit-row"><p>Số chương được tính tự động.</p><button className="button button-secondary" disabled={chaptersMutation.isPending || chapters.some((chapter) => !chapter.title.trim() || !chapter.content.trim())} onClick={() => chaptersMutation.mutate()} type="button">{chaptersMutation.isPending ? "Đang lưu chương…" : "Lưu nội dung chương"}</button></div>
    </section> : <section className="chapter-preview" id={story.source === "epub" && canEdit ? "story-preview" : "story-content"}><div className="section-heading"><div><h2>Xem nội dung · {singleVolume ? "" : detail.preview.volumes.length + " tập · "}{detail.preview.volumes.reduce((total, volume) => total + volume.chapters.length, 0)} chương</h2></div></div>
      {detail.preview.volumes.map((volume) => <section className="volume-group" key={volume.id}>{!singleVolume && <h3>{volume.title}</h3>}{volume.chapters.map((chapter, index) => <ChapterPreview chapter={{ ...chapter, volumeTitle: singleVolume ? null : volume.title }} index={index} key={chapter.id} />)}</section>)}
    </section>}
  </div>;
}
const reportStatuses: Record<ReportStatus, string> = {
  open: "Chờ xử lý", resolved: "Đã xử lý", dismissed: "Đã bỏ qua",
};
const reportTargets: Record<AdminReport["targetType"], string> = {
  story: "Truyện", comment: "Bình luận", review: "Đánh giá",
};
const reportActions: Record<AdminReport["targetType"], { value: ReportAction; label: string; confirmation: string }> = {
  story: { value: "hide_story", label: "Ẩn truyện khỏi ứng dụng", confirmation: "Ẩn truyện này khỏi danh mục ứng dụng và đánh dấu báo cáo đã xử lý?" },
  comment: { value: "delete_comment", label: "Xóa bình luận", confirmation: "Xóa bình luận này và đánh dấu báo cáo đã xử lý?" },
  review: { value: "delete_review", label: "Xóa đánh giá", confirmation: "Xóa đánh giá này và đánh dấu báo cáo đã xử lý? Điểm trung bình của truyện sẽ được cập nhật." },
};
function ReportCard({ report, busy, onDecision }: {
  report: AdminReport; busy: boolean;
  onDecision: (id: string, status: "resolved" | "dismissed", action: ReportAction) => void;
}) {
  const confirm = useConfirm();
  const [action, setAction] = useState<ReportAction>("none");
  const targetAction = reportActions[report.targetType];
  const effectiveAction = report.targetAvailable ? action : "none";
  async function resolve() {
    if (effectiveAction !== "none" && !await confirm({ title: targetAction.label, subject: report.targetTitle || `Báo cáo #${report.id}`, description: targetAction.confirmation, confirmLabel: targetAction.label, danger: action !== "hide_story" })) return;
    onDecision(report.id, "resolved", effectiveAction);
  }
  return <article className="report-card">
    <div className="report-heading"><div><p className="report-kind">{reportTargets[report.targetType]} · #{report.targetId}</p><h2>{report.targetTitle || "Nội dung không còn tồn tại"}</h2></div><span className={"status-badge " + (report.status === "open" ? "status-warning" : "status-ok")}>{reportStatuses[report.status]}</span></div>
    <p className="report-meta">Người báo cáo: <strong>{report.reporterName || "Tài khoản đã xóa"}</strong> · {formatDate(report.createdAt)}</p>
    {report.targetContent && <section className="report-target"><h3>Nội dung được báo cáo</h3><p>{report.targetContent}</p></section>}
    {!report.targetAvailable && <p className="field-hint">Nội dung đã bị xóa hoặc không còn tồn tại. Bạn vẫn có thể hoàn tất việc xử lý báo cáo.</p>}
    <section className="report-reason"><h3>Lý do báo cáo</h3><p>{report.reason}</p></section>
    {report.status === "open" && <div className="report-controls"><label>Hành động xử lý<select aria-label={"Hành động cho báo cáo " + report.id} disabled={busy} value={effectiveAction} onChange={(event) => setAction(event.target.value as ReportAction)}><option value="none">Chỉ đánh dấu đã xử lý</option>{report.targetAvailable && <option value={targetAction.value}>{targetAction.label}</option>}</select></label><div className="decision-actions"><button className="button button-primary" disabled={busy} onClick={resolve} type="button">Xử lý báo cáo</button><button className="button button-quiet" disabled={busy} onClick={() => onDecision(report.id, "dismissed", "none")} type="button">Bỏ qua báo cáo</button></div></div>}
  </article>;
}
function ReportsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState<ReportStatus>("open");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["admin", "reports", status, page], queryFn: () => fetchAdminReports(status, page), retry: false });
  const mutation = useMutation({
    mutationFn: ({ id, nextStatus, action }: { id: string; nextStatus: "resolved" | "dismissed"; action: ReportAction }) => decideReport(id, nextStatus, action),
    onSuccess: async (_, decision) => {
      setNotice(decision.nextStatus === "dismissed" ? "Đã bỏ qua báo cáo." : "Đã xử lý báo cáo.");
      await client.invalidateQueries({ queryKey: ["admin", "reports"] });
      await client.invalidateQueries({ queryKey: ["contributor"] });
      if (decision.action === "hide_story") await client.invalidateQueries({ queryKey: ["admin", "story-count"] });
    },
  });
  const total = query.data?.pagination.total ?? 0;
  const limit = query.data?.pagination.limit ?? 10;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  useEffect(() => { if (query.data && page > pageCount) setPage(pageCount); }, [page, pageCount, query.data]);
  function decide(id: string, nextStatus: "resolved" | "dismissed", action: ReportAction) {
    if (mutation.isPending) return;
    setNotice(""); mutation.mutate({ id, nextStatus, action });
  }
  return <div className="page-stack reports-page"><WorkspaceHeading title="Báo cáo của độc giả" description="Xem lý do báo cáo, kiểm tra nội dung và chọn cách xử lý phù hợp." />
    <div className="reports-toolbar"><label>Trạng thái<select aria-label="Lọc trạng thái báo cáo" disabled={mutation.isPending} value={status} onChange={(event) => { setStatus(event.target.value as ReportStatus); setPage(1); setNotice(""); mutation.reset(); }}><option value="open">Chờ xử lý</option><option value="resolved">Đã xử lý</option><option value="dismissed">Đã bỏ qua</option></select></label>{query.data && <span>{total} báo cáo · {limit} mục mỗi trang</span>}</div>
    {notice && <div className="success-panel" role="status">{notice}</div>}
    {mutation.error && <ErrorBox error={mutation.error} />}
    {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
    {query.isPending ? <Loading text="Đang tải báo cáo…" /> : !query.isError && (query.data?.reports.length ? <><div className="reports-list">{query.data.reports.map((report) => <ReportCard key={report.id} report={report} busy={mutation.isPending || query.isFetching} onDecision={decide} />)}</div><nav className="reports-pagination" aria-label="Phân trang báo cáo"><button className="button button-quiet" disabled={page <= 1 || mutation.isPending || query.isFetching} onClick={() => setPage(page - 1)} type="button">Trang trước</button><span>Trang {page} / {pageCount}</span><button className="button button-quiet" disabled={page >= pageCount || mutation.isPending || query.isFetching} onClick={() => setPage(page + 1)} type="button">Trang sau</button></nav></> : <Message title="Chưa có báo cáo" body={"Không có báo cáo ở trạng thái “" + reportStatuses[status] + "”."} />)}
  </div>;
}
function AccountPage({ user, onLogout, loggingOut }: { user: ReadLiteUser; onLogout: () => void; loggingOut: boolean }) {
  return <div className="page-stack profile-page"><WorkspaceHeading title="Tài khoản của bạn" description="Thông tin tài khoản và quyền truy cập bảng điều khiển ReadLite." />
    <section className="profile-overview"><span className="avatar avatar-large">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span><div><h2>{user.displayName || user.username}</h2><p>@{user.username}</p><span className="status-badge status-ok">{user.role === "admin" ? "Quản trị viên" : "Tác giả"}</span></div></section>
    <section className="profile-details"><h2>Thông tin tài khoản</h2><dl><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Tên đăng nhập</dt><dd>{user.username}</dd></div><div><dt>Xác minh email</dt><dd>{user.emailVerified ? "Đã xác minh" : "Chưa xác minh"}</dd></div><div><dt>Quyền quản lý</dt><dd>{user.role === "admin" ? "Kiểm duyệt, quản lý kho truyện, báo cáo và tài khoản." : "Tạo và chỉnh sửa bản thảo của mình, bổ sung chương và gửi duyệt."}</dd></div></dl><p className="field-hint">Bạn có thể sửa thông tin cá nhân trong mục Tài khoản → Sửa hồ sơ trên ứng dụng Android.</p></section>
    <section className="profile-actions"><div><h2>Phiên làm việc</h2><p>Đăng xuất khi đã hoàn tất, đặc biệt khi dùng máy tính chung.</p></div><button className="button button-secondary" disabled={loggingOut} onClick={onLogout} type="button"><AppIcon name="logout" />{loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}</button></section>
  </div>;
}

function ForbiddenPage() {
  return <Message title="Bạn chưa có quyền vào khu vực này" body="Đăng nhập bằng tài khoản quản trị viên hoặc tác giả được cấp quyền." action={<Link className="button button-secondary" to="/submissions">Quay lại bản thảo</Link>} />;
}
function WorkspaceApp() {
  const client = useQueryClient();
  const location = useLocation();
  const userQuery = useQuery({ queryKey: ["session", "current-user"], queryFn: fetchCurrentUser, retry: false, staleTime: 30_000 });
  const user = userQuery.data;
  const [sessionNotice, setSessionNotice] = useState("");
  useEffect(() => {
    function sessionEnded(event: Event) {
      const message = (event as CustomEvent<unknown>).detail;
      setSessionNotice(typeof message === "string" ? message : "Phiên đăng nhập đã kết thúc.");
      void client.cancelQueries();
      client.setQueryData(["session", "current-user"], null);
      client.removeQueries({ predicate: query => query.queryKey[0] !== "session" });
    }
    window.addEventListener("readlite:session-ended", sessionEnded);
    return () => window.removeEventListener("readlite:session-ended", sessionEnded);
  }, [client]);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem("readlite.admin-theme");
    return saved === "dark" ? "dark" : "light";
  });
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("readlite.admin-theme", theme); }, [theme]);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => { client.clear(); window.location.assign("/login"); },
  });
  if (userQuery.isPending) return <main className="session-loading"><Loading text="Đang xác thực phiên làm việc…" /></main>;
  if (!user && userQuery.isError && isApiUnavailable(userQuery.error)) {
    return <main className="session-loading"><Message title="API chưa hoạt động" body="Bảng điều khiển không thể kết nối API ở cổng 3000. Hãy khởi động API rồi thử lại." action={<button className="button button-primary" onClick={() => void userQuery.refetch()} type="button">Thử kết nối lại</button>} /></main>;
  }
  if (!user) {
    if (location.pathname !== "/login") return <Navigate replace to="/login" />;
    return <LoginPage notice={sessionNotice} onLogin={(loggedIn) => { setSessionNotice(""); client.setQueryData(["session", "current-user"], loggedIn); }} />;
  }
  if (location.pathname === "/login") return <Navigate replace to={user.role === "author" ? "/submissions" : "/"} />;
  if (user.role !== "admin" && user.role !== "author") return <main className="session-loading"><Message title="Bạn chưa có quyền vào khu vực này" body="Đăng nhập bằng tài khoản quản trị viên hoặc tác giả được cấp quyền." action={<button className="button button-secondary" disabled={logoutMutation.isPending} onClick={() => logoutMutation.mutate()} type="button">Đăng xuất</button>} />{logoutMutation.error && <ErrorBox error={logoutMutation.error} />}</main>;
  const logoutError = logoutMutation.error instanceof Error ? logoutMutation.error.message : undefined;
  return <Shell user={user} theme={theme} toggleTheme={() => setTheme(theme === "light" ? "dark" : "light")} onLogout={() => logoutMutation.mutate()} logoutError={logoutError} loggingOut={logoutMutation.isPending}>
    <Routes>
      <Route path="/library" element={<Navigate replace to={user.role === "admin" ? "/" : "/submissions"} />} />
      <Route path="/" element={user.role === "admin" ? <Dashboard /> : <Navigate replace to="/submissions" />} />
      <Route path="/reviews" element={user.role === "admin" ? <StoryReviewQueue /> : <ForbiddenPage />} />
      <Route path="/reviews/:storyId" element={user.role === "admin" ? <ReviewDetailPage /> : <ForbiddenPage />} />
      <Route path="/chapter-updates" element={user.role === "admin" ? <ContentUpdateQueue /> : <ForbiddenPage />} />
      <Route path="/content-updates/:updateId" element={<ContentUpdateDetailPage user={user} />} />
      <Route path="/submissions/:storyId/updates/new" element={<NewContentUpdate />} />
      <Route path="/reports" element={user.role === "admin" ? <ReportsPage /> : <ForbiddenPage />} />
      <Route path="/users" element={user.role === "admin" ? <ManagedUsers currentUser={user} /> : <ForbiddenPage />} />
      <Route path="/submissions" element={<SubmissionsPage user={user} />} />
      <Route path="/submissions/new" element={<ManualStoryPage />} />
      <Route path="/submissions/:storyId" element={<SubmissionDetailPage user={user} />} />
      <Route path="/account" element={<AccountPage user={user} onLogout={() => logoutMutation.mutate()} loggingOut={logoutMutation.isPending} />} />
      <Route path="*" element={<Message title="Không tìm thấy trang" body="Đường dẫn này không có trong bảng điều khiển ReadLite." action={<Link className="button button-primary" to="/">Về tổng quan</Link>} />} />
    </Routes>
  </Shell>;
}

export default function App() { return <ConfirmationProvider><WorkspaceApp /></ConfirmationProvider>; }
