import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { env } from '../config/env.js';

export class StagedUploadError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_MULTIPART'
      | 'INVALID_UPLOAD'
      | 'TOO_MANY_FILES'
      | 'FILE_TOO_LARGE'
      | 'UNSUPPORTED_FILE_TYPE'
      | 'MISSING_FILE',
    public readonly status: number,
  ) {
    super(code);
    this.name = 'StagedUploadError';
  }
}

export interface SingleUploadOptions {
  fieldName: string;
  maxBytes: number;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  signatureBytes: number;
  verifySignature(signature: Buffer, mimeType: string): boolean;
}

export interface StagedUpload {
  path: string;
  directory: string;
  mimeType: string;
}

export async function stageSingleUpload(
  request: Request,
  options: SingleUploadOptions,
): Promise<StagedUpload> {
  if (!request.is('multipart/form-data')) {
    throw new StagedUploadError('INVALID_MULTIPART', 400);
  }

  const stagingRoot = resolve(join(env.mediaDirectory, '.staging'));
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(stagingRoot, 'upload-'));
  const path = join(directory, 'file');
  let fileCount = 0;
  let fileSeen = false;
  let mimeType = '';
  let uploadError: StagedUploadError | null = null;
  let fileStream: Promise<void> = Promise.resolve();

  try {
    const parser = Busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fields: 0,
        fileSize: options.maxBytes,
      },
    });
    const parserFinished = new Promise<void>((resolvePromise, rejectPromise) => {
      parser.once('error', rejectPromise);
      parser.once('close', resolvePromise);
      parser.once('fieldsLimit', () => {
        uploadError = new StagedUploadError('INVALID_UPLOAD', 400);
      });
      parser.once('filesLimit', () => {
        uploadError = new StagedUploadError('TOO_MANY_FILES', 400);
      });
      parser.on('file', (fieldName, file, info) => {
        fileCount += 1;
        if (fileCount > 1) {
          uploadError = new StagedUploadError('TOO_MANY_FILES', 400);
          file.resume();
          return;
        }
        if (fieldName !== options.fieldName) {
          uploadError = new StagedUploadError('INVALID_UPLOAD', 400);
          file.resume();
          return;
        }
        fileSeen = true;
        mimeType = info.mimeType.toLowerCase();
        const filename = (info.filename ?? '')
          .split(/[\\/]/u)
          .pop()
          ?.toLowerCase() ?? '';
        const extension = filename.slice(filename.lastIndexOf('.'));
        if (
          !extension ||
          !options.extensions.includes(extension) ||
          !options.mimeTypes.includes(mimeType)
        ) {
          uploadError = new StagedUploadError('UNSUPPORTED_FILE_TYPE', 415);
          file.resume();
          return;
        }
        file.once('limit', () => {
          uploadError = new StagedUploadError('FILE_TOO_LARGE', 413);
        });
        fileStream = pipeline(
          file,
          createWriteStream(path, { flags: 'wx', mode: 0o600 }),
        ).catch(() => {
          uploadError ??= new StagedUploadError('INVALID_UPLOAD', 400);
        });
      });
    });

    request.pipe(parser);
    await parserFinished;
    await fileStream;
    if (uploadError) throw uploadError;
    if (!fileSeen) throw new StagedUploadError('MISSING_FILE', 400);

    const stagedFile = await open(path, 'r').catch(() => null);
    if (!stagedFile) throw new StagedUploadError('INVALID_UPLOAD', 400);
    try {
      const signature = Buffer.alloc(options.signatureBytes);
      const { bytesRead } = await stagedFile.read(
        signature,
        0,
        options.signatureBytes,
        0,
      );
      if (
        bytesRead < options.signatureBytes ||
        !options.verifySignature(signature.subarray(0, bytesRead), mimeType)
      ) {
        throw new StagedUploadError('UNSUPPORTED_FILE_TYPE', 415);
      }
    } finally {
      await stagedFile.close();
    }
    return { path, directory, mimeType };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

