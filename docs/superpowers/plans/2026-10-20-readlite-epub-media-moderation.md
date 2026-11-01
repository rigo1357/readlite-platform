# ReadLite EPUB, Ảnh và Kiểm duyệt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép tác giả/quản trị viên tải EPUB thành bản nháp trên API, giữ bìa và ảnh chương, sửa/xem trước mục lục, gửi AI rà soát, rồi chờ quản trị viên duyệt trước khi xuất bản vào catalog chung.

**Architecture:** PostgreSQL lưu metadata, cấu trúc tập/chương, trạng thái duyệt và tham chiếu media; EPUB gốc cùng ảnh nằm trong kho file riêng sau interface lưu trữ. API phân tích EPUB 2/3 ở server, biến XHTML thành các block nội dung cho Android, phân quyền truy cập media theo chủ sở hữu/trạng thái xuất bản, và fail closed khi AI chưa được cấu hình. Android chọn file bằng Storage Access Framework, upload dạng streaming, xem trước và cung cấp hàng đợi quản trị.

**Tech Stack:** Node.js 22, TypeScript, Express 5, PostgreSQL, Busboy, yauzl, fast-xml-parser, parse5, Android Java/XML, JUnit, Node `node:test`.

**Spec:** [`docs/superpowers/specs/2026-10-20-readlite-android-library-ui-design.md`](../specs/2026-10-20-readlite-android-library-ui-design.md)

## Global Constraints

- Chỉ tác giả và quản trị viên được tạo bản nháp EPUB; người đọc thường không thấy nút gửi truyện.
- Không EPUB nào được xuất hiện công khai trước khi AI rà soát hoàn tất và quản trị viên duyệt.
- AI chỉ trả kết quả/cảnh báo; không tự quyết định xuất bản.
- Truyện do quản trị viên gửi phải được một quản trị viên khác duyệt.
- EPUB gốc, ảnh và XHTML không lưu trong PostgreSQL, repository, seed hoặc thư mục public tùy ý.
- Ảnh bìa thay thế chỉ nhận JPEG, PNG hoặc WebP tối đa 10 MiB; SVG và ảnh ngoài allowlist bị từ chối.
- API làm sạch XHTML thành block; Android không chạy script, CSS hoặc link điều hướng lấy từ EPUB.
- Draft/media riêng chỉ người gửi và quản trị viên được xem; media đã duyệt theo quyền hiển thị truyện.
- Mọi endpoint upload, preview, media riêng và duyệt đều kiểm tra session, role, ownership và CSRF khi ghi.
- Giới hạn mặc định đề xuất: EPUB nén tối đa 100 MiB, giải nén tối đa 500 MiB, tối đa 5.000 entries, mỗi entry tối đa 32 MiB; đưa vào config và kiểm tra trước khi lưu dữ liệu lâu dài.
- Không ghi token, cookie, nội dung chương đầy đủ hoặc đường dẫn chứa bí mật vào log.

## Review Focus

- ZIP chứa đường dẫn tuyệt đối, `..`, entry trùng tên, ZIP bomb hoặc file bị mã hóa phải bị từ chối và không để lại file rác. Kiểm tra trong Task 2–3.
- OPF/NCX/XHTML sai cú pháp, sai encoding, thiếu spine hoặc mục lục hỏng phải trả cảnh báo/lỗi có thể hiểu; không tạo chương rỗng. Kiểm tra trong Task 3.
- XHTML chứa script, style, iframe, link ngoài hoặc ảnh ngoài không được thực thi/tải; chỉ văn bản định dạng cơ bản và media ReadLite được render. Kiểm tra trong Task 3 và Task 8.
- Người khác không được đọc EPUB/bìa/ảnh của draft; quản trị viên không tự duyệt truyện do mình gửi. Kiểm tra trong Task 4–6.
- AI chưa cấu hình, lỗi hoặc timeout phải giữ draft và không được đánh dấu đã qua AI/cho phép xuất bản. Kiểm tra trong Task 5.

---

### Task 1: Migration cho tác giả, tập/chương, media và kiểm duyệt

**Files:**
- Create: `db/migrations/003-story-submissions-media.ts`
- Modify: `apps/api/src/db/seed.ts` chỉ khi dữ liệu quyền demo cần vai trò tác giả
- Test: `apps/api/test/story-submissions.test.mjs`
- Test: `apps/api/test/api.test.mjs`

