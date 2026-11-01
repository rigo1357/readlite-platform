import { Router, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { pool } from '../db/pool.js';
import { LocalMediaStorage } from '../media/local-media-storage.js';
import type { MediaStorage } from '../media/media-storage.js';
import { readAccessUserId } from './auth.js';

interface QueryResult<Row> {
  rows: Row[];
}

interface Database {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

type SessionUser = {
  id: string;
  role: string;
};

type MediaRecord = {
  storageKey: string;
  mediaKind: 'epub' | 'cover' | 'image';
  mimeType: string;
  byteSize: number;
  sha256: string;
  storyOwnerId: string;
  visibility: 'private' | 'public';
  moderationStatus: string;
  contentUpdateStatus?: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound(response: Response) {
  return response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy tài nguyên.',
    },
  });
}

async function currentUser(
  accessToken: unknown,
  database: Database,
): Promise<SessionUser | null> {
  const userId = await readAccessUserId(accessToken);

  if (!userId) {
    return null;
  }

  const result = await database.query<SessionUser>(
    'SELECT id::text AS id, role ' +
      'FROM users ' +
      'WHERE id = $1 AND is_active = true AND email_verified_at IS NOT NULL',
    [userId],
  );

  return result.rows[0] ?? null;
}

export function createMediaRouter(
  database: Database = pool,
  storage: MediaStorage = new LocalMediaStorage(),
): Router {
  const router = Router();

  router.get('/media/:mediaId', async (request, response, next) => {
    const mediaId = request.params.mediaId;

    if (typeof mediaId !== 'string' || !uuidPattern.test(mediaId)) {
      return notFound(response);
    }

    try {
      const user = await currentUser(
        request.cookies?.readlite_access,
        database,
      );
      const result = await database.query<MediaRecord>(
        'SELECT ' +
          'm.storage_key AS "storageKey", ' +
          'm.media_kind AS "mediaKind", ' +
          'm.mime_type AS "mimeType", ' +
          'm.byte_size::int AS "byteSize", ' +
          'm.sha256 AS "sha256", ' +
          's.owner_id::text AS "storyOwnerId", ' +
          's.visibility, ' +
          's.moderation_status AS "moderationStatus", ' +
          'cu.status AS "contentUpdateStatus" ' +
          'FROM media_assets m ' +
          'JOIN stories s ON s.id = m.story_id ' +
          'LEFT JOIN story_content_updates cu ON cu.id = m.content_update_id ' +
          'WHERE m.id = $1',
        [mediaId],
      );
      const media = result.rows[0];

      if (!media) {
        return notFound(response);
      }

      const isPublicImage =
        media.mediaKind !== 'epub' &&
        media.visibility === 'public' &&
        (!media.contentUpdateStatus || media.contentUpdateStatus === 'published') &&
        media.moderationStatus === 'published';
      const isOwner = user?.id === media.storyOwnerId;
      const isAdmin = user?.role === 'admin';

      if (!isPublicImage && !isOwner && !isAdmin) {
        return notFound(response);
      }

      const source = storage.createReadStream(media.storageKey);
      response.setHeader('Content-Type', media.mimeType);
      response.setHeader('Content-Length', String(media.byteSize));
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('ETag', '"' + media.sha256 + '"');
      response.setHeader(
        'Cache-Control',
        isPublicImage ? 'public, max-age=86400, immutable' : 'private, no-store',
      );

      if (media.mediaKind === 'epub') {
        response.setHeader(
          'Content-Disposition',
          'attachment; filename="readlite.epub"',
        );
      } else {
        response.setHeader('Content-Disposition', 'inline');
      }

      return pipeline(source, response).catch(() => {
        if (!response.headersSent) {
          response.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Không tìm thấy tài nguyên.',
            },
          });
          return;
        }
        response.destroy();
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export const mediaRouter = createMediaRouter();

