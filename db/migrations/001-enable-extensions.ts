import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.createExtension(['citext', 'pg_trgm', 'unaccent'], { ifNotExists: true });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropExtension(['unaccent', 'pg_trgm', 'citext'], { ifExists: true });
}
