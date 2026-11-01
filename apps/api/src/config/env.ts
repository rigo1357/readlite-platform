import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const localDatabaseUrl = 'postgres://readlite:readlite_local@postgres:5432/readlite';
const localAuthAccessSecret = 'readlite-local-access-secret-change-before-deploy-2026';
const localMediaDirectory = resolve(join(homedir(), '.readlite', 'media'));

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

const originSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  })
  .transform((value) => new URL(value).origin);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'))
      .default(localDatabaseUrl),
    AUTH_ACCESS_SECRET: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') >= 32)
      .default(localAuthAccessSecret),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:8080,http://localhost:5173')
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(originSchema).min(1)),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_HOST: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMTP_USER: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
    SMTP_PASSWORD: z.preprocess(blankToUndefined, z.string().min(1).optional()),
    SMTP_FROM: z.preprocess(blankToUndefined, z.string().trim().email().optional()),
    APP_PUBLIC_URL: z.preprocess(blankToUndefined, originSchema.optional()),
    READLITE_MEDIA_DIR: z.string().trim().min(1).default(localMediaDirectory),
    AI_REVIEW_PROVIDER: z.preprocess(blankToUndefined, z.enum(['openai-compatible']).optional()),
    AI_REVIEW_API_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
    AI_REVIEW_API_KEY: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
    AI_REVIEW_MODEL: z.preprocess(blankToUndefined, z.string().trim().min(1).optional()),
    AI_REVIEW_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(45_000),
    AI_REVIEW_MAX_CHUNK_CHARACTERS: z.coerce.number().int().min(100).max(30_000).default(10_000),
    AI_REVIEW_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    AI_REVIEW_LEASE_SECONDS: z.coerce.number().int().min(60).max(900).default(120),
    AI_REVIEW_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(300).default(10),
    AI_REVIEW_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(3_000),
  })
  .superRefine((values, context) => {
    if (values.SMTP_HOST && (!values.SMTP_FROM || !values.APP_PUBLIC_URL)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_FROM'],
        message: 'SMTP cần địa chỉ gửi và URL API công khai.',
      });
    }
    if (Boolean(values.SMTP_USER) !== Boolean(values.SMTP_PASSWORD)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'Cần cấu hình cả SMTP_USER và SMTP_PASSWORD.',
      });
    }
    if (
      values.NODE_ENV === 'production' &&
      values.APP_PUBLIC_URL &&
      !values.APP_PUBLIC_URL.startsWith('https://')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['APP_PUBLIC_URL'],
        message: 'URL công khai cần HTTPS trong production.',
      });
    }
    if (values.NODE_ENV === 'production' && values.AUTH_ACCESS_SECRET === localAuthAccessSecret) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_ACCESS_SECRET'],
        message: 'Production phải dùng khóa JWT riêng.',
      });
    }

    if (values.NODE_ENV === 'production' && !values.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Production phải bật cookie Secure.',
      });
    }
  });

export type Environment = {
  nodeEnv: z.output<typeof environmentSchema>['NODE_ENV'];
  port: z.output<typeof environmentSchema>['PORT'];
  databaseUrl: z.output<typeof environmentSchema>['DATABASE_URL'];
  authAccessSecret: z.output<typeof environmentSchema>['AUTH_ACCESS_SECRET'];
  corsOrigins: z.output<typeof environmentSchema>['CORS_ORIGINS'];
  cookieSecure: z.output<typeof environmentSchema>['COOKIE_SECURE'];
  mediaDirectory: z.output<typeof environmentSchema>['READLITE_MEDIA_DIR'];
  aiReviewProvider: z.output<typeof environmentSchema>['AI_REVIEW_PROVIDER'];
  aiReviewApiUrl: z.output<typeof environmentSchema>['AI_REVIEW_API_URL'];
  aiReviewApiKey: z.output<typeof environmentSchema>['AI_REVIEW_API_KEY'];
  aiReviewModel: z.output<typeof environmentSchema>['AI_REVIEW_MODEL'];
  aiReviewTimeoutMs: z.output<typeof environmentSchema>['AI_REVIEW_TIMEOUT_MS'];
  aiReviewMaxChunkCharacters: z.output<typeof environmentSchema>['AI_REVIEW_MAX_CHUNK_CHARACTERS'];
  aiReviewMaxAttempts: z.output<typeof environmentSchema>['AI_REVIEW_MAX_ATTEMPTS'];
  aiReviewLeaseSeconds: z.output<typeof environmentSchema>['AI_REVIEW_LEASE_SECONDS'];
  aiReviewRetryBaseSeconds: z.output<typeof environmentSchema>['AI_REVIEW_RETRY_BASE_SECONDS'];
  aiReviewPollIntervalMs: z.output<typeof environmentSchema>['AI_REVIEW_POLL_INTERVAL_MS'];
  email?: EmailConfiguration;
};

export type EmailConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  publicUrl: string;
};

export function parseEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    const fieldList = fields.length > 0 ? fields.join(', ') : 'các giá trị cấu hình';
    throw new Error(`Cấu hình môi trường không hợp lệ tại: ${fieldList}.`);
  }

  if (result.data.NODE_ENV === 'production' && !source.READLITE_MEDIA_DIR?.trim()) {
    throw new Error('Cấu hình môi trường không hợp lệ tại: READLITE_MEDIA_DIR.');
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    authAccessSecret: result.data.AUTH_ACCESS_SECRET,
    corsOrigins: result.data.CORS_ORIGINS,
    cookieSecure: result.data.COOKIE_SECURE,
    mediaDirectory: resolve(result.data.READLITE_MEDIA_DIR),
    aiReviewProvider: result.data.AI_REVIEW_PROVIDER,
    aiReviewApiUrl: result.data.AI_REVIEW_API_URL,
    aiReviewApiKey: result.data.AI_REVIEW_API_KEY,
    aiReviewModel: result.data.AI_REVIEW_MODEL,
    aiReviewTimeoutMs: result.data.AI_REVIEW_TIMEOUT_MS,
    aiReviewMaxChunkCharacters: result.data.AI_REVIEW_MAX_CHUNK_CHARACTERS,
    aiReviewMaxAttempts: result.data.AI_REVIEW_MAX_ATTEMPTS,
    aiReviewLeaseSeconds: result.data.AI_REVIEW_LEASE_SECONDS,
    aiReviewRetryBaseSeconds: result.data.AI_REVIEW_RETRY_BASE_SECONDS,
    aiReviewPollIntervalMs: result.data.AI_REVIEW_POLL_INTERVAL_MS,
    ...(result.data.SMTP_HOST && result.data.SMTP_FROM && result.data.APP_PUBLIC_URL
      ? {
          email: {
            host: result.data.SMTP_HOST,
            port: result.data.SMTP_PORT,
            secure: result.data.SMTP_SECURE,
            user: result.data.SMTP_USER,
            password: result.data.SMTP_PASSWORD,
            from: result.data.SMTP_FROM,
            publicUrl: result.data.APP_PUBLIC_URL,
          },
        }
      : {}),
  };
}

export const env = parseEnvironment();
