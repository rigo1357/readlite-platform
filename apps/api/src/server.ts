import { runner } from 'node-pg-migrate';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { contentReviewWorker } from './review/runtime.js';

const migrationDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations',
);

async function startServer(): Promise<void> {
  console.info('Đang chạy migration PostgreSQL.');

  try {
    await runner({
      databaseUrl: env.databaseUrl,
      dir: migrationDirectory,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      verbose: true,
    });
  } catch (error) {
    const errorCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? ' (' + error.code + ')'
        : '';
    console.error('Không thể chạy migration PostgreSQL' + errorCode + '. API sẽ dừng.');
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  console.info('Migration PostgreSQL đã hoàn tất.');
  const server = app.listen(env.port, '0.0.0.0');
  let isClosing = false;

  server.once('listening', () => {
    console.info('API đang lắng nghe tại cổng ' + env.port + '.');
    if (contentReviewWorker) {
      contentReviewWorker.start();
    } else {
      console.info('AI review chưa cấu hình; bản nháp gửi duyệt sẽ vào hàng chờ quản trị viên.');
    }
  });

  server.once('error', () => {
    console.error('Không thể khởi động API. Hãy kiểm tra cổng và cấu hình.');
    void Promise.resolve(contentReviewWorker?.stop())
      .then(() => pool.end())
      .finally(() => {
        process.exitCode = 1;
      });
  });

  function stop(signal: NodeJS.Signals): void {
    if (isClosing) return;
    isClosing = true;
    console.info('Đang dừng API sau ' + signal + '.');
    server.close((error) => {
      void (async () => {
        await contentReviewWorker?.stop().catch(() => undefined);
        await pool.end();
        if (error) {
          console.error('API dừng không hoàn tất.');
          process.exitCode = 1;
          return;
        }
        console.info('API đã dừng.');
      })().catch(() => {
        console.error('Không thể đóng API hoặc kết nối PostgreSQL.');
        process.exitCode = 1;
      });
    });
  }

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}

void startServer().catch(async () => {
  console.error('Không thể khởi động API. Hãy kiểm tra cấu hình môi trường và migration.');
  await contentReviewWorker?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
