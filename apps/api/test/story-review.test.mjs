import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ContentReviewService,
  ContentReviewUnavailableError,
} from '../src/review/content-review-service.ts';
import {
  ContentReviewWorker,
  chunkReviewText,
} from '../src/review/content-review-worker.ts';
import {
  OpenAICompatibleContentReviewProvider,
  createContentReviewProvider,
} from '../src/review/content-review-provider.ts';

const authorId = '16a04b4a-0f31-4690-9f65-0fd741f465d8';
const fixedTime = new Date('2026-10-21T00:00:00.000Z');

function fakeDatabase({ attempts = 1, chapters = [] } = {}) {
  const calls = [];
  const job = {
    id: '5',
    storyId: '77',
    requestedBy: authorId,
    attempts,
    lockedAt: fixedTime,
  };
  const story = {
    id: '77',
    submittedBy: authorId,
    moderationStatus: 'draft',
    aiReviewStatus: 'queued',
  };

  async function query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('WITH candidate AS')) return { rows: [{ ...job }] };
    if (sql.includes('FROM story_review_jobs')) return { rows: [{ id: job.id }] };
    if (sql.includes('FROM chapters')) return { rows: chapters };
    if (sql.includes('FROM stories') && sql.includes('FOR UPDATE')) return { rows: [{ ...story }] };
    if (sql.includes('UPDATE story_review_jobs SET locked_at')) {
      return { rows: [{ lockedAt: new Date(fixedTime.getTime() + 1000) }] };
    }
    return { rows: [], rowCount: 1 };
  }

  const database = {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
  return { database, calls, job, story };
}

test('missing AI provider rejects submission without changing or publishing the draft', async () => {
  const { database, calls } = fakeDatabase();
  const service = new ContentReviewService(database, null);

  assert.equal(service.isAvailable(), false);
  await assert.rejects(
    service.enqueueStory('77', authorId),
    ContentReviewUnavailableError,
  );
  assert.equal(calls.length, 0);
});

test('submission queues one private review job and records its event atomically', async () => {
  const { database, calls } = fakeDatabase();
  const service = new ContentReviewService(database, { async reviewChapter() { return { warnings: [] }; } });

  await service.enqueueStory('77', authorId);

  const sql = calls.map((call) => call.sql).join('\n');
  assert.match(sql, /BEGIN/);
  assert.match(sql, /FROM stories[\s\S]*FOR UPDATE/);
  assert.match(sql, /INSERT INTO story_review_jobs/);
  assert.match(sql, /INSERT INTO story_review_events/);
  assert.match(sql, /COMMIT/);
  assert.doesNotMatch(sql, /visibility\s*=\s*'public'/i);
});

test('worker reviews bounded text chunks and sends AI warnings to admin review', async () => {
  const { database, calls } = fakeDatabase({
    chapters: [{ id: '9', title: 'Chương 1', content: 'Mở đầu câu chuyện. Nhân vật tiếp tục hành trình.' }],
  });
  const reviewed = [];
  const provider = {
    async reviewChapter(input) {
      reviewed.push(input);
      return input.chunkIndex === 0
        ? { warnings: [{ code: 'VIOLENCE', severity: 'high', note: 'Cần quản trị viên xem lại.' }] }
        : { warnings: [] };
    },
  };
  const worker = new ContentReviewWorker(database, provider, {
    maxChunkCharacters: 16,
    maxAttempts: 3,
    leaseSeconds: 30,
  });

  assert.equal(await worker.runOnce(), 'completed');
  assert.ok(reviewed.length > 1);
  assert.ok(reviewed.every((item) => item.textChunk.length <= 16));
  assert.ok(reviewed.every((item) => item.storyId === '77' && item.chapterId === '9'));
  const claim = calls.find((call) => /WITH candidate AS/.test(call.sql));
  assert.ok(claim);
  assert.match(claim.sql, /FOR UPDATE SKIP LOCKED/);
  assert.ok(claim.sql.includes("status = 'processing'") && claim.sql.includes('locked_at <= now()'));
  const completion = calls.find((call) => /UPDATE stories SET/.test(call.sql));
  assert.ok(completion);
  assert.ok(completion.values.includes('admin_review_pending'));
  assert.ok(calls.some((call) => /INSERT INTO story_review_events/.test(call.sql)));
});

