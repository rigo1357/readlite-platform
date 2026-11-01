# Giao diện kiểm duyệt trắng và cam nhạt

## Đã thay đổi

### Duyệt truyện

- Tìm theo tên truyện, tác giả hoặc người gửi; hỗ trợ tiếng Việt không dấu.
- Lọc Tất cả / Có cảnh báo AI / Duyệt thủ công / AI đã rà soát. Tìm kiếm và số lượng dựa trên danh sách hàng đợi mà API hiện tại trả về.
- Nhãn AI phân biệt rõ `skipped`, `not_started`, `pending`, `passed`, `warnings` và trạng thái chưa biết. Chưa có kết quả AI không được hiển thị là đã rà soát.
- Chọn các truyện đang hiển thị; đổi bộ lọc vẫn giữ lựa chọn. Khối thao tác ghi rõ tổng số đã chọn, kể cả truyện ngoài bộ lọc hiện tại.
- Chỉ hiện phần thao tác hàng loạt sau khi chọn truyện. Yêu cầu sửa và từ chối cần nhập lý do trước khi bật nút áp dụng.
- Giữ hộp xác nhận trước khi gửi quyết định. Sau xác nhận, khóa lựa chọn và biểu mẫu trong lúc chạy; ghi kết quả riêng từng truyện, giữ lại lựa chọn thất bại để thử lại, cập nhật hàng đợi và kho truyện.

### Chi tiết truyện chờ duyệt

- Thông tin truyện, kết quả/cảnh báo AI, nội dung xem trước và quyết định được tách rõ.
- Có liên kết Đọc nội dung / Đến phần quyết định.
- Đặt phần quyết định sau nội dung xem trước. Nút yêu cầu chỉnh sửa và từ chối chỉ bật khi có lý do.
- Giữ quy tắc xác nhận duyệt khi có cảnh báo AI hoặc duyệt thủ công, phân quyền và API hiện tại.

### Duyệt chương mới

- Hàng đợi hiển thị tên bản bổ sung, tên truyện gốc, số chương, nguồn EPUB/nhập tay, thời gian gửi, trạng thái và số lưu ý nhập EPUB.
- Giữ phân trang ở API, tối đa 20 bản mỗi trang; có trạng thái tải, lỗi, thử lại và danh sách trống.
- Chi tiết có đường về hàng đợi cho quản trị viên và đường mở truyện gốc. Tác giả tiếp tục về chi tiết truyện của mình.
- Chương đầu mở sẵn; nội dung được đọc trước phần quyết định. Bản chờ duyệt chỉ hiện thao tác xuất bản/yêu cầu sửa/từ chối cho quản trị viên.
- Lỗi lưu quyết định nằm ngay trong khối quyết định để người duyệt thấy và thử lại.

## Phạm vi

Đợt này chỉnh web theo bảng màu trắng/cam nhạt đã chốt. Không đổi Android, schema PostgreSQL, tuyến API hay quy tắc nối chương đã xuất bản. Không cần migration mới.

## Thử lại với dự án thật

1. Vào **Duyệt truyện**, tìm tên không dấu và thử từng bộ lọc AI.
2. Chọn vài truyện, đổi bộ lọc; kiểm tra tổng đã chọn trước khi áp dụng. Có thể bỏ chọn để làm lại.
3. Chọn yêu cầu chỉnh sửa hoặc từ chối: chưa nhập lý do thì nút áp dụng bị khóa. Kiểm tra tên truyện và số lượng trong bước xác nhận trước khi gửi.
4. Mở một truyện duyệt thủ công và một truyện có cảnh báo. Đọc chương, nhập ghi chú rồi thử quyết định; kiểm tra hàng đợi và Kho truyện cập nhật trạng thái.
5. Vào **Duyệt chương mới**, chuyển trang nếu có trên 20 bản. Mở bản bổ sung, kiểm tra chương và ảnh, dùng liên kết đến phần quyết định.
6. Với tài khoản tác giả, mở cùng bản bổ sung của mình: không được thấy nút xuất bản của quản trị viên.
7. Thử trên điện thoại và giao diện tối, đặc biệt tên truyện/chương dài và ghi chú dài.

## Đã kiểm tra

- Kiểm thử web: lọc/tìm không dấu, nhãn AI, điều kiện lý do bắt buộc, khóa biểu mẫu, thứ tự nội dung/quyết định và quyền hiển thị.
- Kiểm thử xử lý hàng loạt với API được giả lập trong bài kiểm thử: thành công–lỗi–thành công vẫn xử lý đủ ba truyện, không tự gửi lại truyện thành công, giữ đúng quyết định và lý do.
- Build, typecheck và lint web đạt.
- Trình duyệt dùng máy chủ kiểm thử riêng, không kết nối dữ liệu thật: đã xem hàng đợi và các trang chi tiết, thử tìm không dấu, đổi bộ lọc khi đã chọn, ghi chú bắt buộc và bố cục điện thoại.
- Đợt hoàn thiện toàn bộ web đã thay hộp xác nhận gốc bằng hộp thoại trong giao diện và kiểm tra được xác nhận/hủy, duyệt hàng loạt, thử lại riêng truyện lỗi, xuất bản chương và phân trang trên trình duyệt với API giả lập. Xem [hướng dẫn kiểm tra tổng hợp](HOAN_THIEN_WEB_VA_KIEM_TRA.md) để thử trên dữ liệu thật.
- Chưa chạy detector Impeccable: engine/bộ nhớ đệm chưa khả dụng; đợt này dùng hướng dẫn thiết kế đã cài và kiểm tra trực tiếp.

## Mã nguồn

- `apps/web/src/StoryReviewQueue.tsx`: hàng đợi truyện và điều phối quyết định hàng loạt.
- `apps/web/src/ModerationUI.tsx`: nhãn AI, tiêu đề, trạng thái trống, biểu mẫu quyết định, liên kết tới nội dung.
- `apps/web/src/App.tsx`: trang xem trước truyện, điều hướng và cập nhật dữ liệu sau duyệt.
- `apps/web/src/ContentUpdates.tsx`: hàng đợi và trang bổ sung chương.
- `apps/web/src/styles.css`: các quy tắc `moderation-`, `update-review-`, `review-jump-links` dùng token trắng/cam sáng và nâu/cam tối.
