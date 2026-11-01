import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grantVerifiedAccountRole, parseGrantRoleArguments } from '../accounts/grant-role.js';
import { pool } from '../db/pool.js';

async function main(): Promise<void> {
  const input = parseGrantRoleArguments(process.argv.slice(2));
  if (!input) {
    console.error(
      'Dùng: npm run account:grant-role --workspace @readlite/api -- --email <email> --role <author|admin>',
    );
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('Cần đặt DATABASE_URL rõ ràng trước khi cấp quyền tài khoản.');
    process.exitCode = 2;
    return;
  }

  try {
    const account = await grantVerifiedAccountRole(pool, input);
    if (!account) {
      console.error('Không tìm thấy tài khoản đang hoạt động đã xác minh email.');
      process.exitCode = 1;
      return;
    }
    console.info('Đã cấp quyền ' + account.role + ' cho ' + account.email + '.');
  } catch {
    console.error('Không thể cấp quyền tài khoản. Hãy kiểm tra DATABASE_URL và migration.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  void main();
}

