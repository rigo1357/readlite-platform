# Giao diện Kho truyện và Impeccable

## Phạm vi đợt này

Áp dụng hướng dẫn thiết kế Impeccable vào trang `/submissions` cho quản trị viên và tác giả. Theo yêu cầu mới, giao diện web dùng nền trắng và cam nhạt: nút cam đào với chữ nâu đậm, trạng thái và mục chọn dùng cam nhạt; giao diện tối dùng nâu ấm/cam. Giữ API hiện tại. Không thêm migration hay thay đổi dữ liệu PostgreSQL.

- Khu vực nhập EPUB có danh sách tên tệp, dung lượng, tiến trình **số tệp đã xử lý** và trạng thái từng tệp: chờ nhập, đang nhập, lỗi hoặc mở bản nháp đã tạo. Thanh này không đo phần trăm byte tải lên.
- Giới hạn giữ nguyên: tối đa 20 tệp/lượt, mỗi tệp 100 MiB; nhập tuần tự. Không chọn lại tệp khi lượt nhập còn chạy.
- Nhập lại trong cùng trang chỉ xử lý tệp chưa thành công. Kết quả lượt nhập nằm trong bộ nhớ trang, không phải lịch sử nhập bền vững; tải lại trang sẽ mất danh sách này. Khi mất kết nối với kết quả chưa rõ, kiểm tra kho truyện trước khi thử lại.
- Tìm tên truyện/tác giả có hoặc không dấu, kết hợp bộ lọc trạng thái xuất bản. Tìm kiếm và thống kê chỉ dựa trên danh sách API trả về, không tạo truy vấn tìm kiếm mới ở máy chủ.
- Chọn các bản nháp đang hiển thị để gửi duyệt. Đã xuất bản, đang duyệt và đã từ chối không được chọn. Số đã chọn vẫn bao gồm bản nháp ngoài bộ lọc hiện tại và được ghi rõ trên giao diện.
- Trạng thái xuất bản và tiến hành truyện hiển thị riêng. Ngày phát hành được định dạng tiếng Việt.

## Thử nhanh bằng dữ liệu thật

1. Khởi động API/web như bình thường, vào **Kho truyện** hoặc **Bản thảo**.
2. Chọn 3 EPUB hợp lệ. Kiểm tra danh sách và nhập; trong khi chạy, nút chọn tệp phải bị khóa. Mở từng bản nháp để kiểm tra bìa/chương như trước.
3. Thử lượt có một EPUB hỏng. Các tệp còn lại vẫn được xử lý; kết quả lỗi nằm đúng dòng. Nút tiếp tục bỏ qua tệp đã thành công trong cùng trang.
4. Tìm tên tiếng Việt không dấu, đổi bộ lọc và xóa bộ lọc khi không có kết quả. Kiểm tra danh sách Đã xuất bản vẫn mở trang chi tiết.
5. Chọn bản nháp, đổi bộ lọc, kiểm tra tổng đã chọn và bỏ chọn. Gửi duyệt vẫn có bước xác nhận trước khi gọi API.
6. Thử giao diện sáng/tối, màn hình điện thoại và tên truyện/tên tệp dài.

## Công cụ thiết kế đã cài

- Nguồn: <https://github.com/pbakaus/impeccable>, thư mục `.agents/skills/impeccable`, phiên bản skill 4.8.0.
- Cài trong phạm vi dự án bằng công cụ skill-installer; không cài hook tự động hoặc cấu hình toàn máy. Bản cài đi kèm giấy phép/ghi nhận nguồn của repo gốc.
- Kỹ năng xuất hiện trong danh sách kỹ năng ở lượt chat mới. Đợt chỉnh này đọc trực tiếp `SKILL.md`, `polish.md`, `operate.md` và `craft-floor.md`.
- Công cụ nạp ngữ cảnh tự động chưa chạy được vì engine chưa có và thư mục bộ nhớ đệm mặc định không ghi được trong phiên làm việc. Chưa có kết quả detector tự động; không xem việc cài skill là một lần quét đã đạt.

## Kiểm tra trong đợt chỉnh

- Kiểm thử web bao gồm tìm tiếng Việt, lọc trạng thái, loại bản nháp không còn đủ điều kiện khỏi tổng gửi duyệt, hiển thị trạng thái tệp và thoát ký tự nội dung lỗi.
- Kiểm tra trình duyệt trên bản chạy riêng với API giả lập, không kết nối PostgreSQL thật: tìm không dấu, nhập 3 tệp có 1 lỗi và nhập lại; số lần gửi tương ứng 1–2–1.
- Kiểm tra bố cục điện thoại, kích thước trung gian, máy tính và giao diện sáng/tối. Việc nhập EPUB thật vẫn cần thử lại với API đang chạy và các tệp của bạn.

## Vị trí mã nguồn

- `apps/web/src/StoryLibrary.tsx`: khối nhập EPUB, tìm/lọc/chọn bản nháp, danh sách truyện.
- `apps/web/src/App.tsx`: gọi API, điều phối lượt nhập tuần tự, gửi duyệt và điều hướng hiện tại.
- `apps/web/src/styles.css`: quy tắc có tiền tố `library-`, dùng các token màu sáng/tối sẵn có.
- `apps/web/src/StoryLibrary.test.tsx`: kiểm thử bổ sung.
