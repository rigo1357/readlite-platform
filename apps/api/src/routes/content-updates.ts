import { rm } from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { LocalMediaStorage } from '../media/local-media-storage.js';
import type { MediaStorage } from '../media/media-storage.js';
import { EpubParseError } from '../epub/epub-parser.js';
import { ContentUpdateError, importContentUpdate, insertUpdateChapters, lockPublishedStory,
  type UpdateDatabase, type UpdateQueryable } from '../services/content-update-import.js';
import { receiveEpubFile, StoryUploadError } from './story-submissions.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

const idSchema = z.string().regex(/^[1-9]\d{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
const manualSchema = z.object({
  title: z.string().trim().min(1).max(500),
  targetVolumeId: idSchema.nullable().default(null),
  volumeTitle: z.string().trim().min(1).max(500),
  chapters: z.array(z.object({ title: z.string().trim().min(1).max(500), content: z.string().trim().min(1).max(500000) }).strict()).min(1).max(100),
}).strict();
const decisionSchema = z.object({ decision: z.enum(['approve', 'reject', 'changes_requested']),
  reason: z.string().trim().max(2000).optional() }).strict().refine(v => v.decision === 'approve' || Boolean(v.reason));
const structureSchema = z.object({ chapters: z.array(z.object({
  id: idSchema, title: z.string().trim().min(1).max(500), volumeTitle: z.string().trim().min(1).max(500),
}).strict()).min(1).max(5000) }).strict();
type Actor = { id: string; role: string };
type Update = { id: string; storyId: string; status: string; source: string; targetVolumeId: string | null; title: string };
type PendingChapter = { id: string; chapterOrder: number; volumeOrder: number; volumeTitle: string; title: string; content: string; blocks: unknown[]; wordCount: number };
const fields = 'u.id::text, u.story_id::text AS "storyId", s.title AS "storyTitle", u.title, u.source, u.status, ' +
  'u.target_volume_id::text AS "targetVolumeId", u.submitted_by::text AS "submittedBy", u.review_reason AS "reviewReason", ' +
  'u.created_at AS "createdAt", u.submitted_at AS "submittedAt", u.reviewed_at AS "reviewedAt", u.warnings, ' +
  '(SELECT count(*)::int FROM story_update_chapters c WHERE c.update_id=u.id) AS "chapterCount"';
function fail(res: Response, status: number, code: string, message: string) { return res.status(status).json({ error: { code, message } }); }
function csrf(req: Request) { return csrfTokensMatch(req.cookies?.readlite_csrf, req.get('x-csrf-token')); }
function pageOf(req: Request) {
  const value = req.query.page ?? '1';
  return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null;
}
async function actor(req: Request, res: Response, db: UpdateQueryable, admin = false): Promise<Actor | null> {
  const userId = await readAccessUserId(req.cookies?.readlite_access);
  if (!userId) { fail(res, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập.'); return null; }
  const result = await db.query<Actor>('SELECT id::text, role FROM users WHERE id=$1 AND is_active=true AND email_verified_at IS NOT NULL', [userId]);
  const user = result.rows[0];
  if (!user) { fail(res, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập.'); return null; }
  if ((admin && user.role !== 'admin') || !['author', 'admin'].includes(user.role)) {
    fail(res, 403, 'FORBIDDEN', 'Tài khoản không có quyền thực hiện thao tác này.'); return null;
  }
  return user;
}
async function checkVolume(db: UpdateQueryable, storyId: string, volumeId: string | null) {
  if (volumeId && !(await db.query('SELECT id FROM volumes WHERE id=$1 AND story_id=$2 AND volume_order=(SELECT max(volume_order) FROM volumes WHERE story_id=$2)', [volumeId, storyId])).rows.length) {
    throw new ContentUpdateError(400, 'INVALID_VOLUME', 'Chỉ nối chương vào tập cuối hiện tại hoặc tạo tập mới. Nếu đã có tập mới được duyệt, hãy chọn lại tập cuối.');
  }
}
async function lockedUpdate(db: UpdateQueryable, id: string, user: Actor): Promise<Update> {
  // All write paths lock story before update/chapter rows, matching publication and follow writes.
  const story = await db.query<{ storyId: string }>('SELECT story_id::text AS "storyId" FROM story_content_updates WHERE id=$1', [id]);
  if (!story.rows[0]) throw new ContentUpdateError(404, 'NOT_FOUND', 'Không tìm thấy bản bổ sung.');
  const owned = await db.query('SELECT id FROM stories WHERE id=$1 AND (owner_id=$2 OR submitted_by=$2 OR $3::boolean) FOR UPDATE',
    [story.rows[0].storyId, user.id, user.role === 'admin']);
  if (!owned.rows.length) throw new ContentUpdateError(404, 'NOT_FOUND', 'Không tìm thấy bản bổ sung.');
  const result = await db.query<Update>('SELECT id::text,story_id::text AS "storyId",status,source,title,target_volume_id::text AS "targetVolumeId" FROM story_content_updates WHERE id=$1 FOR UPDATE', [id]);
  if (!result.rows[0]) throw new ContentUpdateError(404, 'NOT_FOUND', 'Không tìm thấy bản bổ sung.');
  return result.rows[0];
}
function editable(update: Update) {
  if (!['draft', 'changes_requested'].includes(update.status)) throw new ContentUpdateError(409, 'UPDATE_LOCKED', 'Chỉ sửa được bản nháp hoặc bản được yêu cầu chỉnh sửa.');
}

export function createContentUpdatesRouter(database: UpdateDatabase = pool, storage: MediaStorage = new LocalMediaStorage()): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => fail(res, 429, 'RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.') });
  router.use(['/author/stories/:storyId/updates', '/author/content-updates', '/admin/content-updates'], (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  router.get('/author/stories/:storyId/updates', async (req, res, next) => {
    try {
      const user = await actor(req, res, database); if (!user) return;
      if (!idSchema.safeParse(req.params.storyId).success || !pageOf(req)) return fail(res, 400, 'INVALID_REQUEST', 'Tham số không hợp lệ.');
      const storyId = req.params.storyId;
      const owned = await database.query('SELECT id FROM stories WHERE id=$1 AND (owner_id=$2 OR submitted_by=$2 OR $3::boolean)', [storyId, user.id, user.role === 'admin']);
      if (!owned.rows.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy truyện.');
      const page = pageOf(req)!;
      const total = await database.query<{ total: number }>('SELECT count(*)::int AS total FROM story_content_updates WHERE story_id=$1', [storyId]);
      const result = await database.query(`SELECT ${fields} FROM story_content_updates u JOIN stories s ON s.id=u.story_id WHERE u.story_id=$1 ORDER BY u.created_at DESC,u.id DESC LIMIT 20 OFFSET $2`, [storyId, (page - 1) * 20]);
      return res.json({ updates: result.rows, pagination: { page, limit: 20, total: total.rows[0]!.total } });
    } catch (error) { return next(error); }
  });
  router.get('/admin/content-updates', async (req, res, next) => {
    try {
      const user = await actor(req, res, database, true); if (!user) return;
      const page = pageOf(req); if (!page) return fail(res, 400, 'INVALID_REQUEST', 'Trang không hợp lệ.');
      const total = await database.query<{ total: number }>("SELECT count(*)::int AS total FROM story_content_updates WHERE status='pending'");
      const result = await database.query(`SELECT ${fields} FROM story_content_updates u JOIN stories s ON s.id=u.story_id WHERE u.status='pending' ORDER BY u.submitted_at,u.id LIMIT 20 OFFSET $1`, [(page - 1) * 20]);
      return res.json({ updates: result.rows, pagination: { page, limit: 20, total: total.rows[0]!.total } });
    } catch (error) { return next(error); }
  });
  router.get('/author/content-updates/:updateId', async (req, res, next) => {
    try {
      const user = await actor(req, res, database); if (!user) return;
      if (!idSchema.safeParse(req.params.updateId).success) return fail(res, 400, 'INVALID_REQUEST', 'Mã bản bổ sung không hợp lệ.');
      const result = await database.query(`SELECT ${fields} FROM story_content_updates u JOIN stories s ON s.id=u.story_id WHERE u.id=$1 AND (s.owner_id=$2 OR s.submitted_by=$2 OR $3::boolean)`, [req.params.updateId, user.id, user.role === 'admin']);
      if (!result.rows.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy bản bổ sung.');
      const chapters = await database.query('SELECT id::text,chapter_order AS "chapterOrder",volume_order AS "volumeOrder",volume_title AS "volumeTitle",title,content,content_blocks AS blocks,word_count AS "wordCount",published_chapter_id::text AS "publishedChapterId" FROM story_update_chapters WHERE update_id=$1 ORDER BY chapter_order', [req.params.updateId]);
      return res.json({ update: result.rows[0], chapters: chapters.rows });
    } catch (error) { return next(error); }
  });
  router.post('/author/stories/:storyId/updates', limiter, async (req, res, next) => {
    let client: Awaited<ReturnType<UpdateDatabase['connect']>> | undefined;
    try {
      const user = await actor(req, res, database); if (!user) return;
      if (!csrf(req)) return fail(res, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      const parsed = manualSchema.safeParse(req.body);
      if (!parsed.success || !idSchema.safeParse(req.params.storyId).success) return fail(res, 400, 'INVALID_REQUEST', 'Thông tin chương bổ sung không hợp lệ.');
      const storyId = String(req.params.storyId);
      client = await database.connect();
      await client.query('BEGIN');
      await lockPublishedStory(client, storyId, user.id, user.role === 'admin');
      await checkVolume(client, storyId, parsed.data.targetVolumeId);
      const result = await client.query<{ id: string }>("INSERT INTO story_content_updates(story_id,submitted_by,source,title,target_volume_id) VALUES($1,$2,'manual',$3,$4) RETURNING id::text",
        [storyId, user.id, parsed.data.title, parsed.data.targetVolumeId]);
      const id = result.rows[0]!.id;
      await insertUpdateChapters(client, id, parsed.data.chapters.map(c => ({ ...c, volumeOrder: 1, volumeTitle: parsed.data.volumeTitle, blocks: [], wordCount: c.content.split(/\s+/u).length })));
      await client.query('COMMIT'); return res.status(201).json({ updateId: id });
    } catch (error) { await client?.query('ROLLBACK').catch(() => undefined); return next(error); }
    finally { client?.release(); }
  });
  router.post('/author/stories/:storyId/updates/import-epub', limiter, async (req, res, next) => {
    try {
      const user = await actor(req, res, database); if (!user) return;
      if (!csrf(req)) return fail(res, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
      if (!idSchema.safeParse(req.params.storyId).success) return fail(res, 400, 'INVALID_REQUEST', 'Mã truyện không hợp lệ.');
      const storyId = String(req.params.storyId);
      // Do not receive or extract files from an unauthorized contributor.
      const owned = await database.query("SELECT id FROM stories WHERE id=$1 AND (owner_id=$2 OR submitted_by=$2 OR $3::boolean) AND visibility='public' AND moderation_status='published' AND lifecycle_status='ongoing'", [storyId, user.id, user.role === 'admin']);
      if (!owned.rows.length) return fail(res, 409, 'STORY_UNAVAILABLE', 'Truyện cần ở trạng thái Đang ra, đã xuất bản và bạn có quyền bổ sung chương.');
      const staged = await receiveEpubFile(req);
      try {
        const updateId = await importContentUpdate({ database, storage, epubPath: staged.path, storyId, userId: user.id, admin: user.role === 'admin' });
        return res.status(201).json({ updateId });
      } finally { await rm(staged.directory, { recursive: true, force: true }); }
    } catch (error) {
      if (error instanceof StoryUploadError) return fail(res, error.status, error.code, 'Tệp EPUB không hợp lệ; mỗi tệp tối đa 100 MiB.');
      if (error instanceof EpubParseError) return fail(res, 422, error.code, 'Không thể đọc tệp EPUB. Hãy kiểm tra cấu trúc tệp.');
      return next(error);
    }
  });

  // A single transactional handler shares the same story-first lock order for all update mutations.
  router.post('/author/content-updates/:updateId/:action', limiter, mutate(false));
  router.put('/author/content-updates/:updateId', limiter, mutate(false, 'edit'));
  router.put('/author/content-updates/:updateId/structure', limiter, mutate(false, 'structure'));
  router.post('/admin/content-updates/:updateId/decision', limiter, mutate(true, 'decision'));
  function mutate(admin: boolean, fixedAction?: string) {
    return async (req: Request, res: Response, next: (error?: unknown) => void) => {
      let client: Awaited<ReturnType<UpdateDatabase['connect']>> | undefined;
      try {
        const user = await actor(req, res, database, admin); if (!user) return;
        if (!csrf(req)) return fail(res, 403, 'CSRF_INVALID', 'Yêu cầu không hợp lệ.');
        if (!idSchema.safeParse(req.params.updateId).success) return fail(res, 400, 'INVALID_REQUEST', 'Mã bản bổ sung không hợp lệ.');
        const action = fixedAction ?? req.params.action;
        if (!['edit', 'structure', 'submit', 'cancel', 'decision'].includes(String(action))) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy thao tác.');
        client = await database.connect(); await client.query('BEGIN');
        const id = String(req.params.updateId);
        const update = await lockedUpdate(client, id, user);
        if (action === 'edit') {
          editable(update);
          if (update.source !== 'manual') throw new ContentUpdateError(409, 'EPUB_READ_ONLY', 'Bản EPUB chỉ chỉnh tên và thứ tự trong mục lục.');
          const parsed = manualSchema.safeParse(req.body);
          if (!parsed.success) throw new ContentUpdateError(400, 'INVALID_REQUEST', 'Thông tin chương chưa hợp lệ.');
          await checkVolume(client, update.storyId, parsed.data.targetVolumeId);
          await client.query('UPDATE story_content_updates SET title=$2,target_volume_id=$3 WHERE id=$1', [id, parsed.data.title, parsed.data.targetVolumeId]);
          await client.query('DELETE FROM story_update_chapters WHERE update_id=$1', [id]);
          await insertUpdateChapters(client, id, parsed.data.chapters.map(c => ({ ...c, volumeOrder: 1, volumeTitle: parsed.data.volumeTitle, blocks: [], wordCount: c.content.split(/\s+/u).length })));
        } else if (action === 'structure') {
          editable(update);
          if (update.source !== 'epub') throw new ContentUpdateError(409, 'INVALID_SOURCE', 'Mục lục này dành cho bản EPUB.');
          const parsed = structureSchema.safeParse(req.body);
          if (!parsed.success) throw new ContentUpdateError(400, 'INVALID_REQUEST', 'Mục lục không hợp lệ.');
          const current = await client.query<{ id: string; volumeOrder: number }>('SELECT id::text,volume_order AS "volumeOrder" FROM story_update_chapters WHERE update_id=$1 ORDER BY chapter_order', [id]);
          const ids = new Set(parsed.data.chapters.map(c => c.id));
          if (ids.size !== current.rows.length || parsed.data.chapters.length !== current.rows.length || current.rows.some(c => !ids.has(c.id))) throw new ContentUpdateError(400, 'INVALID_STRUCTURE', 'Phải giữ đầy đủ các chương EPUB.');
          // Preserve volume membership; chapters can be reordered within a volume only.
          const byId = new Map(current.rows.map(c => [c.id, c.volumeOrder]));
          const orders = parsed.data.chapters.map(c => byId.get(c.id)!);
          if (orders.some((v, i) => i > 0 && v < orders[i - 1]!)) throw new ContentUpdateError(400, 'INVALID_STRUCTURE', 'Chỉ chuyển chương trong cùng một tập.');
          const titles = new Map<number, string>();
          for (const chapter of parsed.data.chapters) {
            const volume = byId.get(chapter.id)!;
            if (titles.has(volume) && titles.get(volume) !== chapter.volumeTitle) throw new ContentUpdateError(400, 'INVALID_STRUCTURE', 'Tên tập phải thống nhất.');
            titles.set(volume, chapter.volumeTitle);
          }
          await client.query('UPDATE story_update_chapters SET chapter_order=chapter_order+10000 WHERE update_id=$1', [id]);
          for (const [index, c] of parsed.data.chapters.entries()) await client.query('UPDATE story_update_chapters SET title=$2,volume_title=$3,chapter_order=$4 WHERE id=$1 AND update_id=$5', [c.id, c.title, c.volumeTitle, index + 1, id]);
          await client.query('UPDATE story_content_updates SET updated_at=now() WHERE id=$1', [id]);
        } else if (action === 'cancel') {
          if (!['draft', 'changes_requested', 'pending'].includes(update.status)) throw new ContentUpdateError(409, 'UPDATE_LOCKED', 'Không thể hủy bản bổ sung này.');
          await client.query("UPDATE story_content_updates SET status='cancelled' WHERE id=$1", [id]);
        } else if (action === 'submit') {
          editable(update);
          await lockPublishedStory(client, update.storyId, user.id, user.role === 'admin');
          const count = await client.query('SELECT id FROM story_update_chapters WHERE update_id=$1 LIMIT 1', [id]);
          if (!count.rows.length) throw new ContentUpdateError(400, 'EMPTY_UPDATE', 'Cần ít nhất một chương.');
          await checkVolume(client, update.storyId, update.targetVolumeId);
          await client.query("UPDATE story_content_updates SET status='pending',submitted_at=now(),reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL WHERE id=$1", [id]);
        } else {
          const parsed = decisionSchema.safeParse(req.body);
          if (!parsed.success) throw new ContentUpdateError(400, 'INVALID_REQUEST', 'Chọn quyết định và nhập lý do khi yêu cầu sửa hoặc từ chối.');
          if (update.status !== 'pending') throw new ContentUpdateError(409, 'UPDATE_LOCKED', 'Bản bổ sung không còn chờ duyệt.');
          if (parsed.data.decision === 'approve') {
            await lockPublishedStory(client, update.storyId, user.id, true);
            await publish(client, update);
          }
          const status = parsed.data.decision === 'approve' ? 'published' : parsed.data.decision === 'reject' ? 'rejected' : 'changes_requested';
          await client.query('UPDATE story_content_updates SET status=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4 WHERE id=$1', [id, status, user.id, parsed.data.reason || null]);
        }
        await client.query('INSERT INTO story_review_events(story_id,actor_id,action,details) VALUES($1,$2,\'metadata_updated\',$3::jsonb)',
          [update.storyId, user.id, JSON.stringify({ contentUpdateId: id, action, ...(action === 'decision' ? req.body : {}) })]);
        await client.query('COMMIT'); return res.json({ updateId: id });
      } catch (error) { await client?.query('ROLLBACK').catch(() => undefined); return next(error); }
      finally { client?.release(); }
    };
  }
  router.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (error instanceof ContentUpdateError) { fail(res, error.status, error.code, error.message); return; }
    next(error);
  });
  return router;
}

async function publish(client: UpdateQueryable, update: Update) {
  await checkVolume(client, update.storyId, update.targetVolumeId);
  const result = await client.query<PendingChapter>('SELECT id::text,chapter_order AS "chapterOrder",volume_order AS "volumeOrder",volume_title AS "volumeTitle",title,content,content_blocks AS blocks,word_count AS "wordCount" FROM story_update_chapters WHERE update_id=$1 ORDER BY chapter_order', [update.id]);
  if (!result.rows.length) throw new ContentUpdateError(400, 'EMPTY_UPDATE', 'Bản bổ sung chưa có chương.');
  const max = await client.query<{ chapter: number; volume: number }>('SELECT (SELECT coalesce(max(chapter_order),0) FROM chapters WHERE story_id=$1) AS chapter,(SELECT coalesce(max(volume_order),0) FROM volumes WHERE story_id=$1) AS volume', [update.storyId]);
  let chapterOrder = max.rows[0]!.chapter;
  let volumeOrder = max.rows[0]!.volume;
  const volumes = new Map<number, string>();
  for (const chapter of result.rows) {
    let volumeId = update.targetVolumeId ?? volumes.get(chapter.volumeOrder);
    if (!volumeId) {
      const volume = await client.query<{ id: string }>('INSERT INTO volumes(story_id,volume_order,title) VALUES($1,$2,$3) RETURNING id::text', [update.storyId, ++volumeOrder, chapter.volumeTitle]);
      volumeId = volume.rows[0]!.id; volumes.set(chapter.volumeOrder, volumeId);
    }
    const inserted = await client.query<{ id: string }>('INSERT INTO chapters(story_id,volume_id,chapter_order,title,content,content_blocks,word_count) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id::text',
      [update.storyId, volumeId, ++chapterOrder, chapter.title, chapter.content, JSON.stringify(chapter.blocks), chapter.wordCount]);
    await client.query('UPDATE story_update_chapters SET published_chapter_id=$2 WHERE id=$1', [chapter.id, inserted.rows[0]!.id]);
  }
  // Chapter inserts trigger migration 008 notifications in this same transaction.
}

export const contentUpdatesRouter = createContentUpdatesRouter();
