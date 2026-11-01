import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { EpubParseError } from '../epub/epub-parser.js';
import { LocalMediaStorage } from '../media/local-media-storage.js';
import type { MediaStorage } from '../media/media-storage.js';
import { StoryImportError, importEpubDraft } from '../services/story-import-service.js';
import {
  ContentReviewUnavailableError,
  StoryNotSubmittableError,
  type ContentReviewService,
} from '../review/content-review-service.js';
import { contentReviewService as defaultContentReviewService } from '../review/runtime.js';
import { csrfTokensMatch, readAccessUserId } from './auth.js';

const maxUploadBytes = 100 * 1024 * 1024;
const csrfFailure = {
  error: { code: 'CSRF_INVALID', message: 'Yêu cầu không hợp lệ.' },
};

interface QueryResult<Row> {
  rows: Row[];
}

interface Database {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  connect(): Promise<{
    query<Row = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  }>;
}

type Contributor = {
  id: string;
  role: string;
};

export class StoryUploadError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_MULTIPART'
      | 'INVALID_UPLOAD'
      | 'TOO_MANY_FILES'
      | 'FILE_TOO_LARGE'
      | 'UNSUPPORTED_FILE_TYPE'
      | 'MISSING_FILE',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'StoryUploadError';
  }
}

function errorResponse(
  response: Response,
  status: number,
  code: string,
  message: string,
) {
  return response.status(status).json({ error: { code, message } });
}

async function verifiedContributor(
  request: Request,
  response: Response,
  database: Database,
): Promise<Contributor | null> {
  const userId = await readAccessUserId(request.cookies?.readlite_access);
  if (!userId) {
    errorResponse(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }

  const result = await database.query<Contributor>(
    'SELECT id::text AS id, role ' +
      'FROM users ' +
      'WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL',
    [userId],
  );
  const user = result.rows[0];
  if (!user) {
    errorResponse(response, 401, 'UNAUTHORIZED', 'Vui lòng đăng nhập để tiếp tục.');
    return null;
  }
  if (user.role !== 'author' && user.role !== 'admin') {
    errorResponse(response, 403, 'FORBIDDEN', 'Tài khoản chưa có quyền đăng truyện.');
    return null;
  }
  return user;
}

export async function receiveEpubFile(request: Request): Promise<{
  path: string;
  directory: string;
}> {
  if (!request.is('multipart/form-data')) {
    throw new StoryUploadError('INVALID_MULTIPART', 400);
  }

  const stagingRoot = resolve(join(env.mediaDirectory, '.staging'));
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(stagingRoot, 'epub-'));
  const path = join(directory, 'upload.epub');
  let fileCount = 0;
  let fileStream = Promise.resolve();
  let uploadError: StoryUploadError | null = null;
  let fileSeen = false;

  try {
    const parser = Busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fields: 0,
        fileSize: maxUploadBytes,
      },
    });

    const parserFinished = new Promise<void>((resolvePromise, rejectPromise) => {
      parser.on('file', (fieldName, file, info) => {
        fileCount += 1;
        if (fileCount > 1) {
          uploadError = new StoryUploadError('TOO_MANY_FILES', 400);
          file.resume();
          return;
        }

        if (fieldName !== 'file') {
          uploadError = new StoryUploadError('INVALID_UPLOAD', 400);
          file.resume();
          return;
        }
        fileSeen = true;

        const extension = (info.filename ?? '')
          .split(/[\\/]/u)
          .pop()
          ?.toLowerCase();
        if (
          !extension?.endsWith('.epub') ||
          !['application/epub+zip', 'application/epub', 'application/octet-stream'].includes(info.mimeType)
        ) {
          uploadError = new StoryUploadError('UNSUPPORTED_FILE_TYPE', 415);
          file.resume();
          return;
        }

        file.once('limit', () => {
          uploadError = new StoryUploadError('FILE_TOO_LARGE', 413);
        });
        fileStream = pipeline(
          file,
          createWriteStream(path, { flags: 'wx', mode: 0o600 }),
        ).catch(() => {
          uploadError ??= new StoryUploadError('INVALID_UPLOAD', 400);
        });
      });
      parser.once('fieldsLimit', () => {
        uploadError = new StoryUploadError('INVALID_UPLOAD', 400);
      });
      parser.once('filesLimit', () => {
        uploadError = new StoryUploadError('TOO_MANY_FILES', 400);
      });
      parser.once('error', rejectPromise);
      parser.once('close', resolvePromise);
    });

    request.pipe(parser);
    await parserFinished;
    await fileStream;
    if (uploadError) throw uploadError;
    if (!fileSeen) throw new StoryUploadError('MISSING_FILE', 400);

    const file = await open(path, 'r').catch(() => null);
    if (!file) throw new StoryUploadError('INVALID_UPLOAD', 400);
    try {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await file.read(signature, 0, signature.length, 0);
      if (
        bytesRead < 4 ||
        signature[0] !== 0x50 ||
        signature[1] !== 0x4b ||
        signature[2] !== 0x03 ||
        signature[3] !== 0x04
      ) {
        throw new StoryUploadError('UNSUPPORTED_FILE_TYPE', 415);
      }
    } finally {
      await file.close();
    }
    return { path, directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    errorResponse(response, 429, 'RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');
  },
});