**Interfaces:**
- Consumes: schema 002 hiện tại (`users`, `stories`, `chapters`, `visibility`, owner).
- Produces:
  - `users.role` cho phép `author` bên cạnh user/admin.
  - `volumes(id, story_id, volume_order, title)`; `chapters.volume_id` nullable.
  - `stories.moderation_status`: `draft | ai_review_pending | admin_review_pending | changes_requested | rejected | published`; `submitted_by`, `ai_review_status`, `ai_review_warnings`, `reviewed_by`, `reviewed_at`, `review_reason`.
  - `media_assets(id, story_id, chapter_id, owner_id, storage_key, media_kind, mime_type, byte_size, sha256)`, trong đó `media_kind` là `epub | cover | image`.
  - `story_review_events(id, story_id, actor_id, action, details, created_at)` để lưu lịch sử gửi, kết quả AI và quyết định quản trị.
  - `story_review_jobs(id, story_id, status, attempts, available_at, locked_at, last_error)` làm hàng đợi bền vững để khởi động lại API không làm mất lượt AI rà soát.

- [x] **Step 1: Viết migration/API test** cho status mặc định của truyện cũ, truyện public hiện có, FK media, volume tùy chọn và chặn trạng thái không hợp lệ.
- [ ] **Step 2: Chạy migration trên database test chuyên biệt** và xác nhận rollback/upgrade không làm mất truyện hoặc chapter hiện có.
- [x] **Step 3: Thêm migration `003-story-submissions-media.ts`** với các check constraints, index theo `moderation_status` và khóa ngoại; truyện public cũ được đánh dấu `published`, không đổi kết quả catalog.
- [x] **Step 4: Cập nhật seed chỉ dùng metadata tổng hợp**; không thêm nội dung EPUB thật.
- [ ] **Step 5: Chạy API typecheck, lint và test với guard `DATABASE_URL.EndsWith('/readlite_test')`**; các bảng mới chỉ xuất hiện ở test DB.

### Task 2: Kho media riêng và upload multipart có giới hạn

**Files:**
- Create: `apps/api/src/storage/media-storage.ts`
- Create: `apps/api/src/storage/local-media-storage.ts`
- Create: `apps/api/src/routes/uploads.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Test: `apps/api/test/uploads.test.mjs`

**Interfaces:**
- Consumes: `MediaAsset` metadata từ Task 1 và cấu hình `MEDIA_STORAGE_PATH`.
- Produces:
  - `MediaStorage.put(key: string, input: Readable, mimeType: string): Promise<void>`
  - `MediaStorage.open(key: string): Promise<Readable | null>`
  - `MediaStorage.delete(key: string): Promise<void>`
  - `POST /api/v1/author/stories/import-epub` nhận đúng một multipart field `file`; stream vào staging riêng, enforce giới hạn trước khi tạo draft.
  - `POST /api/v1/author/stories/:storyId/cover` nhận một ảnh bìa cho draft đang thuộc owner; giới hạn 10 MiB và MIME raster allowlist.

- [ ] **Step 1: Viết test multipart** cho EPUB thiếu/nhiều file, cover không được phép/quá 10 MiB, file EPUB > 100 MiB, field sai, session thiếu và role user thường.
- [x] **Step 2: Thêm upload handler streaming bằng Busboy** với giới hạn tổng request/size; trả mã lỗi ổn định như `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `AUTH_REQUIRED`, không đọc cả EPUB vào RAM.
- [x] **Step 3: Thêm `MediaStorage` và local adapter** ghi bằng khóa ngẫu nhiên trong thư mục cấu hình ngoài public root; loại trừ thư mục media/staging khỏi git; không dùng tên file do client gửi làm đường dẫn.
- [x] **Step 4: Kiểm tra chữ ký ZIP/EPUB, MIME và cấu hình đường dẫn lưu trữ**; xóa staging khi parser/DB lỗi và không để file nửa chừng.
- [x] **Step 5: Chạy test upload**; xác nhận file thử nghiệm không nằm trong git, public static directory hoặc PostgreSQL.

### Task 3: Parser EPUB 2/3 và nội dung block an toàn

