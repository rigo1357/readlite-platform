# Các chức năng bổ sung ReadLite

Đánh giá, bình luận, báo cáo và dấu trang tận dụng các bảng có sẵn. Theo dõi/thông báo chương mới dùng migration `008-reader-follow-notifications`, được API chạy khi khởi động. Sau khi cập nhật cần khởi động lại API và biên dịch/cài lại ứng dụng Android; web cần tải lại hoặc build lại nếu dùng bản đóng gói.

## Các vị trí sử dụng

| Chức năng | Vị trí |
| --- | --- |
| Đánh giá 1–5 sao | Chi tiết truyện → Đánh giá |
| Bình luận truyện | Chi tiết truyện → Bình luận |
| Bình luận chương | Cuối chương → Bình luận chương này |
| Báo cáo truyện | Chi tiết truyện → Báo cáo |
| Báo cáo đánh giá/bình luận | Nút Báo cáo ở từng nội dung |
| Xử lý báo cáo | Web admin → Báo cáo |
| Sửa tên/username | Tài khoản → Sửa hồ sơ |
| Đổi mật khẩu | Tài khoản → Đổi mật khẩu |
| Quên mật khẩu/gửi lại xác minh | Đăng nhập |
| Gợi ý theo sở thích | Trang chủ → Dành cho bạn |
| Dấu trang và ghi chú | Menu ⋮ trên thanh Reader tại bất kỳ vị trí đọc nào, hoặc các nút cuối chương |
| Theo dõi chương mới | Chi tiết truyện → Theo dõi chương mới |
| Thông báo và danh sách theo dõi | Trang chủ → Thông báo hoặc Tài khoản |

## Quy tắc

- Chỉ truyện công khai, đã xuất bản mới nhận tương tác từ độc giả.
- Mỗi người có một đánh giá trên mỗi truyện; điểm trung bình/số lượt do trigger PostgreSQL cập nhật.
- Bình luận tối đa 5000 ký tự, câu trả lời tối đa một cấp và cùng truyện/chương. Chỉ chủ nội dung được sửa/xóa bình luận; xóa mềm vẫn giữ câu trả lời.
- Báo cáo tối đa 2000 ký tự lý do. Gửi lặp cùng đối tượng khi báo cáo còn mở không tạo bản sao. Admin có thể chỉ đóng/bỏ qua hoặc thực hiện hành động phù hợp đối tượng: ẩn truyện, xóa bình luận/đánh giá.
- Gợi ý dựa trên thể loại của yêu thích (trọng số3) và lịch sử đọc (trọng số1), loại truyện đã thích/đọc. Khi không có ứng viên phù hợp, dùng dữ liệu đọc/đánh giá và độ mới thực tế; không gọi dịch vụ AI.
- Dấu trang lưu chương/vị trí từ0 đến1000 cùng ghi chú tối đa2000 ký tự. Nếu chương bị xóa, ghi chú vẫn được giữ; nút mở chương bị vô hiệu.
- Đổi mật khẩu thu hồi refresh token, token reset và xóa phiên hiện tại. Access token trên thiết bị khác có thể tồn tại tối đa15 phút theo thiết kế phiên hiện hành.

## Email

SMTP chưa tự bật. Xem [EMAIL_SETUP.md](EMAIL_SETUP.md) để cấu hình SMTP và URL API người nhận có thể mở. Mailpit dùng cho thư local; gửi email ngoài cần máy chủ thư thực. Không đưa mật khẩu SMTP vào mã nguồn.

## Các trường hợp dùng thử sau khi cài bản mới

1. Đánh giá, sửa điểm rồi xóa: điểm và số lượt thay đổi tương ứng.
2. Viết bình luận, tài khoản khác trả lời; xóa bình luận gốc vẫn thấy câu trả lời.
3. Bình luận chương1 không xuất hiện trong bình luận chương2 hoặc bình luận chung của truyện.
4. Gửi báo cáo từ Android, xử lý trong web admin; đóng/bỏ qua và hành động xóa/ẩn được phân biệt.
5. Sửa hồ sơ, đổi mật khẩu rồi đăng nhập bằng mật khẩu mới.
6. Khi đã cấu hình email, gửi xác minh/khôi phục và mở liên kết trong thư. Không có SMTP thì dùng log phát triển.
7. Yêu thích/đọc vài truyện có thể loại rồi mở lại Trang chủ xem gợi ý.
8. Lưu dấu trang tại giữa chương với ghi chú, mở chương khác rồi quay lại từ danh sách Dấu trang.

Chạy thử dữ liệu ứng dụng trên database `readlite`. Chỉ dùng `readlite_test` cho kiểm thử tự động có database.

## Bổ sung chương sau xuất bản

Đã thêm luồng độc lập cho nội dung nối tiếp, cần migration **009-story-content-updates**. Tác giả nhập bằng tay hoặc EPUB trên web/Android, lưu bản nháp riêng và gửi duyệt. Quản trị viên dùng **Duyệt chương mới** trên web để xuất bản/yêu cầu sửa/từ chối. Chương cũ và tiến độ đọc được giữ lại; chỉ chương được duyệt mới xuất hiện và tạo thông báo cho người theo dõi. Xem [hướng dẫn đầy đủ](BO_SUNG_CHUONG_DA_XUAT_BAN.md).

## Quản lý tài khoản vi phạm

Web **Phân quyền** có khóa/mở khóa, lý do, lịch sử, bộ lọc trạng thái và phân trang. API thu hồi phiên khi đổi trạng thái; mở khóa yêu cầu đăng nhập mới và giữ vai trò/dữ liệu cũ. Có bảo vệ admin cuối cùng, kiểm tra màn hình trạng thái cũ và giao dịch hoàn tác khi lỗi. Cần migration **010-account-status-management**; xem [hướng dẫn quản lý trạng thái tài khoản](QUAN_LY_TRANG_THAI_TAI_KHOAN.md).

## Trạng thái tiến hành truyện

Đã thêm **Đang ra / Hoàn thành / Tạm ngưng** cùng lịch sử và ghi chú trên web. Android hiển thị trạng thái, lọc trong Khám phá và có thông báo hoàn thành cho người theo dõi. Truyện đang công khai vẫn đọc được ở cả ba trạng thái; bổ sung chương cần Đang ra. Cần migration **011-story-lifecycle**; xem [hướng dẫn nghiệp vụ](TRANG_THAI_TIEN_HANH_TRUYEN.md).
