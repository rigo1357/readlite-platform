import type {
  ContentReviewProvider,
  ContentReviewWarning,
} from './content-review-provider.js';
import { ContentReviewProviderError } from './content-review-provider.js';

type QueryResult<Row> = {
  rows: Row[];
  rowCount?: number | null;
};

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface ReviewDatabase extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

type ReviewJob = {
  id: string;
  storyId: string;
  requestedBy: string;
  attempts: number;
  lockedAt: Date | string;
};

type ReviewChapter = {
  id: string;
  title: string;
  content?: string | null;
  contentBlocks?: unknown;
};

export type ContentReviewWorkerOptions = {
  maxAttempts?: number;
  maxChunkCharacters?: number;
  leaseSeconds?: number;
  retryBaseSeconds?: number;
  pollIntervalMs?: number;
};

export type ContentReviewRunResult = 'idle' | 'completed' | 'retrying' | 'failed';

class NonRetryableReviewError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

class ReviewLeaseLostError extends Error {}

const claimJobSql =
  'WITH candidate AS (' +
  ' SELECT id FROM story_review_jobs ' +
  " WHERE (status = 'queued' AND available_at <= now()) " +
  " OR (status = 'processing' AND (locked_at IS NULL OR locked_at <= now() - ($1 * INTERVAL '1 second'))) " +
  ' ORDER BY COALESCE(locked_at, available_at), id ' +
  ' FOR UPDATE SKIP LOCKED LIMIT 1' +
  ') ' +
  "UPDATE story_review_jobs AS job SET status = 'processing', " +
  'attempts = job.attempts + 1, locked_at = now(), last_error = NULL ' +
  'FROM candidate WHERE job.id = candidate.id ' +
  'RETURNING job.id::text AS id, job.story_id::text AS "storyId", ' +
  'job.requested_by::text AS "requestedBy", job.attempts, job.locked_at AS "lockedAt"';

export function chunkReviewText(text: string, maxCharacters: number): string[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new RangeError('maxCharacters must be a positive integer.');
  }

  let remaining = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  while (remaining.length > maxCharacters) {
    let boundary = remaining.lastIndexOf(' ', maxCharacters);
    if (boundary <= 0) boundary = maxCharacters;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function blockText(value: unknown): string {
  let blocks = value;
  if (typeof blocks === 'string') {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      blocks = [];
    }
  }
  if (!Array.isArray(blocks)) return '';

  return blocks.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') return [];
    const block = entry as Record<string, unknown>;
    if (block.type === 'text') {
      if (Array.isArray(block.runs)) {
        return [block.runs.flatMap((run) => {
          if (!run || typeof run !== 'object') return [];
          const text = (run as Record<string, unknown>).text;
          return typeof text === 'string' ? [text] : [];
        }).join('')];
      }
      return typeof block.text === 'string' ? [block.text] : [];
    }
    if (block.type === 'image') {
      const description = [block.altText, block.caption]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ');
      return description ? [description] : [];
    }
    return [];
  }).join('\n');
}

function chapterText(chapter: ReviewChapter): string {
  const fromBlocks = blockText(chapter.contentBlocks);
  return (fromBlocks.trim() || chapter.content || '').trim();
}

function safeErrorCode(error: unknown): string {
  if (error instanceof NonRetryableReviewError) return error.code;
  if (error instanceof ContentReviewProviderError) return error.code;
  return 'AI_PROVIDER_UNAVAILABLE';
}

function validWarnings(value: unknown): ContentReviewWarning[] {
  if (!value || typeof value !== 'object') {
    throw new ContentReviewProviderError('AI_PROVIDER_INVALID_RESPONSE');
  }
  const warnings = (value as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings) || warnings.length > 100) {
    throw new ContentReviewProviderError('AI_PROVIDER_INVALID_RESPONSE');
  }
  return warnings.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new ContentReviewProviderError('AI_PROVIDER_INVALID_RESPONSE');
    }
    const warning = entry as Record<string, unknown>;
    if (
      typeof warning.code !== 'string' ||
      typeof warning.severity !== 'string' ||
      typeof warning.note !== 'string' ||
      warning.code.length === 0 ||
      warning.code.length > 64 ||
      warning.severity.length === 0 ||
      warning.severity.length > 32 ||
      warning.note.trim().length === 0 ||
      warning.note.length > 1000
    ) {
      throw new ContentReviewProviderError('AI_PROVIDER_INVALID_RESPONSE');
    }
    return {
      code: warning.code,
      severity: warning.severity as ContentReviewWarning['severity'],
      note: warning.note.trim(),
    };
  });
}