**Files:**
- Create: `apps/api/src/epub/epub-limits.ts`
- Create: `apps/api/src/epub/epub-parser.ts`
- Create: `apps/api/src/epub/epub-types.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Test: `apps/api/test/epub-parser.test.mjs`
- Test fixtures: `apps/api/test/fixtures/epub/` (synthetic only; không dùng hai EPUB thật)

**Interfaces:**
- Consumes: `parseEpub(epubPath: string, limits: EpubLimits): Promise<ParsedEpub>`.
- Produces:
  - `ParsedEpub.metadata` gồm title, creator, language; `coverPath`; `volumes[]`; `warnings[]`.
  - `ParsedVolume { title, order, chapters[] }`; `ParsedChapter { title, order, sourcePaths[], blocks[], wordCount }`.
  - `ParsedReaderBlock = {type:'text', kind:'paragraph'|'heading'|'quote', runs:[{text,bold,italic}]} | {type:'image', archivePath, altText, caption:null|string}`.
  - `StoredMedia { mediaId: string; storageKey: string; mimeType: string; byteSize: number; sha256: string }`.
  - `extractReferencedMedia(epubPath: string, archivePaths: string[], storage: MediaStorage): Promise<Map<string, StoredMedia>>`; chỉ giải nén bìa/ảnh đã được parser xác thực.

- [x] **Step 1: Tạo EPUB fixtures tối thiểu trong test**: EPUB 2 + NCX, EPUB 3 + nav, nhiều spine item dưới cùng một mục lục, bìa và ảnh giữa chương; thêm fixtures lỗi traversal, XML lỗi, spine thiếu, ảnh ngoài.
- [x] **Step 2: Viết test parser** cho thứ tự OPF spine, nhóm các XHTML tách nhỏ theo NCX/nav, fallback một chương mỗi spine item, văn bản tiếng Việt, sửa metadata sau này, vị trí ảnh và cảnh báo mục lục thiếu.
- [ ] **Step 3: Chạy** `npm run test --workspace @readlite/api` với `readlite_test`; test parser mới phải lỗi trước khi triển khai.
- [x] **Step 4: Cài `yauzl`, `fast-xml-parser`, `parse5`**; duyệt ZIP ở chế độ lazy, kiểm tra tên entry và tổng dung lượng giải nén, đọc container/OPF/NCX/nav và parse XHTML theo allowlist.
- [x] **Step 5: Chỉ sinh text/heading/quote/image blocks**; loại bỏ script/style/iframe/form/object, bỏ link điều hướng và ảnh URL ngoài, chuẩn hóa entity/encoding; giữ inline bold/italic thành runs.
- [x] **Step 6: Chạy bộ test parser**; mỗi lỗi archive phải trả lỗi/warning có mã rõ, không tạo file ngoài thư mục staging.

### Task 4: Tạo draft, sửa metadata và kiểm soát quyền media

**Files:**
- Create: `apps/api/src/services/story-import-service.ts`
- Create: `apps/api/src/routes/story-submissions.ts`
- Create: `apps/api/src/routes/media.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/test/story-submissions.test.mjs`

**Interfaces:**
- Consumes: `ParsedEpub`, `MediaStorage`, authenticated user và schema Task 1.
- Produces:
  - `POST /api/v1/author/stories/import-epub` trả `{story, preview, warnings}` với `moderationStatus:'draft'`.
  - `PATCH /api/v1/author/stories/:storyId` cập nhật title, author, summary, language, genreIds, coverMediaId, tên tập/chương và thứ tự chương khi chủ draft sửa.
  - `POST /api/v1/author/stories/:storyId/cover` upload ảnh bìa thay thế; chỉ owner của draft hoặc admin được phép.
  - `GET /api/v1/author/stories?status=all|draft|pending|published` liệt kê các truyện do người đang đăng nhập gửi; `pending` gồm AI/admin review và changes requested.
  - `GET /api/v1/author/stories/:storyId` trả preview draft; chỉ owner/admin được xem.
  - Media URL nội bộ `/api/v1/media/:mediaId`; chưa công khai thì chỉ owner/admin được đọc. EPUB gốc luôn private; chỉ bìa/ảnh của truyện đã public mới mở cho catalog.

- [x] **Step 1: Viết API tests**: author import hợp lệ, admin import hợp lệ, user thường bị 403, owner xem/sửa draft, user khác bị 404/403, file parser lỗi không tạo story.
- [ ] **Step 2: Chạy test với database `readlite_test`** và xác nhận permissions fail trước khi thêm route/service.
- [x] **Step 3: Cài luồng import trong transaction DB**: lưu EPUB gốc và media được tham chiếu qua `extractReferencedMedia`, tạo story draft/volume/chapter, thay archivePath bằng mediaId, lưu metadata và review event; nếu thất bại xóa object đã ghi.
- [x] **Step 4: Thêm danh sách Truyện của tôi** qua `GET /api/v1/author/stories`; chỉ trả các truyện do tài khoản hiện tại gửi. Hàng đợi quản trị dùng endpoint riêng ở Task 5.
- [x] **Step 5: Thêm metadata editor** với validation Zod; cho phép sửa ngôn ngữ/title/author/summary, chọn ảnh bìa riêng, sắp xếp/bỏ/đổi tên chương trước khi gửi. Bản thảo nhập thủ công có thể sửa metadata, bìa và thêm/xóa/đổi tên/sắp xếp chương; EPUB lấy metadata/bìa/nội dung từ file và chỉ cho sửa tên/thứ tự tập/chương, giữ nguyên nội dung và ảnh nhúng.
- [x] **Step 6: Thêm media read authorization**: draft check owner/admin; published chỉ trả media gắn với story public; mọi đường dẫn được resolve từ `storage_key` nội bộ, không từ query/path do client cung cấp.
- [ ] **Step 7: Chạy API tests và kiểm tra catalog**; draft không xuất hiện trong tìm kiếm, rankings, genres count hoặc endpoint detail công khai.

### Task 5: AI review provider và state machine duyệt

**Files:**
- Create: `apps/api/src/review/content-review-provider.ts`
- Create: `apps/api/src/review/content-review-service.ts`
- Create: `apps/api/src/review/content-review-worker.ts`
- Create: `apps/api/src/routes/admin-review.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/catalog.ts`
- Test: `apps/api/test/story-review.test.mjs`

**Interfaces:**
- Consumes: draft/chapter blocks và `ContentReviewProvider.reviewChapter(input: { storyId: string; chapterId: string; title: string; textChunk: string; chunkIndex: number }): Promise<{ warnings: Array<{ code: string; severity: string; note: string }> }>`.
- Produces:
  - `POST /api/v1/author/stories/:storyId/submit` ghi job vào `story_review_jobs`, trả 202/`ai_review_pending`; chỉ worker đánh dấu review hoàn tất.
  - Worker chia văn bản theo cấu hình giới hạn, claim job với `FOR UPDATE SKIP LOCKED` và lease; sau khi mọi chương hoàn tất, lưu warnings/event rồi chuyển `admin_review_pending`.
  - Provider chưa cấu hình trả `AI_REVIEW_UNAVAILABLE` và giữ draft; lỗi/timeout có retry giới hạn, sau đó giữ draft với `ai_review_status='failed'`; chỉ người gửi được gửi lại.
  - `GET /api/v1/admin/story-submissions?status=admin_review_pending`, `GET /api/v1/admin/story-submissions/:storyId`, `POST /api/v1/admin/story-submissions/:storyId/decision` nhận `approve | reject | changes_requested` cùng reason.
  - Reviewer không được bằng `submitted_by`; cảnh báo AI không tự chặn hoặc tự duyệt. Approve mới chuyển `visibility='public'` và `moderation_status='published'`; `changes_requested` được sửa/gửi AI lại, `rejected` là trạng thái kết thúc.

- [ ] **Step 1: Viết test state machine** cho AI warnings đến hàng đợi admin, provider thiếu/lỗi không qua được, author không duyệt, user không vào hàng đợi, admin không tự duyệt truyện mình tạo, retry, reason và review events.
- [ ] **Step 2: Chạy test API trên `readlite_test`**; xác nhận test cho admin tự duyệt và AI fail thất bại trước khi triển khai.
- [ ] **Step 3: Cài provider interface, service và worker PostgreSQL**; test provider giả chỉ được inject trong test; production không tự coi lỗi hoặc kết quả rỗng là “clear”.
- [x] **Step 4: Chặn gửi khi provider chưa cấu hình thật**; trả `AI_REVIEW_UNAVAILABLE`, giữ draft; đọc provider/model/secret từ environment, không yêu cầu người dùng dán secret vào chat, không log nội dung chương.
- [x] **Step 5: Cài transaction decision**: kiểm tra role/CSRF/submitter khác reviewer; yêu cầu reason khi reject/changes_requested; chỉ approve mới public hóa story và bìa/ảnh, EPUB gốc luôn private.
- [ ] **Step 6: Chạy API typecheck/lint/test**; xác nhận job phục hồi sau khi restart API và mọi trạng thái được kiểm tra cả thành công lẫn lỗi.
### Task 6: API catalog trả tập/chương và reader blocks tương thích

**Files:**
- Modify: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/test/api.test.mjs`
- Modify: `apps/api/test/story-submissions.test.mjs`

