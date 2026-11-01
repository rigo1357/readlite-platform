# Email tài khoản ReadLite

API hỗ trợ email xác minh khi đăng ký, gửi lại xác minh và đặt lại mật khẩu qua SMTP (Nodemailer). Không có SMTP nào tự bật; chỉ cấu hình `SMTP_HOST` khi muốn gửi. Các kiểm thử dùng transport giả, không gửi email ra ngoài.

## Thử bằng Mailpit, không gửi email thật

Mailpit đã có trong Docker Compose. Nếu API chạy bằng Docker, thêm vào file `.env` local:

```dotenv
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=readlite@example.test
APP_PUBLIC_URL=http://localhost:3000
```

Nếu API chạy trực tiếp trên Windows, đổi `SMTP_HOST=localhost` và bảo đảm các biến này được đưa vào môi trường tiến trình API. Chạy lại API sau khi sửa cấu hình. Mở giao diện Mailpit ở `http://localhost:8025` để xem thư. Mailpit chỉ giữ thư local.

`APP_PUBLIC_URL` là origin API (không có đường dẫn), được dùng tạo liên kết trong thư. Trên điện thoại thật, thay `localhost` bằng địa chỉ LAN/domain truy cập được từ điện thoại. Không dùng địa chỉ `10.0.2.2` cho thư được mở ở máy khác.

## SMTP nhà cung cấp thật

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=no-reply@example.com
APP_PUBLIC_URL=https://api.example.com
```

Port 587 dùng STARTTLS; port 465 thường dùng `SMTP_SECURE=true` (TLS từ khi kết nối). Trong production, API bắt buộc STARTTLS khi `SMTP_SECURE=false`, giữ kiểm tra chứng chỉ mặc định, và yêu cầu `APP_PUBLIC_URL` là HTTPS. Username/password phải cấu hình cùng nhau; SMTP relay local như Mailpit có thể bỏ cả hai. Không ghi mật khẩu vào Git; cấu hình ở môi trường triển khai. Tài liệu transport: [Nodemailer SMTP](https://nodemailer.com/smtp).

## Các luồng sử dụng

- Đăng ký `POST /api/v1/auth/register`: tài khoản và token được commit trước khi gửi thư. Token xác minh hiệu lực 24 giờ, database chỉ lưu SHA-256.
- Gửi lại `POST /api/v1/auth/resend-verification` với `{ "email": "you@example.com" }`: luôn trả 202 cùng thông báo cho email tồn tại/không tồn tại/đã xác minh. Nếu còn tài khoản chưa xác minh, token cũ bị vô hiệu và thư mới được tạo. Dùng bước này nếu lần gửi đầu thất bại.
- Quên mật khẩu `POST /api/v1/auth/forgot-password` với `{ "email": "you@example.com" }`: luôn trả 202 chung. Token đặt lại hiệu lực 30 phút, chỉ dùng một lần.
- Email đặt lại có liên kết trang API `/api/v1/auth/reset-password?token=...` để đổi ngay trong trình duyệt; cũng có mã để dán vào Android. Android vẫn dùng JSON `POST /api/v1/auth/reset-password` với `{ "token": "...", "password": "..." }`.
- Đổi mật khẩu đang đăng nhập: `POST /api/v1/auth/change-password` với `{ "currentPassword": "...", "password": "..." }`, cookie phiên và `x-csrf-token`. Thành công trả 200, xóa cookie hiện tại, thu hồi tất cả refresh token và token reset cũ; đăng nhập lại bằng mật khẩu mới. Access JWT đã cấp trên máy khác vẫn có thể sống đến hết hạn tối đa 15 phút.

Để không tiết lộ tình trạng tài khoản qua lỗi SMTP hoặc thời gian gửi thư, gửi email chạy sau khi dữ liệu commit và không chặn phản hồi tài khoản. Lỗi chỉ ghi thông báo chung, không ghi email/token/mật khẩu SMTP. Việc gửi hiện chưa có hàng đợi bền vững hay tự thử lại khi tiến trình dừng; người dùng có thể yêu cầu gửi lại. Mỗi endpoint có giới hạn số yêu cầu.

Nếu chưa cấu hình SMTP, môi trường development ghi link xác minh và token reset vào console như trước. Production không ghi token và không gửi thư khi chưa cấu hình SMTP; cần cấu hình SMTP trước khi dùng đăng ký/khôi phục trong triển khai thực tế.
