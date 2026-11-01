import assert from 'node:assert/strict';
import { test } from 'node:test';
import { down, up } from '../../../db/migrations/003-story-submissions-media.ts';

function captureSql(migration) {
  const statements = [];
  migration({ sql: (statement) => statements.push(statement) });
  return statements.join('\n');
}

test('migration mở rộng schema truyện cho tác giả, tập, media và kiểm duyệt', () => {
  const sql = captureSql(up);

  assert.match(sql, /role\s+IN\s*\('user',\s*'author',\s*'admin'\)/);
  assert.match(sql, /CREATE TABLE volumes/i);
  assert.match(sql, /ADD COLUMN volume_id/i);
  assert.match(sql, /content_blocks\s+jsonb/i);
  assert.match(sql, /CREATE TABLE media_assets/i);
  assert.match(sql, /CREATE TABLE story_review_events/i);
  assert.match(sql, /CREATE TABLE story_review_jobs/i);
  assert.match(sql, /ai_review_warnings\s+jsonb/i);
});

test('migration giữ truyện công khai cũ đã xuất bản và chặn public draft', () => {
  const sql = captureSql(up);

  assert.match(sql, /UPDATE stories[\s\S]*visibility\s*=\s*'public'[\s\S]*moderation_status\s*=\s*'published'/i);
  assert.match(sql, /visibility\s*<>\s*'public'\s+OR\s+moderation_status\s*=\s*'published'/i);
});

test('migration cấm quản trị viên tự duyệt truyện mình gửi', () => {
  const sql = captureSql(up);

  assert.match(sql, /readlite_prevent_submitter_self_review/i);
  assert.match(sql, /submitter_role\s*=\s*'admin'/i);
  assert.match(sql, /reviewed_by\s*=\s*NEW\.submitted_by/i);
});

test('migration rollback bỏ đúng các bảng và cột mới', () => {
  const sql = captureSql(down);

  assert.match(sql, /DROP TABLE IF EXISTS story_review_jobs/i);
  assert.match(sql, /DROP TABLE IF EXISTS media_assets/i);
  assert.match(sql, /DROP TABLE IF EXISTS volumes/i);
  assert.match(sql, /DROP COLUMN IF EXISTS content_blocks/i);
  assert.match(sql, /DROP COLUMN IF EXISTS moderation_status/i);
});
