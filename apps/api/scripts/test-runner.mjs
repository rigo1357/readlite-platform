import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, '..');
const testDirectory = resolve(apiDirectory, 'test');

export function isReadliteTestDatabase(databaseUrl) {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    return false;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
    return databaseName === 'readlite_test';
  } catch {
    return false;
  }
}

function main() {
  const mode = process.argv[2];
  if (mode !== 'unit' && mode !== 'all') {
    process.stderr.write('Dùng: node scripts/test-runner.mjs <unit|all>\n');
    process.exitCode = 2;
    return;
  }

  if (mode === 'all' && !isReadliteTestDatabase(process.env.DATABASE_URL)) {
    process.stderr.write(
      'Từ chối chạy bộ test có PostgreSQL: hãy đặt DATABASE_URL trỏ chính xác tới database readlite_test. Không có test nào được chạy.\n',
    );
    process.exitCode = 2;
    return;
  }

  const testFiles = readdirSync(testDirectory)
    .filter((fileName) => fileName.endsWith('.mjs'))
    .filter((fileName) => mode === 'all' || fileName !== 'api.test.mjs')
    .sort()
    .map((fileName) => resolve(testDirectory, fileName));

  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-concurrency=1', ...testFiles],
    {
      cwd: apiDirectory,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'inherit',
      shell: false,
    },
  );

  if (child.error) {
    process.stderr.write('Không khởi chạy được bộ test API.\n');
    process.exitCode = 1;
    return;
  }

  process.exitCode = child.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