**Interfaces:**
- Consumes: dữ liệu story đã publish, volumes/chapters/media.
- Produces:
  - Chapter DTO bổ sung `volumeId`, `volumeTitle`, `blocks`; image block dùng `mediaId` và URL nội bộ thay cho `archivePath`; vẫn giữ `content` plain text cho truyện cũ để client đang dùng không hỏng.
  - `blocks` dùng đúng `ReaderBlock` client DTO: `{type:'text', kind, runs}` hoặc `{type:'image', mediaId, url, altText, caption}`; URL ảnh là đường dẫn media ReadLite.
  - TOC giữ thứ tự volume rồi chapter; truyện legacy không có volume tiếp tục trả danh sách chapter phẳng.

- [ ] **Step 1: Viết API tests** cho catalog chỉ hiện published story, volume/chapter order, ảnh ở đúng vị trí block, legacy content fallback, và draft detail bị từ chối.
- [ ] **Step 2: Chạy test test DB**; response hiện tại phải không có các trường mới.
- [x] **Step 3: Mở rộng truy vấn và DTO**; chỉ trả story khi `visibility='public'` và `moderation_status='published'`, không đổi các tên trường Android đang dùng.
- [ ] **Step 4: Chạy toàn bộ API tests**; test cũ về search/ranking/chapter vẫn qua, chapter EPUB có block image, chapter legacy vẫn có content.