export class ContentReviewWorker {
  private readonly options: Required<ContentReviewWorkerOptions>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeRun: Promise<ContentReviewRunResult> | null = null;

  constructor(
    private readonly database: ReviewDatabase,
    private readonly provider: ContentReviewProvider,
    options: ContentReviewWorkerOptions = {},
  ) {
    this.options = {
      maxAttempts: options.maxAttempts ?? 5,
      maxChunkCharacters: options.maxChunkCharacters ?? 10_000,
      leaseSeconds: options.leaseSeconds ?? 120,
      retryBaseSeconds: options.retryBaseSeconds ?? 10,
      pollIntervalMs: options.pollIntervalMs ?? 3_000,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {
        console.error('Không thể xử lý hàng đợi kiểm duyệt AI.');
      });
    }, this.options.pollIntervalMs);
    this.timer.unref?.();
    void this.runOnce().catch(() => {
      console.error('Không thể khởi động hàng đợi kiểm duyệt AI.');
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.activeRun) await this.activeRun.catch(() => 'idle');
  }

  async runOnce(): Promise<ContentReviewRunResult> {
    if (this.activeRun) return this.activeRun;
    const work = this.processNextJob();
    this.activeRun = work;
    try {
      return await work;
    } finally {
      this.activeRun = null;
    }
  }

  private async processNextJob(): Promise<ContentReviewRunResult> {
    const claimed = await this.database.query<ReviewJob>(
      claimJobSql,
      [this.options.leaseSeconds],
    );
    const job = claimed.rows[0];
    if (!job) return 'idle';

    let lockToken: Date | string = job.lockedAt;
    try {
      const result = await this.database.query<ReviewChapter>(
        'SELECT id::text AS id, title, content, content_blocks AS "contentBlocks" ' +
          'FROM chapters WHERE story_id = $1 ' +
          'ORDER BY COALESCE(volume_id, 0), chapter_order, id',
        [job.storyId],
      );
      if (result.rows.length === 0) {
        throw new NonRetryableReviewError('AI_REVIEW_NO_CHAPTERS');
      }

      const warnings: Array<ContentReviewWarning & {
        chapterId: string;
        chapterTitle: string;
      }> = [];
      let chunkCount = 0;
      let reviewableTextFound = false;

      for (const chapter of result.rows) {
        const chunks = chunkReviewText(
          chapterText(chapter),
          this.options.maxChunkCharacters,
        );
        if (chunks.length === 0) continue;
        reviewableTextFound = true;

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const renewed = await this.renewLease(job, lockToken);
          if (!renewed) throw new ReviewLeaseLostError();
          lockToken = renewed;

          const review = await this.provider.reviewChapter({
            storyId: job.storyId,
            chapterId: chapter.id,
            title: chapter.title,
            textChunk: chunks[chunkIndex],
            chunkIndex,
          });
          const chapterWarnings = validWarnings(review).map((warning) => ({
            ...warning,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
          }));
          warnings.push(...chapterWarnings);
          chunkCount += 1;
        }
      }

      if (!reviewableTextFound || chunkCount === 0) {
        throw new NonRetryableReviewError('AI_REVIEW_EMPTY_CONTENT');
      }

      const committed = await this.completeJob(job, lockToken, warnings, chunkCount);
      return committed ? 'completed' : 'retrying';
    } catch (error) {
      if (error instanceof ReviewLeaseLostError) return 'retrying';
      return this.failJob(job, lockToken, error);
    }
  }

  private async renewLease(
    job: ReviewJob,
    lockToken: Date | string,
  ): Promise<Date | string | null> {
    const renewed = await this.database.query<{ lockedAt: Date | string }>(
      'UPDATE story_review_jobs SET locked_at = now() ' +
        "WHERE id = $1 AND status = 'processing' AND locked_at = $2 " +
        "AND locked_at > now() - ($3 * INTERVAL '1 second') " +
        'RETURNING locked_at AS "lockedAt"',
      [job.id, lockToken, this.options.leaseSeconds],
    );
    return renewed.rows[0]?.lockedAt ?? null;
  }

  private async completeJob(
    job: ReviewJob,
    lockToken: Date | string,
    warnings: Array<ContentReviewWarning & {
      chapterId: string;
      chapterTitle: string;
    }>,
    chunkCount: number,
  ): Promise<boolean> {
    const client = await this.database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const locked = await client.query<{ id: string }>(
        "SELECT id::text AS id FROM story_review_jobs " +
          "WHERE id = $1 AND status = 'processing' AND locked_at = $2 FOR UPDATE",
        [job.id, lockToken],
      );
      if (!locked.rows[0]) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return false;
      }

      const aiStatus = warnings.length > 0 ? 'warnings' : 'passed';
      const updatedStory = await client.query(
        'UPDATE stories SET moderation_status = $2, ai_review_status = $3, ' +
          'ai_review_warnings = $4::jsonb ' +
          "WHERE id = $1 AND submitted_by = $5 AND moderation_status = 'ai_review_pending' " +
          'RETURNING id',
        [
          job.storyId,
          'admin_review_pending',
          aiStatus,
          JSON.stringify(warnings),
          job.requestedBy,
        ],
      );
      if (updatedStory.rowCount === 0) {
        throw new NonRetryableReviewError('AI_REVIEW_STORY_STATE_CHANGED');
      }

      await client.query(
        "UPDATE story_review_jobs SET status = 'completed', locked_at = NULL, last_error = NULL " +
          "WHERE id = $1 AND status = 'processing' AND locked_at = $2",
        [job.id, lockToken],
      );
      await client.query(
        "INSERT INTO story_review_events (story_id, actor_id, action, details) " +
          "VALUES ($1, NULL, 'ai_review_completed', $2::jsonb)",
        [
          job.storyId,
          JSON.stringify({
            warningCount: warnings.length,
            chunkCount,
          }),
        ],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return true;
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async failJob(
    job: ReviewJob,
    lockToken: Date | string,
    error: unknown,
  ): Promise<ContentReviewRunResult> {
    const client = await this.database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      const locked = await client.query<{ id: string }>(
        "SELECT id::text AS id FROM story_review_jobs " +
          "WHERE id = $1 AND status = 'processing' AND locked_at = $2 FOR UPDATE",
        [job.id, lockToken],
      );
      if (!locked.rows[0]) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return 'retrying';
      }

      const errorCode = safeErrorCode(error);
      const permanentlyFailed =
        error instanceof NonRetryableReviewError ||
        job.attempts >= this.options.maxAttempts;

      if (permanentlyFailed) {
        await client.query(
          "UPDATE stories SET moderation_status = 'draft', ai_review_status = 'failed', " +
            "ai_review_warnings = '[]'::jsonb " +
            "WHERE id = $1 AND submitted_by = $2 AND moderation_status = 'ai_review_pending'",
          [job.storyId, job.requestedBy],
        );
        await client.query(
          "UPDATE story_review_jobs SET status = 'failed', locked_at = NULL, last_error = $2 " +
            "WHERE id = $1 AND status = 'processing' AND locked_at = $3",
          [job.id, errorCode, lockToken],
        );
        await client.query(
          "INSERT INTO story_review_events (story_id, actor_id, action, details) " +
            "VALUES ($1, NULL, 'ai_review_failed', $2::jsonb)",
          [job.storyId, JSON.stringify({ code: errorCode, attempts: job.attempts })],
        );
        await client.query('COMMIT');
        transactionStarted = false;
        return 'failed';
      }

      const retryDelay = Math.min(
        300,
        this.options.retryBaseSeconds * 2 ** Math.max(0, job.attempts - 1),
      );
      await client.query(
        "UPDATE story_review_jobs SET status = 'queued', " +
          "available_at = now() + ($2 * INTERVAL '1 second'), locked_at = NULL, last_error = $3 " +
          "WHERE id = $1 AND status = 'processing' AND locked_at = $4",
        [job.id, retryDelay, errorCode, lockToken],
      );
      await client.query(
        "UPDATE stories SET moderation_status = 'ai_review_pending', ai_review_status = 'queued' " +
          "WHERE id = $1 AND submitted_by = $2 AND moderation_status = 'ai_review_pending'",
        [job.storyId, job.requestedBy],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      return 'retrying';
    } catch (failureError) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      throw failureError;
    } finally {
      client.release();
    }
  }
}