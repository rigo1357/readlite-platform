import type { ContentReviewProvider } from './content-review-provider.js';

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

export class ContentReviewUnavailableError extends Error {
  constructor() {
    super('AI_REVIEW_UNAVAILABLE');
    this.name = 'ContentReviewUnavailableError';
  }
}

export class StoryNotSubmittableError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'STORY_NOT_EDITABLE') {
    super(code);
    this.name = 'StoryNotSubmittableError';
  }
}

type LockedStory = {
  id: string;
  moderationStatus: string;
};

export class ContentReviewService {
  constructor(
    private readonly database: ReviewDatabase,
    private readonly provider: ContentReviewProvider | null,
  ) {}

  isAvailable(): boolean {
    return this.provider !== null;
  }

  async enqueueStory(storyId: string, requestedBy: string, administrator = false): Promise<void> {
    if (!this.provider) throw new ContentReviewUnavailableError();

    const client = await this.database.connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const locked = await client.query<LockedStory>(
        'SELECT id::text AS id, moderation_status AS "moderationStatus" ' +
          'FROM stories WHERE id = $1 AND (submitted_by = $2 OR $3::boolean) FOR UPDATE',
        [storyId, requestedBy, administrator],
      );
      const story = locked.rows[0];
      if (!story) throw new StoryNotSubmittableError('NOT_FOUND');
      if (
        story.moderationStatus !== 'draft' &&
        story.moderationStatus !== 'changes_requested'
      ) {
        throw new StoryNotSubmittableError('STORY_NOT_EDITABLE');
      }

      await client.query(
        "UPDATE stories SET moderation_status = 'ai_review_pending', " +
          "ai_review_status = 'queued', ai_review_warnings = '[]'::jsonb " +
          'WHERE id = $1',
        [storyId],
      );
      await client.query(
        "INSERT INTO story_review_jobs (story_id, requested_by, status, attempts, available_at) " +
          "VALUES ($1, $2, 'queued', 0, now())",
        [storyId, requestedBy],
      );
      await client.query(
        "INSERT INTO story_review_events (story_id, actor_id, action, details) " +
          "VALUES ($1, $2, 'submitted', $3::jsonb)",
        [storyId, requestedBy, JSON.stringify({ source: 'author_submission' })],
      );

      await client.query('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}