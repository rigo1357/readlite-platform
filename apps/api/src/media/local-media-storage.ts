import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  MediaStorageError,
  type MediaStorage,
  type StoredMediaObject,
} from './media-storage.js';
import { env } from '../config/env.js';

const storageKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.blob$/i;

export class LocalMediaStorage implements MediaStorage {
  private readonly rootDirectory: string;

  constructor(rootDirectory = env.mediaDirectory) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async put(source: Readable, maxBytes: number): Promise<StoredMediaObject> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new MediaStorageError('FILE_TOO_LARGE');
    }

    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const key = `${randomUUID()}.blob`;
    const destination = this.pathForKey(key);
    const hash = createHash('sha256');
    let byteSize = 0;
    const hasher = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.length;
        if (byteSize > maxBytes) {
          callback(new MediaStorageError('FILE_TOO_LARGE'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        source,
        hasher,
        createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      );
      if (byteSize === 0) {
        throw new MediaStorageError('EMPTY_FILE');
      }
      return { key, byteSize, sha256: hash.digest('hex') };
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      if (error instanceof MediaStorageError) {
        throw error;
      }
      throw new MediaStorageError('STORAGE_WRITE_FAILED');
    }
  }

  createReadStream(key: string) {
    return createReadStream(this.pathForKey(key));
  }

  async delete(key: string): Promise<void> {
    const path = this.pathForKey(key);
    try {
      await unlink(path);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw new MediaStorageError('STORAGE_WRITE_FAILED');
    }
  }

  private pathForKey(key: string): string {
    if (!storageKeyPattern.test(key)) {
      throw new MediaStorageError('INVALID_STORAGE_KEY');
    }
    return join(this.rootDirectory, key);
  }
}
