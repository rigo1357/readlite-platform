# Kiến trúc ReadLite hiện tại

## Thành phần

| Thành phần | Vai trò | Dữ liệu/kết nối |
| --- | --- | --- |
| `apps/android` | Ứng dụng Android cho độc giả; khám phá, tủ sách, tài khoản, Reader và luồng tác giả/quản trị theo role | Gọi REST API; debug emulator dùng `10.0.2.2:3000` |
| `apps/web` | Bảng điều khiển cho tác giả và quản trị viên; đăng nhập, tạo bản thảo, nhập EPUB, xem hàng đợi duyệt | React/Vite; Nginx proxy API cùng origin trong Compose |
| `apps/api` | REST API, xác thực/phân quyền, catalog, thư viện, media, import EPUB và worker AI | Express 5, TypeScript, PostgreSQL, kho media riêng |
| PostgreSQL | Nguồn dữ liệu chuẩn cho tài khoản, truyện, tập/chương, kiểm duyệt, thể loại, yêu thích và tiến độ | Chạy migrations trước khi API listen |
| Kho media | EPUB gốc, ảnh bìa, ảnh chương | Khóa ngẫu nhiên; local adapter lưu ngoài repository hoặc volume bền vững |

Compose khởi chạy PostgreSQL, API, web và Mailpit. API đã có SMTP tùy chọn cho email xác minh và đặt lại mật khẩu; Mailpit nhận thư local khi được cấu hình. Khi chưa bật SMTP, development giữ log hỗ trợ thử nghiệm. Xem `docs/EMAIL_SETUP.md` trước khi triển khai email thật.

## Luồng truyện và phân quyền

```text
Tác giả/quản trị viên → nhập EPUB hoặc tạo truyện thủ công → bản nháp riêng
Bản nháp → gửi duyệt → AI nếu có cấu hình / chuyển duyệt thủ công → chờ quản trị viên
Quản trị viên → duyệt / yêu cầu chỉnh sửa / từ chối
Duyệt → visibility public + moderation_status published → catalog/Reader
```

- Người đọc thường chỉ truy cập truyện đã `published` và `public`.
- Tác giả chỉ quản lý bản nháp do mình gửi.
- Quản trị viên xem và duyệt hàng đợi; migration `006` cho phép quy trình duyệt thủ công hiện tại, không còn chặn admin duyệt truyện mình gửi.
- AI không xuất bản hoặc từ chối truyện. Khi không cấu hình AI, truyện chuyển hàng chờ admin ở chế độ riêng tư; lỗi provider có retry giới hạn rồi giữ bản nháp riêng tư.
- Cấp role qua trang Phân quyền web hoặc script `account:grant-role` cho tài khoản đang hoạt động đã xác minh; đăng ký công khai luôn tạo role `user`.

## Nhập EPUB và hiển thị nội dung

API xác thực multipart, chữ ký ZIP/EPUB, đường dẫn entry, kích thước nén/giải nén và các giới hạn archive trước khi tạo bản nháp. Parser đọc metadata OPF, EPUB 2 NCX/EPUB 3 nav, ghép spine theo mục lục, làm sạch XHTML và tạo block text/heading/quote/image. Ảnh chỉ được trích xuất khi parser tham chiếu; URL ngoài, script, CSS thực thi và nội dung nguy hiểm không được đưa vào Reader.

Metadata, bìa, thể loại và ngày xuất bản lấy từ file khi có thể. Ngày thiếu dùng ngày hiện tại. Tác giả có thể chỉnh metadata phù hợp trước khi gửi; với EPUB, thao tác cấu trúc chỉ đổi tên/sắp xếp tập và chương, không sửa nội dung/ảnh đã trích xuất.

`GET /api/v1/stories/:id/chapters` trả danh sách chapter, nhóm volume và các Reader blocks. Truyện cũ không có `content_blocks` vẫn giữ trường `content` và được Reader hiển thị như văn bản. Media draft chỉ owner/quản trị viên đọc được; EPUB gốc luôn riêng tư.

## Kiểm duyệt AI

`story_review_jobs` là hàng đợi bền vững PostgreSQL. Worker claim job bằng `FOR UPDATE SKIP LOCKED`, lease khóa có hạn, chia văn bản theo giới hạn cấu hình, retry lỗi provider và khôi phục job bị bỏ dở sau khi worker dừng. Job hoàn tất chuyển truyện sang `admin_review_pending`; hết số lần retry chuyển về draft, không công khai.

Provider tương thích OpenAI chỉ được tạo khi có `AI_REVIEW_PROVIDER`, `AI_REVIEW_API_KEY` và `AI_REVIEW_MODEL`. Khi bật, API gửi tiêu đề chương và đoạn text cần rà soát đến endpoint đã cấu hình, không gửi ID nội bộ. Không cấu hình khóa trong source hoặc chat; nội dung truyện chỉ gửi tới nhà cung cấp mà chủ hệ thống đã lựa chọn.

## Bảo mật và lưu trữ

- Session web dùng cookie `HttpOnly`, CSRF cho request thay đổi dữ liệu; Android dùng cookie jar phiên dùng chung và CSRF token.
- SQL dùng tham số; API kiểm tra role, quyền sở hữu và trạng thái bản nháp trước khi đọc/sửa.
- Media lấy từ storage key sinh bởi server, không dùng tên file tải lên làm đường dẫn.
- API không ghi nội dung chương hoặc bí mật provider vào log; lỗi provider chỉ lưu mã an toàn.
- `READLITE_MEDIA_DIR` phải trỏ kho bền vững ở production; backup database và volume media cùng nhau.
- Production yêu cầu HTTPS, cookie Secure, `AUTH_ACCESS_SECRET` riêng và email provider phù hợp.

## Kiểm thử và điều kiện môi trường

- `npm run test:unit --workspace @readlite/api` chạy parser, auth validation, route/service fake-database, media, catalog, role grant và worker tests mà không cần PostgreSQL.
- `npm test` gồm API integration tests ghi database; runner chỉ cho phép database có tên chính xác `readlite_test`.
- Android unit/build cần Gradle/JDK tương thích. Emulator flow cần emulator đang chạy, API và database local sẵn sàng.
- Hai file EPUB mẫu của người dùng không nằm trong repository. Kiểm tra parser tổng hợp có thể chạy offline; kiểm tra upload qua app cần môi trường API/Android.

## Giới hạn còn lại trước phát hành

1. Cấu hình và thử SMTP thật để gửi xác minh và khôi phục mật khẩu; module gửi email đã triển khai, chưa có hàng đợi bền vững.
2. Chọn nhà cung cấp/model AI, đặt secret trong môi trường và kiểm tra luồng gửi truyện với provider thật; mặc định fail-closed.
3. Chạy migration upgrade/rollback và toàn bộ API DB tests trên database riêng `readlite_test`.
4. Chạy Android Gradle unit/build và emulator tests trong môi trường Android Studio ổn định.
5. Kiểm thử upload hai EPUB mẫu, quyền media qua nhiều tài khoản và luồng admin thứ hai trên dữ liệu an toàn.

Không có dữ liệu EPUB mẫu hoặc khóa AI được đưa vào Git, PostgreSQL seed hay gói source.
