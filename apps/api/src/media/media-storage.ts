import type { Readable } from 'node:stream';
import type { ReadStream } from 'node:fs';

export interface StoredMediaObject {
  key: string;
  byteSize: number;
  sha256: string;
}

export interface MediaStorage {
  put(source: Readable, maxBytes: number): Promise<StoredMediaObject>;
  createReadStream(key: string): ReadStream;
  delete(key: string): Promise<void>;
}

export type MediaStorageErrorCode =
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'INVALID_STORAGE_KEY'
  | 'STORAGE_WRITE_FAILED';

export class MediaStorageError extends Error {
  constructor(public readonly code: MediaStorageErrorCode) {
    super(code);
    this.name = 'MediaStorageError';
  }
}