export function createStorySubmissionRouter(
  database: Database = pool,
  storage: MediaStorage = new LocalMediaStorage(),
  reviewService: ContentReviewService = defaultContentReviewService,
): Router {
  const router = Router();

  router.post(
    '/author/stories/import-epub',
    importLimiter,
    async (request, response, next) => {
      try {
        const user = await verifiedContributor(request, response, database);
        if (!user) return;
        if (
          !csrfTokensMatch(
            request.cookies?.readlite_csrf,
            request.get('x-csrf-token'),
          )
        ) {
          return response.status(403).json(csrfFailure);
        }

        const staged = await receiveEpubFile(request);
        try {
          const imported = await importEpubDraft({
            epubPath: staged.path,
            ownerId: user.id,
            database,
            storage,
          });
          return response.status(201).json(imported);
        } finally {
          await rm(staged.directory, { recursive: true, force: true });
        }
      } catch (error) {
        if (error instanceof StoryUploadError) {
          const message = error.code === 'FILE_TOO_LARGE'
            ? 'Tệp EPUB vượt quá giới hạn 100 MiB.'
            : error.code === 'UNSUPPORTED_FILE_TYPE'
              ? 'Tệp tải lên không phải EPUB hợp lệ.'
              : 'Yêu cầu tải EPUB không hợp lệ.';
          return errorResponse(response, error.status, error.code, message);
        }
        if (error instanceof EpubParseError) {
          return errorResponse(
            response,
            422,
            error.code,
            'Không thể đọc tệp EPUB. Hãy kiểm tra cấu trúc tệp rồi thử lại.',
          );
        }
        if (error instanceof StoryImportError) {
          return errorResponse(
            response,
            422,
            error.code,
            'Không thể tạo bản nháp từ tệp EPUB.',
          );
        }
        return next(error);
      }
    },
  );

  router.post('/author/stories/:storyId/submit', async (request, response, next) => {
    try {
      const user = await verifiedContributor(request, response, database);
      if (!user) return;
      if (
        !csrfTokensMatch(
          request.cookies?.readlite_csrf,
          request.get('x-csrf-token'),
        )
      ) {
        return response.status(403).json(csrfFailure);
      }

      const storyId = request.params.storyId;
      if (typeof storyId !== 'string' || !/^[1-9]\d{0,18}$/.test(storyId)) {
        return errorResponse(response, 404, 'NOT_FOUND', 'Không tìm thấy bản nháp.');
      }
      const story = await database.query<{ moderationStatus: string }>(
        'SELECT moderation_status AS "moderationStatus" FROM stories ' +
          'WHERE id = $1 AND (submitted_by = $2 OR $3::boolean)',
        [storyId, user.id, user.role === 'admin'],
      );
      const status = story.rows[0]?.moderationStatus;
      if (!status) {
        return errorResponse(response, 404, 'NOT_FOUND', 'Không tìm thấy bản nháp.');
      }
      if (status !== 'draft' && status !== 'changes_requested') {
        return errorResponse(
          response,
          409,
          'STORY_NOT_EDITABLE',
          'Truyện hiện không ở trạng thái có thể gửi duyệt.',
        );
      }

      try {
        await reviewService.enqueueStory(storyId, user.id, user.role === 'admin');
        return response.status(202).json({
          storyId,
          moderationStatus: 'ai_review_pending',
          aiReviewStatus: 'queued',
        });
      } catch (error) {
        if (error instanceof ContentReviewUnavailableError) {
          const client = await database.connect();
          try {
            await client.query('BEGIN');
            const moved = await client.query(
              "UPDATE stories SET moderation_status = 'admin_review_pending', ai_review_status = 'skipped', " +
              "ai_review_warnings = '[]'::jsonb, visibility = 'private' " +
              "WHERE id = $1 AND (submitted_by = $2 OR $3::boolean) AND moderation_status IN ('draft', 'changes_requested') RETURNING id",
              [storyId, user.id, user.role === 'admin'],
            );
            if (!moved.rows.length) {
              await client.query('ROLLBACK');
              return errorResponse(response, 409, 'STORY_NOT_EDITABLE', 'Truyện đã chuyển trạng thái. Hãy tải lại.');
            }
            await client.query(
              "INSERT INTO story_review_events (story_id, actor_id, action, details) VALUES ($1, $2, 'submitted', $3::jsonb)",
              [storyId, user.id, JSON.stringify({ mode: 'manual', reason: 'AI_NOT_CONFIGURED' })],
            );
            await client.query('COMMIT');
            return response.status(202).json({ storyId, moderationStatus: 'admin_review_pending', aiReviewStatus: 'skipped' });
          } catch (manualError) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw manualError;
          } finally { client.release(); }
        }
        if (error instanceof StoryNotSubmittableError) {
          const statusCode = error.code === 'NOT_FOUND' ? 404 : 409;
          return errorResponse(
            response,
            statusCode,
            error.code,
            'Truyện hiện không ở trạng thái có thể gửi duyệt.',
          );
        }
        throw error;
      }
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

export const storySubmissionRouter = createStorySubmissionRouter();






