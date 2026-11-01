# ReadLite Android Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện luồng Android đã duyệt: Khám phá, Xếp hạng, Tủ sách, Tài khoản, chi tiết truyện và Reader; thao tác đọc, lưu truyện, theme và điều hướng hoạt động xuyên suốt.

**Architecture:** Tiếp tục dùng Java/XML và các Activity hiện có, gọi API PostgreSQL làm nguồn dữ liệu chính. Kế hoạch bắt đầu từ working tree hiện tại: kiểm tra thay đổi trước khi sửa, hoàn thiện các luồng còn thiếu và giữ lại phần đã làm đúng; không tạo lại màn hình từ đầu. Reader dùng lớp hiển thị nội dung có thể mở rộng để kế hoạch nhập EPUB bổ sung ảnh mà không thay hợp đồng tiến độ.

**Tech Stack:** Android Java 17, XML, AppCompat/Material, HttpURLConnection, Node.js 22, TypeScript, Express 5, PostgreSQL, JUnit, Node `node:test`, Espresso.

**Spec:** [`docs/superpowers/specs/2026-10-20-readlite-android-library-ui-design.md`](../specs/2026-10-20-readlite-android-library-ui-design.md)

## Global Constraints

- Điều hướng gốc có đúng bốn mục: Khám phá, Xếp hạng, Tủ sách, Tài khoản.
- Thẻ truyện và tên truyện mở được chi tiết; mọi màn hình con có nút quay lại rõ ràng.
- Không để tiêu đề hoặc nội dung bị system bar che; vùng bấm tối thiểu 48 dp.
- Dùng dữ liệu thật từ API; không dựng điểm, số lượt đọc hoặc thứ hạng giả.
- Tủ sách và tiến độ đọc lấy từ API; truyện yêu thích cần trạng thái tim bật/tắt.
- Theme sáng/tối áp dụng toàn app và lưu qua lần mở lại.
- Giữ nguyên các thay đổi đã có của người dùng; không chép EPUB hoặc nội dung truyện mẫu vào repo/seed.
- Không ghi mật khẩu, cookie phiên, CSRF hoặc token vào log.

## Review Focus

- Phiên thiếu/hết hạn ở tủ sách hoặc thao tác yêu thích phải hiện trạng thái đăng nhập cần thiết, không crash. Kiểm tra trong Task 4.
- Truyện thiếu bìa, thiếu số liệu hoặc có trường null phải có ảnh thay thế và nhãn an toàn. Kiểm tra trong Task 3.
- Danh mục rỗng hoặc API lỗi không được hiển thị thứ hạng giả; phải có trạng thái rỗng/lỗi và thử lại. Kiểm tra trong Task 3.
- Tiến độ server ngoài khoảng hợp lệ hoặc chương đã bị xóa phải được xử lý an toàn. Kiểm tra trong Task 5.
- Bàn phím mở, xoay màn hình hoặc đổi theme không được che nội dung hay làm mất màn hình đang chọn. Kiểm tra trong Task 2 và Task 6.

---

### Task 1: Rà soát thay đổi hiện tại và khóa hợp đồng dữ liệu Android

**Files:**
- Review only: `apps/android/app/src/main/java/com/readlite/mobile/CatalogActivity.java`
- Review only: `apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java`
- Review only: `apps/android/app/src/main/java/com/readlite/mobile/StoryCardAdapter.java`
- Review only: `apps/api/src/routes/catalog.ts`
- Review only: `apps/api/src/routes/library.ts`

**Interfaces:**
- Consumes: các API hiện có `GET /api/v1/stories`, `GET /api/v1/genres`, `GET /api/v1/stories/:storyId`, `GET /api/v1/stories/:storyId/chapters`, favorites và reading progress.
- Produces: danh sách trường Android cần dùng thống nhất: `id`, `title`, `author`, `coverUrl`, `ratingAvg`, `ratingCount`, `totalChapters`; ghi nhận phần nào đã hoạt động trước khi sửa.

- [ ] **Step 1: Đọc working tree và chạy kiểm tra nền hiện có**. Không reset, checkout hoặc ghi đè file đang sửa.
- [ ] **Step 2: Ghi lại từng luồng còn lỗi bằng thao tác có thể lặp lại**: đăng nhập về Khám phá, chọn tab, mở truyện, yêu thích, đổi theme, chọn chương và khôi phục tiến độ.
- [ ] **Step 3: Bổ sung `StorySummary` chỉ nếu adapter hiện chưa có ánh xạ an toàn** tại `apps/android/app/src/main/java/com/readlite/mobile/StorySummary.java`; `StorySummary.fromJson(JSONObject)` phải chuẩn hóa chuỗi rỗng và số liệu thiếu.
- [ ] **Step 4: Viết `StorySummaryTest`** trong `apps/android/app/src/test/java/com/readlite/mobile/StorySummaryTest.java`, gồm JSON đầy đủ, bìa null, rating null và object thiếu tên.
- [ ] **Step 5: Chạy** `.gradlew.bat :app:testDebugUnitTest` trong `apps/android`; mapper mới phải qua kiểm tra mà không sửa dữ liệu mẫu.
- [ ] **Step 6: Ghi trong phần tổng kết triển khai những lỗi được tái hiện và màn hình đã hoạt động sẵn** để các task sau chỉ sửa phần còn thiếu.

