# ReadLite Platform Giai đoạn 0 — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tạo repo mới có Android native, web client và REST API dùng chung PostgreSQL; cả hai client kiểm tra được kết nối đến API.

**Architecture:** Một monorepo npm cho `apps/api` và `apps/web`, cùng Gradle project cho `apps/android`. Docker Compose chạy API, web, PostgreSQL và Mailpit; Android build/chạy ngoài Compose. API dùng PostgreSQL làm nguồn dữ liệu chuẩn và áp migration trước khi nhận request.

**Tech Stack:** Android Java/XML, AGP 9.3.3, Gradle 9.5; React 18, Vite 8, TypeScript; Node.js 22.12+, Express 5, Zod, `pg`, `node-pg-migrate`; PostgreSQL 16, Nginx, Mailpit.

**Spec:** `docs/superpowers/specs/2026-10-13-readlite-platform-stage0-design.md`

## Global Constraints

- App điện thoại là Android native bằng Java/XML; min SDK 24, compile/target SDK 37.
- Web browser và Android dùng chung REST API prefix `/api/v1`.
- PostgreSQL 16 là nguồn dữ liệu chuẩn; không triển khai schema nghiệp vụ trong Giai đoạn 0.
- Android emulator mặc định gọi API ở `http://10.0.2.2:3000`; cleartext chỉ bật ở build debug.
- Compose có đúng bốn service: `api`, `web`, `postgres`, `mailpit`; Android không chạy trong Compose.
- Không sửa các dự án Android cũ; chúng chỉ là tài liệu tham khảo.
- Không thêm tính năng đăng nhập, thư viện, reader, import EPUB hoặc social trong Giai đoạn 0.

## Review Focus

- Android emulator dùng đúng host alias `10.0.2.2`, còn web browser dùng Nginx same-origin; kiểm tra cấu hình Android và proxy.
- Release build không bật cleartext; chỉ Android debug build mới được gọi API HTTP local.
- API không listen nếu migration lỗi và không lộ `DATABASE_URL`; có test ở API.
- Compose không cần `.env`, không publish PostgreSQL ra host; kiểm tra `docker compose config --quiet`.
- Lệnh API health qua Nginx giữ JSON, còn route web có SPA fallback; kiểm tra Nginx config và smoke test nếu Docker hoạt động.

---

## Task 1: Định danh monorepo và cập nhật công cụ npm

**Files:**
- Modify: `package.json`, `package-lock.json`, `docker-compose.yml`
- Modify: `.gitignore`, `.dockerignore`
- Create: `README.md`, `docs/architecture.md`

**Interfaces:**
- npm workspaces: `apps/api`, `apps/web`; Android dùng Gradle độc lập.
- Compose project name: `readlite-platform`.
- README nêu bốn service Compose, địa chỉ Android emulator và cổng web/API.

- [x] Đổi package/project name thành `readlite-platform`, thêm script gốc `test` chạy tests của workspaces hiện có, giữ Node engine `>=22.12.0`.
- [x] Thêm ignore cho `.gradle/`, `build/`, `local.properties`, APK/keystore và Android output.
- [x] Viết architecture docs mô tả Android/web → API → PostgreSQL, auth transport theo client, local API URL và phạm vi Giai đoạn 0.
- [x] Đồng bộ lockfile offline; `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build` đều qua.
- [x] Commit cấu hình workspace và tài liệu cùng phần shell tích hợp.

## Task 2: Tạo Android native shell có API health client

**Files:**
- Create: `apps/android/app/build.gradle.kts`
- Create: `apps/android/app/src/main/AndroidManifest.xml`
- Create: `apps/android/app/src/debug/AndroidManifest.xml`
- Create: `apps/android/app/src/main/java/com/readlite/mobile/MainActivity.java`
- Create: `apps/android/app/src/main/res/layout/activity_main.xml`
- Create: `apps/android/app/src/main/res/values/strings.xml`, `colors.xml`, `themes.xml`
- Modify: `apps/android/settings.gradle.kts`, `build.gradle.kts`

