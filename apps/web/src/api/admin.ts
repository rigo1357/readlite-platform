export type ReadLiteUser = {
  id: string; email: string; username: string; displayName: string;
  role: "admin" | "author" | "user"; emailVerified: boolean;
};
export type ManagedUser = {
  id: string; email: string; username: string; displayName: string;
  role: "user" | "author" | "admin"; isActive: boolean; emailVerified: boolean;
  statusVersion?: number; statusReason?: string | null; statusChangedAt?: string | null;
};
export type ManagedUsersPage = { users: ManagedUser[]; pagination: { page: number; limit: number; total: number } };
export type AccountStatusEvent = { id: string; actorId: string | null; actorName: string | null;
  previousActive: boolean; newActive: boolean; reason: string; createdAt: string };
export type AccountStatusHistory = { user: ManagedUser; events: AccountStatusEvent[]; pagination: { page: number; limit: number; total: number } };
export type ReportStatus = "open" | "resolved" | "dismissed";
export type AdminReport = {
  id: string; reporterName: string; targetType: "story" | "comment" | "review";
  targetId: string; reason: string; status: ReportStatus; createdAt: string;
  targetTitle: string | null; targetContent: string | null; targetAvailable: boolean;
};
export type AdminReportsPage = {
  reports: AdminReport[]; pagination: { page: number; limit: number; total: number };
};
export type ReportAction = "none" | "hide_story" | "delete_comment" | "delete_review";
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message); this.name = "ApiError";
  }
}
export function isApiUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (
    error.status === 0 || [502, 503, 504].includes(error.status)
  );
}
export type ReviewSubmission = {
  id: string; title: string; author: string | null; summary: string | null;
  language: string | null; publicationDate: string | null;
  aiReviewStatus: string; aiReviewWarnings: unknown;
  totalChapters: number; submittedByName: string | null; submittedBy: string | null; createdAt: string;
};
export type ReviewStory = ReviewSubmission & {
  coverUrl: string | null; coverMediaId: string | null; moderationStatus: string;
};
export type ContentBlock =
  | { type: "text"; kind: string; runs: Array<{ text: string; bold?: boolean; italic?: boolean }> }
  | { type: "image"; mediaId: string; altText?: string; caption?: string | null };
export type ReviewChapter = {
  id: string; title: string; chapterOrder: number; volumeTitle: string | null;
  content?: string | null; blocks?: ContentBlock[];
};
export type ReviewDetail = { story: ReviewStory; chapters: ReviewChapter[] };
export type ContributorStory = {
  id: string; title: string; author: string | null; summary: string | null; language: string | null;
  moderationStatus: string; aiReviewStatus: string | null; aiReviewWarnings: unknown;
  coverUrl: string | null; source: "manual" | "epub"; publicationDate: string | null;
  totalChapters: number; createdAt: string; updatedAt: string;
  lifecycleStatus?: StoryLifecycleStatus; lifecycleVersion?: number;
};
export type StoryLifecycleStatus = "ongoing" | "completed" | "paused";
export type StoryLifecycle = { storyId: string; status: StoryLifecycleStatus; version: number; note: string; changedAt: string | null };
export type StoryLifecyclePage = { lifecycle: StoryLifecycle; events: Array<{ id: string; actorId: string | null; actorName: string; previousStatus: StoryLifecycleStatus; newStatus: StoryLifecycleStatus; note: string; createdAt: string }>; pagination: { page: number; limit: number; total: number } };
export function fetchStoryLifecycle(storyId: string, page = 1): Promise<StoryLifecyclePage> {
  return request(`/api/v1/author/stories/${encodeURIComponent(storyId)}/lifecycle?page=${page}`);
}
export function saveStoryLifecycle(storyId: string, status: StoryLifecycleStatus, expectedVersion: number, note: string): Promise<{ changed: boolean; lifecycle: StoryLifecycle }> {
  return request(`/api/v1/author/stories/${encodeURIComponent(storyId)}/lifecycle`, {
    method: "PATCH", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedVersion, note }),
  });
}
export type ContributorDetail = {
  story: ContributorStory & { coverMediaId: string | null; genreIds: string[]; hasPublishedUpdates?: boolean };
  preview: { volumes: Array<{ id: string; title: string; order: number; chapters: Array<ReviewChapter & { order: number }> }> };
};
export type GenreOption = { id: string; name: string; slug: string };
export type ManualChapterInput = { title: string; content: string };
export type ManualStoryInput = {
  title: string; author: string; summary: string; language: string;
  publicationDate: string | null; genreIds: string[]; volumeTitle: string;
  chapters: ManualChapterInput[];
};

