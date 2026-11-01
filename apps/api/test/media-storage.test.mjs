import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { LocalMediaStorage } from '../src/media/local-media-storage.ts';
import { MediaStorageError } from '../src/media/media-storage.ts';

const temporaryRoots = [];

async function createStorage() {
  const root = await mkdtemp(join(tmpdir(), 'readlite-media-test-'));
  temporaryRoots.push(root);
  return { root, storage: new LocalMediaStorage(root) };
}

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test('local media storage writes generated key, byte count and SHA-256', async () => {
  const { root, storage } = await createStorage();
  const payload = Buffer.from('synthetic image payload');

  const stored = await storage.put(Readable.from([payload]), 1024);

  assert.match(stored.key, /^[0-9a-f-]{36}\.blob$/);
  assert.equal(stored.byteSize, payload.length);
  assert.equal(stored.sha256, createHash('sha256').update(payload).digest('hex'));
  assert.deepEqual(await readFile(join(root, stored.key)), payload);
});

test('local media storage rejects an oversized stream and removes its partial file', async () => {
  const { root, storage } = await createStorage();

  await assert.rejects(
    storage.put(Readable.from([Buffer.alloc(12)]), 10),
    (error) => error instanceof MediaStorageError && error.code === 'FILE_TOO_LARGE',
  );
  assert.deepEqual(await readdir(root), []);
});

test('local media storage rejects empty objects and unsafe keys', async () => {
  const { storage } = await createStorage();

  await assert.rejects(
    storage.put(Readable.from([]), 10),
    (error) => error instanceof MediaStorageError && error.code === 'EMPTY_FILE',
  );
  assert.throws(
    () => storage.createReadStream('../outside.blob'),
    (error) => error instanceof MediaStorageError && error.code === 'INVALID_STORAGE_KEY',
  );
});
