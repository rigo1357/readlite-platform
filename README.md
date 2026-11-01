# ReadLite Platform

ReadLite là nền tảng đọc light novel gồm ứng dụng Android cho độc giả, REST API dùng chung và bảng điều khiển web cho tác giả/quản trị viên. Nội dung EPUB và ảnh được lưu ngoài PostgreSQL; truyện chỉ xuất hiện trong catalog sau khi quản trị viên duyệt.

## Chức năng hiện có

- Đăng ký, xác minh email, đăng nhập, đổi mật khẩu và quản lý phiên.
- Khám phá, tìm kiếm/lọc thể loại, xem xếp hạng, chi tiết truyện và danh sách chương.
- Tủ sách yêu thích, lưu tiến độ đọc, cỡ chữ và giao diện sáng/tối.
- Đánh giá truyện đã xuất bản từ 1–5 sao ở tab **Đánh giá** trong chi tiết Android. Mỗi tài khoản có một đánh giá cho mỗi truyện, được sửa hoặc xóa; nhận xét tối đa 5000 ký tự. Danh sách phân trang, điểm trung bình và số lượt được đồng bộ bằng trigger PostgreSQL hiện có.
- Bình luận truyện tại trang chi tiết hoặc bình luận chương ở cuối Reader; trả lời một cấp, sửa/xóa bình luận của mình, danh sách có phân trang. Xóa bình luận gốc vẫn giữ các câu trả lời.
- Độc giả có thể báo cáo truyện, đánh giá hoặc bình luận. Web admin có mục **Báo cáo** để lọc và xử lý, gồm ẩn truyện, xóa nội dung vi phạm, đánh dấu đã xử lý hoặc bỏ qua.
- Trong Android, **Tài khoản → Sửa hồ sơ** cho phép đổi tên hiển thị và tên người dùng; email chỉ hiển thị.
- Đổi mật khẩu trong Tài khoản; quên mật khẩu và gửi lại xác minh tại Đăng nhập. API hỗ trợ SMTP cấu hình riêng; hướng dẫn tại [Email tài khoản](docs/EMAIL_SETUP.md).
- Trang chủ có kệ **Dành cho bạn**, dựa trên thể loại truyện đã thích/đọc; khi chưa có lịch sử, dùng dữ liệu danh mục và tương tác thật.
- Reader có dấu trang theo chương/vị trí, kèm ghi chú; xem lại, sửa ghi chú hoặc xóa dấu trang.
- Theo dõi chương mới tại chi tiết truyện; xem danh sách đang theo dõi và thông báo trong app tại Trang chủ hoặc Tài khoản. Có số chưa đọc, bộ lọc, đánh dấu đã đọc và mở trực tiếp chương. Migration `008-reader-follow-notifications` tạo dữ liệu theo dõi/thông báo, API tự chạy khi khởi động. Chi tiết tại [Theo dõi và thông báo](docs/THEO_DOI_VA_THONG_BAO.md).
- Tác giả/quản trị viên tạo truyện thủ công hoặc chọn tối đa 20 EPUB trong một lượt; mỗi tệp thành bản nháp riêng để xem trước bìa, metadata, tập/chương và ảnh trong chương. Có thể chọn nhiều bản nháp để gửi duyệt.
- Bản nháp ở chế độ riêng tư. Nếu có AI, hệ thống hỗ trợ rà soát trước; nếu chưa cấu hình AI, bản nháp đi thẳng vào hàng chờ duyệt thủ công. Quản trị viên quyết định xuất bản, yêu cầu chỉnh sửa hoặc từ chối.
- Web và Android cho phép chọn nhiều truyện trong hàng đợi để duyệt; từng truyện có quyết định và kết quả riêng. Web quản trị có trang **Phân quyền** để tìm tài khoản và đổi vai trò người đọc/tác giả/quản trị viên; tài khoản phải hoạt động, đã xác minh email. Admin không tự đổi quyền của mình; các lần đổi quyền được ghi vào `account_role_events`.
- Web quản trị hiển thị cùng kho truyện mà Android tải từ API. Quản trị viên có thể sửa thông tin, bìa, chương thủ công và mục lục EPUB của truyện đã xuất bản; ẩn khỏi app hoặc xóa truyện. Các chương còn giữ lại sẽ giữ nguyên mã để bảo toàn tiến độ đọc. Với EPUB đã nhập, nút **Khôi phục ảnh EPUB** đọc lại tệp gốc để bổ sung bìa và ảnh chương còn thiếu mà vẫn giữ mã truyện và tiến độ đọc.
- Android Reader hiển thị block văn bản/ảnh an toàn và mục lục theo tập; nội dung cũ chỉ có `content` vẫn được hỗ trợ.

## Yêu cầu

- Node.js 22.12 trở lên và npm.
- Docker Desktop với Docker Compose v2 để chạy API, web, PostgreSQL và Mailpit.
- Android Studio, Android SDK Platform 37 và JDK tương thích Gradle wrapper để build app.

## Chạy API, web và PostgreSQL

Tại thư mục dự án:

```sh
docker compose up --build
```

