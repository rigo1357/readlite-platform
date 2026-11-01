import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReadliteTestDatabase } from '../scripts/test-runner.mjs';

test('database test guard accepts only the dedicated readlite_test database', () => {
  assert.equal(
    isReadliteTestDatabase('postgres://user:example-only@localhost:5432/readlite_test'),
    true,
  );
  assert.equal(
    isReadliteTestDatabase('postgres://user:example-only@localhost:5432/readlite'),
    false,
  );
  assert.equal(isReadliteTestDatabase(undefined), false);
  assert.equal(isReadliteTestDatabase('not-a-database-url'), false);
});