test('worker retries provider errors then leaves the draft private after the final attempt', async () => {
  const first = fakeDatabase({ attempts: 1, chapters: [{ id: '9', title: 'Chương 1', content: 'Nội dung.' }] });
  const failingProvider = { async reviewChapter() { throw new Error('upstream unavailable'); } };
  const retryWorker = new ContentReviewWorker(first.database, failingProvider, {
    maxAttempts: 2,
    retryBaseSeconds: 1,
  });
  assert.equal(await retryWorker.runOnce(), 'retrying');
  assert.ok(first.calls.some((call) => /SET status = 'queued'/.test(call.sql) || /SET status = \$/.test(call.sql)));

  const last = fakeDatabase({ attempts: 2, chapters: [{ id: '9', title: 'Chương 1', content: 'Nội dung.' }] });
  const finalWorker = new ContentReviewWorker(last.database, failingProvider, { maxAttempts: 2 });
  assert.equal(await finalWorker.runOnce(), 'failed');
  const failedStory = last.calls.find((call) => /UPDATE stories SET/.test(call.sql));
  assert.ok(failedStory);
  assert.match(failedStory.sql, /moderation_status = 'draft', ai_review_status = 'failed'/);
  assert.doesNotMatch(failedStory.values.join(' '), /Nội dung|upstream unavailable/);
  const failedJob = last.calls.find((call) => /SET status = 'failed'/.test(call.sql));
  assert.equal(failedJob.values[1], 'AI_PROVIDER_UNAVAILABLE');
});

test('review chunking preserves text and enforces the configured character limit', () => {
  const source = 'Đoạn một.\nĐoạn hai có thêm chữ.';
  const chunks = chunkReviewText(source, 12);
  assert.ok(chunks.every((chunk) => chunk.length <= 12));
  assert.equal(chunks.join(' '), source.replace(/\s+/g, ' ').trim());
});

test('provider refuses missing configuration and treats malformed output as a provider error', async () => {
  assert.equal(createContentReviewProvider({}), null);
  const provider = new OpenAICompatibleContentReviewProvider({
    apiUrl: 'https://provider.invalid/v1/chat/completions',
    apiKey: 'test-secret',
    model: 'test-model',
  }, async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }));

  await assert.rejects(provider.reviewChapter({
    storyId: '77', chapterId: '9', title: 'Chương 1', textChunk: 'Nội dung', chunkIndex: 0,
  }));
});
test('provider sends only chapter text and returns validated warnings', async () => {
  let requestUrl = '';
  let requestOptions;
  const provider = new OpenAICompatibleContentReviewProvider({
    apiUrl: 'https://provider.invalid/v1/chat/completions',
    apiKey: 'test-secret',
    model: 'review-model',
  }, async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        warnings: [{ code: 'CONTENT_REVIEW', severity: 'high', note: 'Quản trị viên cần xem lại.' }],
      }) } }],
    }), { status: 200 });
  });

  const result = await provider.reviewChapter({
    storyId: 'private-story-id',
    chapterId: 'private-chapter-id',
    title: 'Chương thử nghiệm',
    textChunk: 'Nội dung chỉ gửi cho nhà cung cấp AI đã cấu hình.',
    chunkIndex: 2,
  });

  assert.equal(requestUrl, 'https://provider.invalid/v1/chat/completions');
  assert.equal(requestOptions.headers.authorization, 'Bearer test-secret');
  assert.deepEqual(result.warnings, [{
    code: 'CONTENT_REVIEW', severity: 'high', note: 'Quản trị viên cần xem lại.',
  }]);
  const requestBody = JSON.parse(requestOptions.body);
  assert.equal(requestBody.model, 'review-model');
  assert.doesNotMatch(requestOptions.body, /private-story-id|private-chapter-id|storyId|chapterId/);
  assert.match(requestOptions.body, /Nội dung chỉ gửi cho nhà cung cấp AI đã cấu hình/);
});