**Interfaces:**
- `BuildConfig.API_BASE_URL` đọc Gradle property `readliteApiBaseUrl`; debug mặc định `http://10.0.2.2:3000`.
- Màn hình có nút “Kiểm tra kết nối”; GET `/api/v1/health` chạy trên executor nền, cập nhật trạng thái bằng tiếng Việt.
- Cleartext HTTP chỉ cấu hình ở manifest debug; release mặc định HTTPS URL cấu hình riêng.

- [x] Tạo module Android `:app`, namespace/applicationId `com.readlite.mobile`, min SDK 24, compile/target SDK 37, Java 17 bytecode.
- [x] Viết layout và Activity; xử lý timeout, HTTP lỗi và JSON không hợp lệ mà không treo UI.
- [x] Cấu hình build type/API URL và quyền Internet; debug manifest cho local HTTP.
- [ ] Chạy `apps/android/gradlew.bat -p apps/android :app:assembleDebug`; xác nhận APK debug sinh ra. Chưa chạy xong: Gradle wrapper không thể tạo cache tại `C:\.gradle` trong môi trường này; chưa xác nhận APK.
- [x] Commit Android shell cùng phần shell tích hợp.

## Task 3: Nối web shell với API dùng chung

**Files:**
- Modify: `apps/web/src/App.tsx`, `apps/web/src/styles.css` nếu cần
- Verify: `apps/web/nginx.conf`, `apps/web/vite.config.ts`

**Interfaces:**
- Browser gọi `/api/v1/health` cùng origin; không hard-code host API trong production web build.
- Nginx proxy giữ nguyên `/api/v1/...`; route SPA dùng `index.html` fallback.

- [x] Hiển thị trạng thái backend ở web shell bằng request same-origin có loading/error state tiếng Việt.
- [x] Bổ sung test web cho trạng thái/health response hoặc giữ kiểm tra shell hiện có nếu API fetch không làm thay đổi server render test.
- [x] Chạy `npm run test --workspace @readlite/web`, `npm run build` và `npm run format:check`.
- [x] Commit web/API connection shell cùng phần shell tích hợp.

## Task 4: Rà soát tích hợp backend và bàn giao

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `README.md`, `docs/architecture.md` khi cần
- Verify: `apps/api`, `apps/android`, `apps/web`, `db/migrations`

**Interfaces:**
- `GET /api/v1/health` trả JSON `{ "status": "ok", "service": "api" }`.
- Compose khởi chạy API, web, Postgres 16 và Mailpit; Android emulator gọi host API port 3000.

- [x] Chạy API tests (7/7), web tests (5/5), lint, typecheck và build.
- [x] Chạy `npm run db:seed`; lệnh qua và xác nhận Giai đoạn 0 chưa có dữ liệu mẫu.
- [x] `docker compose config --quiet` qua.
- [ ] Chạy `docker compose up --build --detach --wait` và smoke test web/API/Mailpit; Docker Engine chưa chạy (`docker info` không tìm thấy `docker_engine` pipe).
- [ ] Chạy Gradle assemble debug nếu Android SDK và Gradle distribution khả dụng; wrapper hiện dừng khi tạo cache tại `C:\.gradle`.
- [x] Rà soát `git status`, chỉ gồm file trong `readlite-platform/`, commit phần tài liệu và dừng ở Giai đoạn 0.

## Tiêu chí hoàn thành

- Android debug app build được và có thể gọi API health trên emulator.
- Web mở được, health proxy trả JSON, SPA fallback hoạt động.
- API khởi động sau migration; Postgres/Mailpit có healthchecks.
- npm lint/format/typecheck/build/tests qua; Docker runtime được xác nhận hoặc ghi rõ chặn bởi môi trường.
- README và kiến trúc khớp cấu hình thực tế; chưa bắt đầu Giai đoạn 1.

## Trạng thái hiện tại

Phần source của Android/web/API và kiểm tra npm đã được triển khai. Chưa đánh dấu Giai đoạn 0 hoàn tất vì APK Android chưa build được và Compose chưa thể chạy smoke test khi Docker Engine không hoạt động. Không tự cài Android SDK hoặc bật Docker Engine trong phiên này.