const csrfKey = "readlite.admin.csrf";
function csrf(): string | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(csrfKey);
}
function saveCsrf(value: string | null): void {
  if (typeof sessionStorage === "undefined") return;
  if (value) sessionStorage.setItem(csrfKey, value);
  else sessionStorage.removeItem(csrfKey);
}
function csrfHeaders(): HeadersInit {
  const value = csrf();
  return value ? { "x-csrf-token": value } : {};
}
function sessionEnded(message: string): void {
  saveCsrf(null);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("readlite:session-ended", { detail: message }));
}
async function parse<T>(response: Response, path: string, hadSession: boolean): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error : undefined;
    if ([401, 403].includes(response.status) && (error?.code === "ACCOUNT_SUSPENDED" || error?.code === "SESSION_REVOKED")) {
      sessionEnded(typeof error.message === "string" ? error.message : "Phiên đăng nhập đã kết thúc.");
    } else if (response.status === 401 && path !== "/api/v1/auth/login" && hadSession) {
      // An image request can clear HTTP cookies before a JSON request observes the suspension.
      sessionEnded("Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.");
    }
    throw new ApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error?.message === "string" ? error.message
        : [502, 503, 504].includes(response.status)
          ? "Máy chủ API không phản hồi. Hãy kiểm tra API ở cổng 3000."
          : "Không thể hoàn tất yêu cầu.",
    );
  }
  return payload as T;
}
let csrfSyncPending: Promise<boolean> | null = null;
async function syncCsrf(): Promise<boolean> {
  if (csrfSyncPending) return csrfSyncPending;
  const operation = (async () => {
    const response = await fetch("/api/v1/auth/csrf", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) { saveCsrf(null); return false; }
    const payload = await response.json().catch(() => null) as { csrfToken?: unknown } | null;
    if (typeof payload?.csrfToken !== "string") { saveCsrf(null); return false; }
    saveCsrf(payload.csrfToken);
    return true;
  })();
  csrfSyncPending = operation;
  try { return await operation; }
  finally { csrfSyncPending = null; }
}
let refreshPending: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (refreshPending) return refreshPending;
  const operation = (async () => {
    if (!await syncCsrf()) return false;
    const token = csrf();
    if (!token) return false;
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST", credentials: "same-origin",
      headers: { Accept: "application/json", "x-csrf-token": token },
    }).catch(() => null);
    if (!response?.ok) { saveCsrf(null); return false; }
    const payload = await response.json().catch(() => null) as { csrfToken?: unknown } | null;
    if (typeof payload?.csrfToken !== "string") { saveCsrf(null); return false; }
    saveCsrf(payload.csrfToken);
    return true;
  })();
  refreshPending = operation;
  try { return await operation; }
  finally { refreshPending = null; }
}
async function request<T>(
  path: string, init: RequestInit = {}, retryAuth = true, retryCsrf = true,
): Promise<T> {
  const hadSession = Boolean(csrf());
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" })
    .catch(() => { throw new ApiError(0, "NETWORK_ERROR", "Không kết nối được với máy chủ API."); });
  if (
    response.status === 401 && retryAuth &&
    path !== "/api/v1/auth/login" && path !== "/api/v1/auth/refresh" &&
    await refresh()
  ) {
    const refreshedHeaders = new Headers(init.headers);
    if (refreshedHeaders.has('x-csrf-token') && csrf()) refreshedHeaders.set('x-csrf-token', csrf()!);
    return request<T>(path, { ...init, headers: refreshedHeaders }, false, retryCsrf);
  }
  if (response.status === 403 && retryCsrf) {
    const payload = await response.clone().json().catch(() => null) as { error?: { code?: unknown } } | null;
    if (payload?.error?.code === "CSRF_INVALID" && await syncCsrf()) {
      const refreshedHeaders = new Headers(init.headers);
      refreshedHeaders.set("x-csrf-token", csrf()!);
      return request<T>(path, { ...init, headers: refreshedHeaders }, retryAuth, false);
    }
  }
  return parse<T>(response, path, hadSession);
}
export async function login(email: string, password: string): Promise<ReadLiteUser> {
  const result = await request<{ user: ReadLiteUser; csrfToken: string }>(
    "/api/v1/auth/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) },
    false,
  );
  saveCsrf(result.csrfToken);
  return result.user;
}
export async function logout(): Promise<void> {
  await request<void>("/api/v1/auth/logout", { method: "POST", headers: csrfHeaders() }, false);
  saveCsrf(null);
}
export async function fetchCurrentUser(): Promise<ReadLiteUser> {
  return (await request<{ user: ReadLiteUser }>("/api/v1/auth/me")).user;
}
export async function fetchAdminQueue(): Promise<ReviewSubmission[]> {
  return (await request<{ submissions: ReviewSubmission[] }>("/api/v1/admin/story-submissions")).submissions;
}
export async function fetchManagedUsers(search: string): Promise<ManagedUser[]> {
  return (await request<{ users: ManagedUser[] }>(
    "/api/v1/admin/users?search=" + encodeURIComponent(search),
  )).users;
}
export function fetchManagedUsersPage(search: string, status: "all" | "active" | "blocked", page: number): Promise<ManagedUsersPage> {
  return request(`/api/v1/admin/users?search=${encodeURIComponent(search)}&status=${status}&page=${page}`);
}
export function fetchAccountStatusHistory(id: string, page: number): Promise<AccountStatusHistory> {
  return request(`/api/v1/admin/users/${encodeURIComponent(id)}/status-history?page=${page}`);
}
export async function changeAccountStatus(id: string, isActive: boolean, reason: string, expectedStatusVersion: number): Promise<{ user: ManagedUser; changed: boolean }> {
  return request(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, {
    method: "PATCH", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ isActive, reason, expectedStatusVersion }),
  });
}
export async function fetchAdminReports(status: ReportStatus, page: number): Promise<AdminReportsPage> {
  return request<AdminReportsPage>("/api/v1/admin/reports?status=" + status + "&page=" + page);
}
export async function decideReport(
  id: string, status: "resolved" | "dismissed", action: ReportAction = "none",
): Promise<void> {
  await request("/api/v1/admin/reports/" + encodeURIComponent(id), {
    method: "PATCH", headers: { ...csrfHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ status, action }),
  });
}
export async function changeUserRole(id: string, role: ManagedUser["role"]): Promise<ManagedUser> {
  return (await request<{ user: ManagedUser }>(
    "/api/v1/admin/users/" + encodeURIComponent(id) + "/role",
    { method: "PATCH", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ role }) },
  )).user;
}
export async function fetchReviewDetail(id: string): Promise<ReviewDetail> {
  return request<ReviewDetail>("/api/v1/admin/story-submissions/" + encodeURIComponent(id));
}
export async function decideReview(
  id: string, decision: "approve" | "reject" | "changes_requested", reason?: string,
): Promise<void> {
  await request(
    "/api/v1/admin/story-submissions/" + encodeURIComponent(id) + "/decision",
    { method: "POST", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) },
  );
}
export async function fetchContributorStories(): Promise<ContributorStory[]> {
  return (await request<{ stories: ContributorStory[] }>("/api/v1/author/stories")).stories;
}
export async function fetchGenres(): Promise<GenreOption[]> {
  return (await request<{ genres: GenreOption[] }>("/api/v1/genres")).genres;
}
export async function fetchContributorDetail(id: string): Promise<ContributorDetail> {
  return request<ContributorDetail>("/api/v1/author/stories/" + encodeURIComponent(id));
}
export async function createManualStory(input: ManualStoryInput): Promise<{ story: { id: string; title: string } }> {
  return request("/api/v1/author/stories/manual", {
    method: "POST", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
export async function saveManualChapters(
  id: string, input: { volumeTitle: string; chapters: ManualChapterInput[] },
): Promise<void> {
  await request("/api/v1/author/stories/" + encodeURIComponent(id) + "/chapters", {
    method: "PUT", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
export async function saveEpubStructure(
  id: string,
  input: { volumes: Array<{ id: string; title: string; chapters: Array<{ id: string; title: string }> }> },
): Promise<void> {
  await request("/api/v1/author/stories/" + encodeURIComponent(id) + "/structure", {
    method: "PUT", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
export async function importEpub(file: File): Promise<{ story: { id: string; title: string } }> {
  const form = new FormData(); form.append("file", file);
  return request("/api/v1/author/stories/import-epub", { method: "POST", headers: csrfHeaders(), body: form });
}
export async function uploadCover(id: string, file: File): Promise<void> {
  const form = new FormData(); form.append("file", file);
  await request("/api/v1/author/stories/" + encodeURIComponent(id) + "/cover", { method: "POST", headers: csrfHeaders(), body: form });
}
export async function saveMetadata(
  id: string, metadata: {
    title: string; author: string; summary: string; language?: string;
    publicationDate?: string | null; genreIds?: string[];
  },
): Promise<void> {
  await request(
    "/api/v1/author/stories/" + encodeURIComponent(id),
    { method: "PATCH", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(metadata) },
  );
}
export async function submitStory(id: string): Promise<void> {
  await request(
    "/api/v1/author/stories/" + encodeURIComponent(id) + "/submit",
    { method: "POST", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: "{}" },
  );
}
export async function fetchPublicStoryCount(): Promise<number> {
  const result = await request<{ pagination: { total: number } }>("/api/v1/stories?limit=1");
  return result.pagination.total;
}
export function mediaUrl(id: string | null | undefined): string | null {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(id)
    ? "/api/v1/media/" + id : null;
}


export async function hideStory(id: string): Promise<void> {
  await request('/api/v1/admin/stories/' + encodeURIComponent(id) + '/hide', { method: 'POST', headers: csrfHeaders() });
}
export async function deleteStory(id: string): Promise<void> {
  await request('/api/v1/admin/stories/' + encodeURIComponent(id), { method: 'DELETE', headers: csrfHeaders() });
}
export function coverSource(story: { coverMediaId?: string | null; coverUrl?: string | null }): string | null {
  const local = mediaUrl(story.coverMediaId);
  if (local) return local;
  const value = story.coverUrl;
  if (!value) return null;
  if (/^\/api\/v1\/media\/[a-f0-9-]+$/i.test(value)) return value;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export async function repairStoryMedia(id: string): Promise<{ restoredChapters: number; coverRestored: boolean }> {
  return request('/api/v1/author/stories/' + encodeURIComponent(id) + '/repair-media', { method: 'POST', headers: csrfHeaders() });
}

export type ContentUpdate = {
  id: string; storyId: string; storyTitle: string; title: string; source: "manual" | "epub";
  status: "draft" | "pending" | "changes_requested" | "rejected" | "published" | "cancelled";
  targetVolumeId: string | null; reviewReason: string | null; warnings: string[];
  chapterCount: number; createdAt: string; submittedAt: string | null; reviewedAt: string | null;
};
export type ContentUpdateChapter = ReviewChapter & { volumeOrder: number; volumeTitle: string; wordCount: number; publishedChapterId?: string | null };
export type ContentUpdateDetail = { update: ContentUpdate; chapters: ContentUpdateChapter[] };
export type ContentUpdatePage = { updates: ContentUpdate[]; pagination: { page: number; limit: number; total: number } };
export type ManualUpdateInput = { title: string; targetVolumeId: string | null; volumeTitle: string; chapters: ManualChapterInput[] };
export function fetchContentUpdates(storyId: string, page = 1): Promise<ContentUpdatePage> {
  return request(`/api/v1/author/stories/${encodeURIComponent(storyId)}/updates?page=${page}`);
}
export function fetchContentUpdateQueue(page = 1): Promise<ContentUpdatePage> {
  return request(`/api/v1/admin/content-updates?page=${page}`);
}
export function fetchContentUpdate(id: string): Promise<ContentUpdateDetail> {
  return request(`/api/v1/author/content-updates/${encodeURIComponent(id)}`);
}
export function createContentUpdate(storyId: string, input: ManualUpdateInput): Promise<{ updateId: string }> {
  return request(`/api/v1/author/stories/${encodeURIComponent(storyId)}/updates`, {
    method: "POST", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
export function importContentUpdate(storyId: string, file: File): Promise<{ updateId: string }> {
  const form = new FormData(); form.append("file", file);
  return request(`/api/v1/author/stories/${encodeURIComponent(storyId)}/updates/import-epub`, { method: "POST", headers: csrfHeaders(), body: form });
}
export async function saveContentUpdate(id: string, input: ManualUpdateInput): Promise<void> {
  await request(`/api/v1/author/content-updates/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
export async function saveContentUpdateStructure(id: string, chapters: Array<{ id: string; title: string; volumeTitle: string }>): Promise<void> {
  await request(`/api/v1/author/content-updates/${encodeURIComponent(id)}/structure`, {
    method: "PUT", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ chapters }),
  });
}
export async function submitContentUpdate(id: string, action: "submit" | "cancel"): Promise<void> {
  await request(`/api/v1/author/content-updates/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: csrfHeaders() });
}
export async function decideContentUpdate(id: string, decision: "approve" | "changes_requested" | "reject", reason?: string): Promise<void> {
  await request(`/api/v1/admin/content-updates/${encodeURIComponent(id)}/decision`, {
    method: "POST", headers: { ...csrfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }),
  });
}
