import type { MigrationBuilder } from 'node-pg-migrate';

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION readlite_prevent_submitter_self_review()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      reviewer_role text;
    BEGIN
      IF NEW.visibility <> 'public'
         OR NEW.moderation_status <> 'published'
         OR NEW.submitted_by IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.ai_review_status NOT IN ('passed', 'warnings', 'skipped') THEN
        RAISE EXCEPTION 'Truyện cần hoàn tất rà soát hoặc được chuyển sang duyệt thủ công.'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'Truyện cần quản trị viên duyệt trước khi xuất bản.'
          USING ERRCODE = '23514';
      END IF;

      SELECT role INTO reviewer_role FROM users WHERE id = NEW.reviewed_by;

      IF reviewer_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được duyệt truyện.'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $function$;

  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION readlite_prevent_submitter_self_review()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      submitter_role text;
      reviewer_role text;
    BEGIN
      IF NEW.visibility <> 'public'
         OR NEW.moderation_status <> 'published'
         OR NEW.submitted_by IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.ai_review_status NOT IN ('passed', 'warnings') THEN
        RAISE EXCEPTION 'Truyện phải hoàn tất rà soát AI trước khi xuất bản.'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'Truyện cần quản trị viên duyệt trước khi xuất bản.'
          USING ERRCODE = '23514';
      END IF;

      SELECT role INTO submitter_role FROM users WHERE id = NEW.submitted_by;
      SELECT role INTO reviewer_role FROM users WHERE id = NEW.reviewed_by;

      IF reviewer_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được duyệt truyện.'
          USING ERRCODE = '23514';
      END IF;

      IF submitter_role = 'admin' AND NEW.reviewed_by = NEW.submitted_by THEN
        RAISE EXCEPTION 'Quản trị viên không được tự duyệt truyện của mình.'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $function$;

  `);
}
