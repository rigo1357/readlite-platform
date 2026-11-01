import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { createContentReviewProvider } from './content-review-provider.js';
import { ContentReviewService } from './content-review-service.js';
import { ContentReviewWorker } from './content-review-worker.js';

export const contentReviewProvider = createContentReviewProvider({
  provider: env.aiReviewProvider,
  apiUrl: env.aiReviewApiUrl,
  apiKey: env.aiReviewApiKey,
  model: env.aiReviewModel,
  timeoutMs: env.aiReviewTimeoutMs,
});

export const contentReviewService = new ContentReviewService(
  pool,
  contentReviewProvider,
);

export const contentReviewWorker = contentReviewProvider
  ? new ContentReviewWorker(pool, contentReviewProvider, {
      maxAttempts: env.aiReviewMaxAttempts,
      maxChunkCharacters: env.aiReviewMaxChunkCharacters,
      leaseSeconds: env.aiReviewLeaseSeconds,
      retryBaseSeconds: env.aiReviewRetryBaseSeconds,
      pollIntervalMs: env.aiReviewPollIntervalMs,
    })
  : null;