### Task 7: Android chọn EPUB, upload, xem trước và hàng đợi quản trị

**Files:**
- Create: `apps/android/app/src/main/java/com/readlite/mobile/StorySubmissionActivity.java`
- Create: `apps/android/app/src/main/java/com/readlite/mobile/StorySubmissionApiClient.java`
- Create: `apps/android/app/src/main/res/layout/activity_story_submission.xml`
- Create: `apps/android/app/src/main/java/com/readlite/mobile/AdminReviewActivity.java`
- Create: `apps/android/app/src/main/res/layout/activity_admin_review.xml`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/AccountActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/StoryDetailActivity.java`
- Modify: `apps/android/app/src/main/res/layout/activity_story_detail.xml`
- Modify: `apps/android/app/src/main/AndroidManifest.xml`
- Test: `apps/android/app/src/test/java/com/readlite/mobile/StorySubmissionApiClientTest.java`

**Interfaces:**
- Consumes: upload/preview/edit/submit/admin APIs từ Task 2, 4, 5.
- Produces: SAF `ACTION_OPEN_DOCUMENT` chọn EPUB; photo picker chọn ảnh bìa; multipart stream từ `ContentResolver`; preview có cover, metadata, volume/chapter list, ảnh và warnings; chi tiết truyện hiển thị TOC lồng theo tập; menu chỉ hiện theo role.

- [ ] **Step 1: Viết test cho request builder/response mapping**: MIME, tên file không tin cậy, lỗi 413, parser warning, AI unavailable và status pending.
- [x] **Step 2: Thêm menu tài khoản theo role**: author thấy Truyện của tôi/Gửi truyện; admin thấy Hàng đợi duyệt; user thường không thấy hai mục.
- [x] **Step 3: Dùng SAF chọn file**; upload streaming trên executor/background thread, hiển thị tiến độ/hủy, không đọc toàn bộ file vào byte array.
- [x] **Step 4: Dựng preview/editor** có bìa thay thế từ photo picker, metadata có thể sửa, ngôn ngữ sửa tay, tập/chương, ảnh nhúng và cảnh báo; giữ draft khi lỗi mạng.
- [x] **Step 5: Dựng hàng đợi/detail admin** hiển thị chapter preview, ảnh, cảnh báo AI, người gửi; các quyết định yêu cầu reason phù hợp, không hiện nút duyệt cho chính người gửi-admin.
- [ ] **Step 6: Chạy unit tests, build debug và emulator flow** với author, admin, user thường; menu/endpoint đều phải chặn role sai.

### Task 8: Reader native render ảnh và TOC theo tập

**Files:**
- Create: `apps/android/app/src/main/java/com/readlite/mobile/ReaderBlockAdapter.java`
- Create: `apps/android/app/src/main/res/layout/item_reader_text_block.xml`
- Create: `apps/android/app/src/main/res/layout/item_reader_image_block.xml`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/ChapterReaderActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/StoryDetailActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java`
- Modify: `apps/android/app/src/main/res/layout/activity_chapter_reader.xml`
- Modify: `apps/android/app/src/main/res/layout/activity_story_detail.xml`
- Test: `apps/android/app/src/test/java/com/readlite/mobile/ReaderBlockAdapterTest.java`

