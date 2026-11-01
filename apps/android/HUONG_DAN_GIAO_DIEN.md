# Giao diện ReadLite cho bài báo cáo mobile app

## Chạy trong Android Studio

1. Chọn **Open** và mở thư mục `apps/android` (thư mục chứa `settings.gradle.kts`).
2. Chờ Gradle Sync, chọn máy giả lập rồi bấm **Run app**.
3. Khi khởi động mới, app mở màn **Đăng nhập**. Đăng nhập thành công sẽ chuyển đến **Trang chủ**. Đăng xuất sẽ quay về đăng nhập và xóa các màn hình trước đó khỏi lịch sử điều hướng.

APK debug được tạo tại `app/build/outputs/apk/debug/app-debug.apk`.

## Những phần đã thay đổi

- Màu be, nền sáng, chữ gọn và biểu tượng sách; giữ tên ReadLite. Chế độ tối vẫn có trong Tài khoản.
- Đăng nhập/đăng ký: ô nhập có nhãn, hiện/ẩn mật khẩu, kiểm tra trường bắt buộc và email.
- Trang chủ mới: lời chào, banner, tóm tắt tủ sách, các kệ truyện mới cập nhật và đọc nhiều từ API.
- Thanh điều hướng chung: Trang chủ, Khám phá, Tủ sách, Tài khoản. Xếp hạng vẫn nằm trong bộ sắp xếp của Khám phá.
- Khám phá: tìm kiếm, lọc thể loại, sắp xếp và lưới bìa truyện hai cột.
- Tủ sách: tìm trong danh sách cá nhân, lọc Tất cả / Đang đọc / Yêu thích.
- Chi tiết truyện: bìa và thông tin, tab Giới thiệu / Danh sách chương, nút Bắt đầu đọc hoặc Đọc tiếp.
- Tài khoản: thông tin người dùng, mở tủ sách, sáng/tối, đăng xuất và các chức năng tác giả/quản trị theo quyền hiện có.

Ảnh tham khảo được dùng cho bố cục và màu sắc. Không thêm điểm thưởng, đăng nhập mạng xã hội hoặc dữ liệu sách giả vào app. Nội dung truyện và tài khoản vẫn dùng backend của dự án.

## Backend khi trình bày

- Chạy backend theo README ở thư mục gốc. Máy giả lập dùng `http://10.0.2.2:3000`.
- Điện thoại thật cần địa chỉ IP LAN của máy chạy API, cấu hình bằng Gradle property `readliteApiBaseUrl`.
- Tài khoản đăng ký mới phải xác minh email trước khi đăng nhập. Khi chưa bật SMTP, lấy liên kết xác minh trong log API development; xem `docs/EMAIL_SETUP.md` để cấu hình gửi email hoặc dùng Mailpit.
- Mở app và chuyển giữa form đăng nhập/đăng ký không cần backend. Đăng nhập, tải truyện, lưu yêu thích và đồng bộ tiến độ cần backend hoạt động.

## Các chức năng bổ sung

- Chi tiết truyện có đánh giá 1–5 sao, nhận xét, sửa/xóa đánh giá của mình và báo cáo nội dung.
- Nút Bình luận tại chi tiết truyện và cuối chương mở danh sách riêng theo ngữ cảnh; hỗ trợ trả lời một cấp và sửa/xóa bình luận của mình.
- Trang chủ có kệ Dành cho bạn và lý do gợi ý.
- Reader có Đánh dấu vị trí này và Dấu trang; dấu trang giữ chương, vị trí và ghi chú, có thể sửa/xóa.
- Tài khoản có Sửa hồ sơ và Đổi mật khẩu. Đăng nhập có Quên mật khẩu và Gửi lại email xác minh.

## Bổ sung chương sau khi xuất bản

Trong **Truyện của tôi**, mở truyện đã xuất bản rồi chọn **Bổ sung chương / tập mới** ở phần xem trước mục lục. Màn hình mới hỗ trợ tạo/sửa bản nháp bằng tay, nhập một EPUB chứa phần tiếp theo, xem trước chương và ảnh, gửi duyệt, xem lý do yêu cầu sửa và hủy bản chưa xuất bản. Chỉnh mục lục EPUB và duyệt nội dung bổ sung thực hiện trên web. Nội dung và tiến độ đọc cũ được giữ nguyên. Cần khởi động lại API để chạy migration 009 trước khi dùng.

## Lệnh kiểm thử

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
```

Các bài kiểm thử `StorySummaryTest` sử dụng `JSONObject` của Android nên nằm trong `src/androidTest` và chạy trên thiết bị, thay vì JVM không có triển khai JSON Android.

Để chạy kiểm thử trên máy giả lập: `:app:connectedDebugAndroidTest`. Cũng có thể cài hai APK app/test rồi dùng AndroidJUnitRunner trực tiếp. Tham số instrumentation `captureScreenshots=true` lưu ảnh kiểm tra trong thư mục `ui-previews` của vùng external files của ứng dụng.