Compose chạy web ở `http://localhost:8080`, API ở `http://localhost:3000`, PostgreSQL và Mailpit. API chạy migration trước khi mở cổng. Nếu chạy API ngoài Compose trên database đã có dữ liệu, chạy `npm run db:migrate --workspace @readlite/api` với `DATABASE_URL` của chính database đó trước khi khởi động lại API; migration giữ nguyên truyện hiện có. Android emulator dùng `http://10.0.2.2:3000` làm API URL; điện thoại thật cần dùng IP LAN của máy chủ. Bản phát hành cần HTTPS.

Khi chưa cấu hình SMTP, môi trường development ghi link xác minh và token đặt lại mật khẩu vào log để tiện thử nghiệm. Mailpit có sẵn trong Compose và có thể nhận thư local khi bật SMTP; xem [hướng dẫn cấu hình email](docs/EMAIL_SETUP.md). Khi triển khai thật cần cấu hình máy chủ thư; production không ghi token vào log.

## Tài khoản tác giả và quản trị viên

Đăng ký tài khoản qua ứng dụng, xác minh email bằng link phát triển trong log API, rồi cấp quyền bằng công cụ quản trị cục bộ. Công cụ chỉ nâng quyền cho tài khoản đang hoạt động đã xác minh; nó không tạo tài khoản hay đặt lại mật khẩu.

```powershell
$env:DATABASE_URL = "postgres://readlite:readlite_local@localhost:5432/readlite"
npm run account:grant-role --workspace @readlite/api -- --email ten@example.com --role admin
```

Dùng `--role author` để cấp quyền tác giả. Không sử dụng mật khẩu mẫu hoặc tài khoản demo; seed không tạo thông tin đăng nhập dùng được. Nếu chạy lệnh bên trong container API, `DATABASE_URL` của Compose đã trỏ đến database local.

## Nhập EPUB và kiểm duyệt AI

Trong bảng điều khiển web hoặc màn hình **Truyện của tôi** trên Android, có thể chọn tối đa 20 EPUB một lần. Từng tệp được tải qua API hiện có và lưu thành bản nháp độc lập; một tệp lỗi không làm mất bản nháp của các tệp khác. Sau khi kiểm tra từng bản nháp, chọn nhiều mục để gửi duyệt. Quản trị viên chọn nhiều mục trong hàng đợi để xử lý; truyện có cảnh báo AI cần được xem kỹ trước khi xác nhận. EPUB được đọc metadata, bìa, mục lục và ảnh; nội dung thô không được đưa vào repository/PostgreSQL. Mỗi EPUB giới hạn 100 MiB; ảnh bìa thay thế tối đa 10 MiB.

Trang **Phân quyền** trên web dành riêng cho quản trị viên. Tìm tài khoản theo email/tên, chọn vai trò và lưu. Sau khi cập nhật mã nguồn, chạy migration mới nhất trước khi dùng trang này để tạo bảng lịch sử cấp quyền `account_role_events`.

AI review được tắt mặc định. Để bật, hãy chọn một dịch vụ tương thích OpenAI, cấu hình khóa trong môi trường API (không gửi khóa qua chat), rồi khởi động lại API:

```text
AI_REVIEW_PROVIDER=openai-compatible
AI_REVIEW_API_URL=https://api.openai.com/v1/chat/completions
AI_REVIEW_API_KEY=<khóa do bạn tự cấu hình>
AI_REVIEW_MODEL=<model được nhà cung cấp hỗ trợ>
```

Khi bật, API gửi các đoạn văn chương truyện tới dịch vụ đã cấu hình. AI chỉ đưa cảnh báo; quản trị viên quyết định xuất bản. Nếu chưa cấu hình AI, truyện chuyển sang hàng chờ duyệt thủ công. Nếu đã cấu hình nhưng dịch vụ gặp lỗi, hệ thống vẫn giữ truyện riêng tư để xử lý sau.

## Chạy web/API ngoài Docker

```sh
npm ci
npm run dev:api
npm run dev:web
```

Hai lệnh chạy ở hai terminal. Vite phục vụ web ở cổng 5173 và proxy `/api/v1` tới API. Cần đặt `DATABASE_URL` tới PostgreSQL có các migration hiện hành.

## Kiểm thử

Bộ API unit không dùng database:

```sh
npm run test:unit
npm run typecheck --workspace @readlite/api
npm run lint --workspace @readlite/api
```

`npm run test:integration` và `npm test` chạy kiểm thử tích hợp và yêu cầu `DATABASE_URL` trỏ chính xác database `readlite_test`; runner từ chối chạy nếu biến thiếu hoặc trỏ sang database khác. Tạo database test riêng, đặt `DATABASE_URL`, chạy migration trên database đó rồi mới chạy `npm run test:integration` hoặc `npm test`. Không dùng database `readlite` đang chứa dữ liệu ứng dụng.

```powershell
$env:DATABASE_URL = "postgres://readlite:readlite_local@localhost:5432/readlite_test"
npm run db:migrate --workspace @readlite/api
npm test
```

Android:

```powershell
Set-Location apps/android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

APK debug nằm ở `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Để kiểm thử UI, cần chạy một emulator và API local cùng lúc.

## Bổ sung chương cho truyện đã xuất bản

Đã có luồng nhập chương bằng tay hoặc EPUB → lưu bản nháp riêng → gửi quản trị viên duyệt → nối chương mới vào truyện hiện tại và thông báo người theo dõi trong app. Web có mục **Duyệt chương mới**; Android có nút **Bổ sung chương / tập mới** khi tác giả mở truyện đã xuất bản. Khởi động lại API để chạy migration **009-story-content-updates**, rồi chạy lại web và app.

Xem [hướng dẫn bổ sung chương](docs/BO_SUNG_CHUONG_DA_XUAT_BAN.md) để biết vị trí màn hình, quy tắc tập cuối, giới hạn nhập và các bước thử sau.

## Khóa và mở khóa tài khoản

Web **Phân quyền → Quản lý tài khoản** hỗ trợ lọc trạng thái/phân trang, khóa/mở khóa có lý do và xem lịch sử người thực hiện. Phiên cũ bị thu hồi và người dùng cần đăng nhập mới sau khi được mở khóa; có bảo vệ admin cuối cùng. Khởi động lại API để chạy migration **010-account-status-management**. Xem [hướng dẫn quản lý tài khoản](docs/QUAN_LY_TRANG_THAI_TAI_KHOAN.md).

## Trạng thái tiến hành truyện

Truyện có trạng thái tiến hành **Đang ra / Hoàn thành / Tạm ngưng**, được quản lý tại chi tiết truyện trên web. Android hiển thị trạng thái, lọc trong Khám phá và nhận thông báo hoàn thành trong app. Trạng thái này độc lập với kiểm duyệt; muốn bổ sung chương cần chuyển về Đang ra. Khởi động lại API chạy migration **011-story-lifecycle**. Xem [hướng dẫn trạng thái truyện](docs/TRANG_THAI_TIEN_HANH_TRUYEN.md).

## Giao diện Kho truyện

Trang **Kho truyện / Bản thảo** đã được tinh chỉnh theo hướng dẫn Impeccable: kết quả nhập EPUB riêng từng tệp, tiếp tục nhập phần còn lại, tìm truyện/tác giả không dấu, lọc trạng thái và chọn các bản nháp đang hiển thị. Giữ phong cách ReadLite sáng/tối và API hiện tại, không cần migration mới. Xem [hướng dẫn giao diện Kho truyện](docs/GIAO_DIEN_KHO_TRUYEN.md).

## Giao diện kiểm duyệt

Các trang **Duyệt truyện / Duyệt chương mới** dùng cùng phong cách trắng và cam nhạt. Hàng đợi truyện có tìm không dấu, lọc kết quả AI, chọn các truyện đang hiển thị và kết quả xử lý riêng từng truyện. Trang chi tiết đặt nội dung trước quyết định, có liên kết đi nhanh và ghi chú bắt buộc khi yêu cầu sửa/từ chối. Xem [hướng dẫn kiểm tra giao diện kiểm duyệt](docs/GIAO_DIEN_KIEM_DUYET.md).

## Hoàn thiện đồng bộ web trắng và cam nhạt

Đã đồng bộ Tổng quan, quản lý tài khoản, báo cáo, thông tin tài khoản, đăng nhập, tạo/chỉnh sửa truyện và bổ sung chương với các trang Kho truyện/kiểm duyệt. Menu điện thoại có thể thu gọn; các bước xác nhận dùng hộp thoại trong giao diện. Lưu từng phần của bản thảo giữ lại phần khác đang sửa; cần lưu hết thay đổi trước khi gửi duyệt. Đợt này không có migration mới.

Xem [hướng dẫn kiểm tra tổng hợp toàn bộ web](docs/HOAN_THIEN_WEB_VA_KIEM_TRA.md) theo một luồng từ đăng nhập, tạo bản thảo, duyệt đến kiểm tra Android và tài khoản.

### Dashboard theo mẫu profile wibu

Đã cập nhật Tổng quan theo mẫu ZIP: nền kem, cam đào, banner minh họa và bố cục thống kê / hàng đợi / lối tắt. Phông Be Vietnam Pro được lưu trong dự án và dùng thống nhất cho tiếng Việt. Xem [chi tiết giao diện dashboard](docs/GIAO_DIEN_DASHBOARD.md).

## Dữ liệu và lưu trữ

PostgreSQL là nguồn dữ liệu chuẩn cho tài khoản, truyện, chương, tủ sách và tiến độ. Media local mặc định nằm ngoài repository trong `~/.readlite/media`; Compose lưu media trong volume riêng. Không chạy `docker compose down --volumes` nếu cần giữ dữ liệu local.

Xem [kiến trúc hiện tại](docs/architecture.md) và [kế hoạch EPUB/media/kiểm duyệt](docs/superpowers/plans/2026-10-20-readlite-epub-media-moderation.md) để biết chi tiết triển khai và các bước phát hành còn cần môi trường riêng.