**Interfaces:**
- Consumes: `GET /api/v1/stories/:storyId/chapters`, `GET /api/v1/stories/:storyId/chapters/:chapterId`, DTO `blocks` và API origin hiện tại.
- Produces: chapter DTO client `{volumeId, volumeTitle, blocks}`; block text `{type:'text', kind, runs:[{text,bold,italic}]}`; block ảnh `{type:'image', mediaId, url, altText, caption}`. TOC nhóm tập/chương theo thứ tự; chapter cũ không có tập vẫn hiển thị phẳng.

- [ ] **Step 1: Viết test mapping** cho text run, bold/italic, heading, quote, ảnh alt/caption, field thiếu và URL ngoài API.
- [ ] **Step 2: Chạy unit tests Android**; mapper phải từ chối scheme/host ảnh không thuộc API origin đã cấu hình.
- [x] **Step 3: Render block theo thứ tự API** bằng native TextView/ImageView; ảnh có loading/error placeholder, decode theo kích thước view, alt text có thể truy cập; không dùng WebView.
- [x] **Step 4: Dựng TOC lồng theo tập ở chi tiết và Reader**; chọn chapter đúng ID; truyện legacy vẫn hiển thị danh sách phẳng.
- [x] **Step 5: Giữ A−/A+ và progress khi ảnh tải**; tính vị trí cuộn sau khi block ảnh hoàn tất layout; nội dung legacy chỉ có `content` tiếp tục hiển thị như trước.
- [ ] **Step 6: Chạy unit tests/build và mở truyện legacy cùng EPUB trên emulator**; không có HTML/CSS thô, script hoặc điều hướng trình duyệt ngoài.
### Task 9: Kiểm tra mẫu EPUB và điều kiện phát hành

**Files:**
- Review only: `24264.epub` và `24218.epub` tại Downloads nếu còn sẵn
- Review only: toàn bộ API/Android files của Task 1–8
- Modify only if needed: `docs/README.md` hoặc hướng dẫn chạy local API

**Interfaces:**
- Consumes: bản debug, API local, provider AI đã được cấu hình riêng và hai file EPUB người dùng cung cấp.
- Produces: kết quả kiểm thử parser/reader/moderation có thể lặp lại; không sao chép binary hoặc truyện vào repo.

- [ ] **Step 1: Xác nhận test database là `readlite_test` trước migration/test**; không chạy test trên database local dùng dữ liệu cá nhân.
- [ ] **Step 2: Chạy API typecheck/lint/tests và Android unit tests/build**; tất cả phải qua.
- [ ] **Step 3: Dùng hai EPUB mẫu qua bộ chọn trong app**; đối chiếu title/language có thể sửa, cover, thứ tự TOC, nhóm XHTML chia nhỏ, cảnh báo metadata và ảnh trong chương.
- [ ] **Step 4: Kiểm tra an ninh bằng EPUB hỏng/traversal/quá lớn và ảnh remote/script**; request thất bại an toàn, xóa staging, media draft không đọc được bằng tài khoản khác.
- [ ] **Step 5: Kiểm tra role workflow**: author gửi → AI cảnh báo → admin khác duyệt → catalog công khai; admin gửi → một admin khác duyệt; AI chưa cấu hình → draft giữ nguyên, không công khai.
- [ ] **Step 6: Kiểm tra `git diff --check` và `git status`**; giữ hai EPUB ngoài repo, không stage/commit các thay đổi có sẵn của người dùng.

## Dependency Gate: AI provider

Thiết kế chưa chọn nhà cung cấp AI. Trước Task 5 cần chọn provider/model và cấu hình secret ở môi trường chạy API. Không cần gửi secret trong chat. Khi chưa có cấu hình, API giữ bản nháp và báo AI chưa sẵn sàng; không dùng kết quả giả để cho phép duyệt/xuất bản.