### Task 2: Điều hướng bốn khu vực, quay lại và system bar insets

**Files:**
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/MainActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/CatalogActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/SystemBarInsets.java`
- Modify: `apps/android/app/src/main/res/menu/catalog_bottom_menu.xml`
- Modify: `apps/android/app/src/main/res/layout/activity_catalog.xml`
- Modify: `apps/android/app/src/main/AndroidManifest.xml`
- Test: `apps/android/app/src/androidTest/java/com/readlite/mobile/MainNavigationTest.java`

**Interfaces:**
- Consumes: `StorySummary` và các Activity hiện có.
- Produces: mục điều hướng `catalog_nav_explore`, `catalog_nav_rankings`, `catalog_nav_bookshelf`, `catalog_nav_account`; Activity con kết thúc bằng `finish()` để Back trở về đúng màn hình gọi.

- [ ] **Step 1: Viết kiểm tra điều hướng** cho bốn mục, Activity con và trạng thái đã chọn của tab.
- [ ] **Step 2: Chạy** `.gradlew.bat :app:connectedDebugAndroidTest`; xác nhận kiểm tra mới lỗi khi một tab chưa nối đúng Activity.
- [ ] **Step 3: Hoàn thiện listener của bottom navigation** để Khám phá và Xếp hạng dùng catalog hiện tại, Tủ sách mở `BookshelfActivity`, Tài khoản mở `AccountActivity`; tránh tạo nhiều bản sao Activity khi đổi tab.
- [ ] **Step 4: Áp dụng `SystemBarInsets` cho màn hình gốc, tài khoản, tủ sách và màn hình con**; khi bàn phím mở, ô tìm kiếm vẫn nhìn thấy và cuộn tới được.
- [ ] **Step 5: Chạy lại kiểm tra instrumentation**; Back ở chi tiết/Reader phải quay về đúng tab ban đầu, không thoát app ngoài ý muốn.
- [ ] **Step 6: Chạy** `.gradlew.bat :app:testDebugUnitTest :app:assembleDebug`; cả hai phải thành công.

### Task 3: Khám phá, xếp hạng, tìm kiếm và bìa truyện

**Files:**
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/CatalogActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/StoryCardAdapter.java`
- Modify: `apps/android/app/src/main/res/layout/activity_catalog.xml`
- Modify: `apps/android/app/src/main/res/layout/item_story_card.xml`
- Create if absent: `apps/android/app/src/main/java/com/readlite/mobile/StoryCoverLoader.java`
- Test: `apps/android/app/src/test/java/com/readlite/mobile/CatalogUrlBuilderTest.java`

**Interfaces:**
- Consumes: `CatalogApiClient.getStories(query, genreId, sort, page)` và `StorySummary`.
- Produces: sort keys `newest`, `most_read`, `top_rated` (API cũng hỗ trợ `trending`); bìa chỉ tải từ API origin đã cấu hình, nếu không hợp lệ thì dùng placeholder có tên truyện.

- [ ] **Step 1: Thêm/điều chỉnh kiểm tra URL catalog** cho từ khóa, thể loại, sort và phân trang; kiểm tra URL-encoding tiếng Việt.
- [ ] **Step 2: Chạy** `.gradlew.bat :app:testDebugUnitTest`; URL sai phải làm kiểm tra thất bại.
- [ ] **Step 3: Nối giao diện Khám phá với tìm kiếm, lọc thể loại và phân trang; nối Xếp hạng với sort keys `newest`, `most_read`, `top_rated`**. Dùng nhãn và thứ tự do API trả về, không tự xếp hạng ở client.
- [ ] **Step 4: Hoàn thiện `StoryCardAdapter`** để cả ảnh bìa và tiêu đề gọi cùng listener mở `StoryDetailActivity`; xử lý bìa thiếu/lỗi, tên dài, rating/count bằng 0.
- [ ] **Step 5: Nếu cần `StoryCoverLoader`, tải ảnh ngoài UI thread, giới hạn kích thước decode, cache ảnh theo URL và kiểm tra lại URL khi ViewHolder được tái sử dụng**; từ chối scheme không phải HTTP(S) và host ngoài API được cấu hình.
- [ ] **Step 6: Chạy unit tests và build debug**; mở Khám phá, tìm theo tên/tác giả/nội dung, lọc thể loại, đổi ba kiểu xếp hạng và chạm từng loại thẻ truyện.

### Task 4: Chi tiết truyện, yêu thích và tủ sách đồng bộ

