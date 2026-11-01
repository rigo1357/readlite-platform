import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql('ALTER TABLE stories ADD COLUMN publication_date date;');
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('ALTER TABLE stories DROP COLUMN publication_date;');
}
