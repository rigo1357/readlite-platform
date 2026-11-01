import { AppIcon, WorkspaceHeading, useConfirm } from "./WorkspaceUI";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, changeAccountStatus, changeUserRole, fetchAccountStatusHistory, fetchManagedUsersPage,
  type ManagedUser, type ReadLiteUser } from "./api/admin";

const roles: Record<ManagedUser["role"], string> = { user: "Người đọc", author: "Tác giả", admin: "Quản trị viên" };
function ErrorNotice({ error }: { error: unknown }) {
  return error ? <div className="error-panel" role="alert">{error instanceof Error ? error.message : "Không thể hoàn tất yêu cầu."}</div> : null;
}
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString("vi-VN") : ""; }
function Pagination({ page, total, limit, onChange, disabled = false }: { page: number; total: number; limit: number; onChange: (v: number) => void; disabled?: boolean }) {
  return total > limit || page > 1 ? <nav className="reports-pagination" aria-label="Phân trang tài khoản"><button type="button" className="button button-secondary" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>Trang trước</button><span>Trang {page} / {Math.max(1, Math.ceil(total / limit))}</span><button type="button" className="button button-secondary" disabled={disabled || page * limit >= total} onClick={() => onChange(page + 1)}>Trang sau</button></nav> : null;
}
function Modal({ children, onClose, busy, title }: { children: ReactNode; onClose: () => void; busy: boolean; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog className="account-management-dialog" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="section-heading"><h2>{title}</h2><button className="button button-quiet" type="button" disabled={busy} aria-label="Đóng hộp thoại" onClick={onClose}><AppIcon name="close" /></button></div>{children}
  </dialog>;
}
export function StatusDialog({ account, onClose, onSaved }: { account: ManagedUser; onClose: () => void; onSaved: (message: string) => void }) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [outdated, setOutdated] = useState(false);
  const active = !account.isActive;
  const action = active ? "Mở khóa" : "Khóa tài khoản";
  const mutation = useMutation({ mutationFn: () => changeAccountStatus(account.id, active, reason.trim(), account.statusVersion ?? 0),
    onSuccess: result => onSaved(result.changed ? `${active ? "Đã mở khóa" : "Đã khóa"} tài khoản ${account.email}.` : "Tài khoản đã ở trạng thái được yêu cầu."),
    onError: error => { if (error instanceof ApiError && error.code === "ACCOUNT_STATUS_CHANGED") { setOutdated(true); void client.invalidateQueries({ queryKey: ["admin", "users"] }); } },
  });
  return <Modal title={action} busy={mutation.isPending} onClose={onClose}><form className="account-status-form" onSubmit={event => { event.preventDefault(); if (reason.trim() && !outdated) mutation.mutate(); }}>
    <p><strong>{account.displayName || account.username}</strong><br />{account.email}</p>
    <p>{active ? "Tài khoản được sử dụng trở lại và cần đăng nhập mới. Các phiên đã thu hồi vẫn bị vô hiệu." : "Tài khoản sẽ bị chặn sử dụng các chức năng cần đăng nhập và các phiên hiện có sẽ được thu hồi."}</p>
    <label>Lý do {active ? "mở khóa" : "khóa"}<textarea autoFocus required maxLength={2000} rows={4} value={reason} disabled={mutation.isPending || outdated} onChange={event => setReason(event.target.value)} placeholder={active ? "Ví dụ: đã xác minh và xử lý vi phạm" : "Nêu rõ hành vi vi phạm cần xử lý"} /></label>
    <p className="field-hint">Lý do bắt buộc, tối đa 2000 ký tự; được lưu cùng người thực hiện và thời điểm.</p><ErrorNotice error={mutation.error} />
    {outdated && <p role="status">Đóng hộp thoại rồi mở lại tài khoản để xem trạng thái mới nhất.</p>}
    <div className="decision-actions"><button className="button button-secondary" type="button" disabled={mutation.isPending} onClick={onClose}>Hủy</button><button className={active ? "button button-primary" : "button button-danger"} type="submit" disabled={mutation.isPending || outdated || !reason.trim()}>{mutation.isPending ? "Đang xử lý…" : `Xác nhận ${active ? "mở khóa" : "khóa"}`}</button></div>
  </form></Modal>;
}
export function HistoryDialog({ account, onClose }: { account: ManagedUser; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["admin", "user-status-history", account.id, page], queryFn: () => fetchAccountStatusHistory(account.id, page), retry: false });
  return <Modal title="Lịch sử khóa / mở khóa" busy={false} onClose={onClose}><p>{account.displayName || account.username} · {account.email}</p>
    {query.isPending && <p role="status">Đang tải lịch sử…</p>}<ErrorNotice error={query.error} />
    {query.data && <><p>Hiện tại: <strong>{query.data.user.isActive ? "Đang hoạt động" : "Đã khóa"}</strong></p>
      {query.data.events.length ? <ol className="account-status-history">{query.data.events.map(event => <li key={event.id}><div><strong>{event.newActive ? "Mở khóa tài khoản" : "Khóa tài khoản"}</strong><time>{date(event.createdAt)}</time></div><p className="account-status-reason">{event.reason}</p><small>Người thực hiện: {event.actorName || "Tài khoản quản trị đã xóa"}{event.actorId && <span> · {event.actorId}</span>}</small></li>)}</ol> : <p>Chưa có lịch sử khóa/mở khóa từ chức năng quản trị.</p>}
      <Pagination page={page} total={query.data.pagination.total} limit={query.data.pagination.limit} onChange={setPage} disabled={query.isFetching} />
    </>}
  </Modal>;
}

