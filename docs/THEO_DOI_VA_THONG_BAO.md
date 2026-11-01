# Theo dõi truyện và thông báo chương mới

## Vị trí sử dụng

- Chi tiết truyện: nút **Theo dõi chương mới**, độc lập với yêu thích.
- Trang chủ: nút **Thông báo** kèm số chưa đọc khi tải được tài khoản.
- Tài khoản: **Truyện đang theo dõi** và **Thông báo chương mới**.
- Màn hình cập nhật: hai tab thông báo và đang theo dõi, phân trang20 mục; lọc chỉ chưa đọc, đánh dấu từng mục hoặc tất cả đã đọc.
- Chạm **Đọc chương mới** để đánh dấu thông báo đã đọc rồi mở chương. Nếu chương đã bị xóa, có thể mở chi tiết truyện để chọn nội dung còn lại.

## Quy tắc nghiệp vụ

- Chỉ tài khoản đang hoạt động, đã xác minh email được theo dõi và xem thông báo riêng.
- Chỉ theo dõi được truyện công khai và đã xuất bản. Truyện bị ẩn vẫn xuất hiện dưới nhãn không công khai trong danh sách theo dõi, để người dùng có thể bỏ theo dõi; không lộ tên/tác giả của nội dung riêng tư.
- Yêu thích và theo dõi là hai lựa chọn riêng. Yêu thích không tự bật theo dõi; theo dõi cũng không tự thêm vào yêu thích.
- Thông báo được tạo khi chương mới trở thành công khai: thêm vào truyện đã xuất bản, hoặc thêm vào bản nháp rồi phát hành truyện.
- Chương ở bản nháp không tạo thông báo cho độc giả. Sửa tên/nội dung, đổi thứ tự hoặc ẩn rồi công khai lại cùng chương không phát thông báo lặp.
- Theo dõi muộn không nhận lại toàn bộ chương cũ. Bỏ theo dõi dừng các cập nhật tiếp theo, vẫn giữ lịch sử thông báo đã nhận.
- Thông báo của truyện đang bị ẩn không xuất hiện trong danh sách hoặc bộ đếm. Khi công khai lại, trạng thái đã đọc của thông báo cũ được giữ.
- Đây là thông báo **trong ứng dụng**, được tải khi mở màn hình hoặc nhấn Tải lại. Chưa tích hợp push hệ điều hành/FCM hoặc gửi email chương mới.

## Cách phát hành chương từ web hiện tại

Trong web quản trị, sửa danh sách chương của truyện thủ công đã xuất bản và thêm chương mới. Khi giao dịch lưu thành công, database tự tạo thông báo cho người đang theo dõi. Nếu cập nhật một truyện đang riêng tư, thông báo chỉ được tạo khi truyện được duyệt và công khai. Luồng nhập EPUB hiện vẫn tạo từng bản nháp riêng, không tự ghép EPUB khác thành tập mới của truyện cũ.

## Dữ liệu và API

Migration `008-reader-follow-notifications` tạo:

- `story_follows`: mỗi cặp người dùng/truyện tối đa một dòng.
- `announced_chapters`: ghi chương đã được công bố để chống phát thông báo lặp.
- `reader_notifications`: thông báo riêng theo người dùng, chương và thời gian đã đọc.

API tự áp dụng migration trước khi mở cổng. Migration tạo mốc cho chương đang công khai, không gửi hàng loạt lịch sử khi cài chức năng. Các trigger nằm trong cùng transaction với việc thêm/phát hành chương; rollback cũng hủy thông báo.

| API | Mục đích |
| --- | --- |
| GET/PUT/DELETE `/api/v1/stories/:storyId/follow` | Trạng thái, theo dõi, bỏ theo dõi |
| GET `/api/v1/me/following?page=1` | Danh sách đang theo dõi |
| GET `/api/v1/me/notifications?page=1&unread=false` | Thông báo có phân trang |
| GET `/api/v1/me/notifications/unread-count` | Số chưa đọc |
| PUT `/api/v1/me/notifications/:id/read` | Đánh dấu một thông báo đã đọc |
| PUT `/api/v1/me/notifications/read-all` | Đánh dấu tất cả thông báo đang hiển thị đã đọc |

Các thao tác ghi kiểm tra CSRF và chủ sở hữu. API không cho xem/đánh dấu thông báo của tài khoản khác; phản hồi cá nhân dùng `Cache-Control: no-store`.

## Kiểm tra tự động

`apps/api/test/reader-updates-db.test.mjs` dùng PostgreSQL trong bộ nhớ (PGlite), chạy migration/trigger và API trên dữ liệu tổng hợp. Bài kiểm tra không kết nối `DATABASE_URL`, không đọc hay sửa database và kho truyện đang sử dụng.
