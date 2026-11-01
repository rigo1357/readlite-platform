import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { parseEnvironment } from '../src/config/env.ts';

test('local environment defaults media storage outside the checkout', () => {
  const parsed = parseEnvironment({});

  assert.equal(parsed.mediaDirectory, resolve(homedir(), '.readlite', 'media'));
});

test('production requires a persistent media directory', () => {
  assert.throws(
    () => parseEnvironment({
      NODE_ENV: 'production',
      AUTH_ACCESS_SECRET: 'a-production-secret-with-more-than-32-bytes',
      CORS_ORIGINS: 'https://readlite.example',
      COOKIE_SECURE: 'true',
    }),
    /READLITE_MEDIA_DIR/,
  );
});

test('production accepts an explicit media directory', () => {
  const parsed = parseEnvironment({
    NODE_ENV: 'production',
    AUTH_ACCESS_SECRET: 'a-production-secret-with-more-than-32-bytes',
    CORS_ORIGINS: 'https://readlite.example',
    COOKIE_SECURE: 'true',
    READLITE_MEDIA_DIR: 'C:/readlite/media',
  });

  assert.equal(parsed.mediaDirectory, resolve('C:/readlite/media'));
});

test('AI review remains disabled without a selected provider', () => {
  const parsed = parseEnvironment({});

  assert.equal(parsed.aiReviewProvider, undefined);
  assert.equal(parsed.aiReviewApiKey, undefined);
  assert.equal(parsed.aiReviewMaxAttempts, 5);
  assert.equal(parsed.aiReviewMaxChunkCharacters, 10_000);
});

test('Compose empty AI variables keep review disabled instead of invalidating the API config', () => {
  const parsed = parseEnvironment({
    AI_REVIEW_PROVIDER: '',
    AI_REVIEW_API_URL: '',
    AI_REVIEW_API_KEY: '',
    AI_REVIEW_MODEL: '',
  });

  assert.equal(parsed.aiReviewProvider, undefined);
  assert.equal(parsed.aiReviewApiUrl, undefined);
  assert.equal(parsed.aiReviewApiKey, undefined);
  assert.equal(parsed.aiReviewModel, undefined);
});
test('AI review provider configuration is parsed without exposing secret values', () => {
  const parsed = parseEnvironment({
    AI_REVIEW_PROVIDER: 'openai-compatible',
    AI_REVIEW_API_URL: 'https://provider.example/v1/chat/completions',
    AI_REVIEW_API_KEY: 'private-test-key-value',
    AI_REVIEW_MODEL: 'test-model',
  });

  assert.equal(parsed.aiReviewProvider, 'openai-compatible');
  assert.equal(parsed.aiReviewApiUrl, 'https://provider.example/v1/chat/completions');
  assert.equal(parsed.aiReviewModel, 'test-model');
  assert.equal(parsed.aiReviewApiKey, 'private-test-key-value');
});