export function ManagedUsers({ currentUser }: { currentUser: ReadLiteUser }) {
  const confirm = useConfirm();
  const client = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "blocked">("all");
  const [page, setPage] = useState(1);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, ManagedUser["role"]>>({});
  const [feedback, setFeedback] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<ManagedUser | null>(null);
  const [history, setHistory] = useState<ManagedUser | null>(null);
  const query = useQuery({ queryKey: ["admin", "users", search, status, page], queryFn: () => fetchManagedUsersPage(search, status, page), retry: false });
  const roleMutation = useMutation({ mutationFn: ({ id, role }: { id: string; role: ManagedUser["role"] }) => changeUserRole(id, role),
    onSuccess: async account => { setFeedback(`Đã đổi quyền của ${account.email} thành ${roles[account.role]}.`); setSelectedRoles(current => { const next = { ...current }; delete next[account.id]; return next; }); await client.invalidateQueries({ queryKey: ["admin", "users"] }); },
  });
  async function statusSaved(message: string) { setSelectedAccount(null); setFeedback(message); setPage(1); await client.invalidateQueries({ queryKey: ["admin", "users"] }); await client.invalidateQueries({ queryKey: ["admin", "user-status-history"] }); }
  return <div className="page-stack accounts-page"><WorkspaceHeading title="Quản lý tài khoản" description="Tìm tài khoản, phân quyền và quản lý trạng thái hoạt động. Các lần khóa/mở khóa đều có lý do và lịch sử." /><section className="account-policy-note"><AppIcon name="info" /><p>Chỉ đổi vai trò cho tài khoản đang hoạt động và đã xác minh email. Bạn không thể khóa hoặc tự thay đổi quyền của chính mình.</p></section>
    <form className="user-search account-search" onSubmit={event => { event.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}><label className="account-search-input">Tìm theo tài khoản<input aria-label="Tìm tài khoản" maxLength={100} placeholder="Email, tên đăng nhập hoặc tên hiển thị" value={searchInput} onChange={event => setSearchInput(event.target.value)} /></label><label>Trạng thái<select aria-label="Lọc trạng thái tài khoản" value={status} onChange={event => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">Tất cả</option><option value="active">Đang hoạt động</option><option value="blocked">Đã khóa</option></select></label><button className="button button-secondary" type="submit">Tìm tài khoản</button><button className="button button-quiet" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Tải lại</button></form>
    <ErrorNotice error={query.error} />{query.isError && <button className="button button-secondary" type="button" onClick={() => void query.refetch()}>Thử lại</button>}<ErrorNotice error={roleMutation.error} />{feedback && <div className="success-panel" role="status">{feedback}</div>}
    {query.isPending ? <p role="status">Đang tải tài khoản…</p> : query.data && <><p>{query.data.pagination.total} tài khoản phù hợp</p><div className="managed-users">{query.data.users.map(account => {
      const selectedRole = selectedRoles[account.id] ?? account.role;
      const own = account.id === currentUser.id;
      const disabled = !account.isActive || !account.emailVerified || own;
      return <article className="managed-user account-management-card" key={account.id}><div className="managed-account-identity"><strong>{account.displayName || account.username}</strong><span className="account-email">{account.email}</span><small>@{account.username} · {roles[account.role]}</small><small>{account.emailVerified ? "Đã xác minh email" : "Chưa xác minh email"}{own ? " · Tài khoản của bạn" : ""}</small><span className={account.isActive ? "status-badge status-ok" : "status-badge status-warning"}>{account.isActive ? "Đang hoạt động" : "Đã khóa"}</span>{account.statusReason && <p className="account-status-reason">{account.isActive ? "Lý do mở khóa: " : "Lý do khóa: "}{account.statusReason}<small>{date(account.statusChangedAt)}</small></p>}</div>
        <div className="managed-account-actions"><label>Vai trò<select aria-label={`Vai trò của ${account.email}`} disabled={disabled || roleMutation.isPending} value={selectedRole} onChange={event => setSelectedRoles({ ...selectedRoles, [account.id]: event.target.value as ManagedUser["role"] })}><option value="user">Người đọc</option><option value="author">Tác giả</option><option value="admin">Quản trị viên</option></select></label><button className="button button-primary" type="button" disabled={disabled || roleMutation.isPending || selectedRole === account.role} onClick={async () => { if (await confirm({ title: "Xác nhận thay đổi vai trò", subject: account.email, description: `${roles[account.role]} → ${roles[selectedRole]}. Tài khoản sẽ được sử dụng các chức năng theo vai trò mới.`, confirmLabel: "Lưu quyền" })) roleMutation.mutate({ id: account.id, role: selectedRole }); }}>Lưu quyền</button>
          <button className={account.isActive ? "button button-danger" : "button button-secondary"} type="button" disabled={own || roleMutation.isPending} onClick={() => { setFeedback(""); setSelectedAccount(account); }}>{account.isActive ? "Khóa tài khoản" : "Mở khóa"}</button><button className="button button-quiet" type="button" onClick={() => setHistory(account)}>Lịch sử khóa/mở</button></div>
      </article>;
    })}</div>{!query.data.users.length && <section className="workspace-empty"><h2>Không tìm thấy tài khoản</h2><p>Hãy đổi bộ lọc hoặc tìm theo email, tên đăng nhập hay tên hiển thị.</p></section>}<Pagination page={page} total={query.data.pagination.total} limit={query.data.pagination.limit} onChange={setPage} disabled={query.isFetching} /></>}
    {selectedAccount && <StatusDialog account={selectedAccount} onClose={() => setSelectedAccount(null)} onSaved={message => void statusSaved(message)} />}
    {history && <HistoryDialog account={history} onClose={() => setHistory(null)} />}
  </div>;
}