**Files:**
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/StoryDetailActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/BookshelfActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java`
- Modify: `apps/android/app/src/main/res/layout/activity_story_detail.xml`
- Modify: `apps/android/app/src/main/res/layout/activity_bookshelf.xml`
- Test: `apps/api/test/library.test.mjs`
- Test: `apps/android/app/src/androidTest/java/com/readlite/mobile/BookshelfFlowTest.java`

**Interfaces:**
- Consumes: `GET /api/v1/me/library`, `PUT /api/v1/stories/:storyId/favorite`, `DELETE /api/v1/stories/:storyId/favorite`, và API chi tiết/chương.
- Produces: trạng thái yêu thích có thể tải lại sau khi rời/mở app; hai nhóm `Đang đọc` và `Yêu thích`; nút tiếp tục mở đúng chapterId.

- [ ] **Step 1: Viết/hoàn thiện test API** cho thêm yêu thích, bỏ yêu thích, tải tủ sách, phiên hết hạn và CSRF sai; xác nhận không có ghi dở khi request lỗi.
- [ ] **Step 2: Chạy test API chỉ với database `readlite_test`**; dùng guard PowerShell kiểm tra `$env:DATABASE_URL.EndsWith('/readlite_test')` trước khi chạy `npm run test --workspace @readlite/api`.
- [ ] **Step 3: Hoàn thiện nút tim trong chi tiết**: hiện trạng thái đang tải, cập nhật sau phản hồi thành công, hoàn tác khi lỗi; phiên hết hạn đưa người dùng đến luồng đăng nhập.
- [ ] **Step 4: Tải hai danh sách tủ sách từ API**; hàng Đang đọc hiển thị chương/tiến độ, hàng Yêu thích mở chi tiết; trạng thái rỗng, lỗi mạng và chưa đăng nhập có nội dung tiếng Việt.
- [ ] **Step 5: Chạy test API và instrumentation**; thêm/xóa truyện phải còn đúng sau khi mở lại tủ sách.

### Task 5: Reader, mục lục, cỡ chữ, theme và tiếp tục đọc

**Files:**
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/ChapterReaderActivity.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/ReaderProgress.java`
- Modify: `apps/android/app/src/main/java/com/readlite/mobile/ReaderPreferences.java`
- Modify: `apps/android/app/src/main/res/layout/activity_chapter_reader.xml`
- Test: `apps/android/app/src/test/java/com/readlite/mobile/ReaderProgressTest.java`

**Interfaces:**
- Consumes: `GET /api/v1/stories/:storyId/chapters`, `GET /api/v1/stories/:storyId/chapters/:chapterId`, `GET /api/v1/stories/:storyId/reading-progress`, và `PUT /api/v1/stories/:storyId/reading-progress`.
- Produces: TOC phẳng có thứ tự hiện tại; API có thể mở rộng mỗi chapter với `volumeId`/`volumeTitle`; Reader lưu chapterId và permille 0–1000.

- [ ] **Step 1: Viết test cho tiến độ**: giới hạn 0–1000, giá trị âm/vượt mức, chapterId null và chapter hiện không còn trong danh sách.
- [ ] **Step 2: Chạy** `.gradlew.bat :app:testDebugUnitTest`; test mới phải làm lộ trường hợp chưa clamp.
- [ ] **Step 3: Hoàn thiện Reader** với nút quay lại, mở TOC, chương trước/sau, A−/A+, thanh/nhãn tiến độ; lưu cỡ chữ trong `ReaderPreferences`.
- [ ] **Step 4: Khôi phục chapter và vị trí từ server trước khi vẽ nội dung**; nếu server không có tiến độ hoặc chapter đã bị xóa thì mở chapter đầu tiên và hiện thông báo nhẹ.
- [ ] **Step 5: Lưu tiến độ khi cuộn, đổi chương và rời màn hình**; debounce request để không gửi một request cho từng pixel cuộn, đồng thời lưu lần cuối trước khi Activity kết thúc.
- [ ] **Step 6: Chạy unit test/build**; mở lại app phải trở về đúng chương và phần trăm đọc; theme toàn app phải áp dụng lên nền/chữ Reader.

### Task 6: Kiểm tra chấp nhận trên máy ảo

**Files:**
- Review only: các file trong `apps/android/app/src/main`
- Review only: `apps/api/test/`

**Interfaces:**
- Consumes: API local đang chạy, emulator Android và APK debug từ Task 2–5.
- Produces: checklist kết quả tái hiện được, danh sách lỗi còn lại nếu có.

- [ ] **Step 1: Chạy API typecheck/lint/test**; trước test xác nhận database kết thúc bằng `/readlite_test`.
- [ ] **Step 2: Chạy** `.gradlew.bat :app:testDebugUnitTest :app:assembleDebug`.
- [ ] **Step 3: Cài APK và kiểm tra** đăng nhập về Khám phá, chuyển bốn tab, tìm/lọc/xếp hạng, mở chi tiết từ thẻ, bấm tim, xem Tủ sách, đổi theme, mở mục lục, A−/A+, lưu và khôi phục tiến độ.
- [ ] **Step 4: Lặp lại với tài khoản đăng xuất, catalog rỗng, API tạm mất kết nối, bìa thiếu và bàn phím đang mở**; không màn hình nào crash hoặc bị status bar che.
- [ ] **Step 5: Rà `git diff --check` và diff từng file**; chỉ chỉnh file cần thiết, không stage/commit thay đổi đang có của người dùng.
