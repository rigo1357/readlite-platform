import { z } from 'zod';

export type GrantedRole = 'author' | 'admin';

export type GrantRoleInput = {
  email: string;
  role: GrantedRole;
};

export type GrantedAccount = {
  id: string;
  email: string;
  role: GrantedRole;
};

export interface GrantRoleDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

const grantRoleSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['author', 'admin']),
});

export function parseGrantRoleArguments(args: string[]): GrantRoleInput | null {
  if (args.length !== 4) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--email', '--role'].includes(name) || !value || values.has(name)) {
      return null;
    }
    values.set(name, value);
  }
  const parsed = grantRoleSchema.safeParse({
    email: values.get('--email'),
    role: values.get('--role'),
  });
  return parsed.success ? parsed.data : null;
}

export async function grantVerifiedAccountRole(
  database: GrantRoleDatabase,
  input: GrantRoleInput,
): Promise<GrantedAccount | null> {
  const target = grantRoleSchema.parse(input);
  const result = await database.query<GrantedAccount>(
    `UPDATE users
     SET role = $1, updated_at = now()
     WHERE email = $2
       AND is_active = true
       AND email_verified_at IS NOT NULL
     RETURNING id::text AS id, email::text AS email, role`,
    [target.role, target.email],
  );
  return result.rows[0] ?? null;
}
