# Bổ sung chương cho truyện đã xuất bản

## Chức năng đã thêm

Tác giả (hoặc quản trị viên) có thể thêm phần tiếp theo vào một truyện đang công khai mà không phải tạo truyện mới hoặc đưa toàn bộ truyện về bản nháp. Nội dung bổ sung có hàng đợi kiểm duyệt riêng.

- Nhập tay: tạo nhiều chương, nối vào **tập cuối hiện tại** hoặc tạo tập mới. Web hỗ trợ chuyển thứ tự/xóa chương trong bản nháp. Android hỗ trợ thêm, bỏ và sửa chương.
- EPUB: chọn một tệp chỉ chứa phần mới; giữ nội dung, định dạng văn bản và ảnh minh họa. Các tập trong EPUB được nối ở cuối truyện. Tên truyện, thông tin giới thiệu và bìa truyện cũ không bị thay thế.
- Lưu bản nháp → xem trước → gửi duyệt → quản trị viên xuất bản, yêu cầu chỉnh sửa hoặc từ chối.
- Tác giả có thể hủy bản nháp hoặc rút bản đang chờ duyệt. Bản đã xuất bản không được hủy hoặc duyệt lại.
- Sau khi duyệt, chương mới xuất hiện trong cùng truyện trên Android, tổng số chương được cập nhật và người đang theo dõi nhận thông báo **trong app**.
- ID, nội dung, thứ tự của chương cũ và vị trí đọc/dấu trang của độc giả được giữ nguyên. Các chương bổ sung được cấp ID mới.

Đây là **duyệt thủ công**, chưa chạy AI cho phần bổ sung. Thông báo chưa phải thông báo đẩy ngoài ứng dụng.

## Cách sử dụng

### Trên web

1. Đăng nhập bằng tác giả hoặc quản trị viên.
2. Vào **Bản thảo/Kho truyện** → mở một truyện đã xuất bản.
3. Trong **Bổ sung chương**, chọn **+ Bổ sung chương**.
4. Chọn nhập bằng tay hoặc EPUB. Lưu bản nháp rồi xem lại nội dung.
5. Với EPUB, có thể sửa tên tập/chương và di chuyển chương trong cùng một tập trên web. Phải giữ đầy đủ chương và ảnh đã trích xuất.
6. Nhấn **Gửi duyệt chương mới**. Sau khi gửi không sửa được nội dung, trừ khi quản trị viên yêu cầu chỉnh sửa hoặc tác giả hủy bản gửi.
7. Quản trị viên vào **Duyệt chương mới**, mở bản bổ sung, đọc nội dung rồi chọn quyết định. Khi yêu cầu sửa hoặc từ chối, cần nhập lý do.
8. Nếu được yêu cầu sửa, tác giả chỉnh bản bổ sung, lưu và gửi lại. Nếu đã từ chối/hủy, tạo một bản bổ sung mới.

### Trên Android

1. Đăng nhập tài khoản tác giả → **Truyện của tôi** → mở truyện đã xuất bản.
2. Chọn **Bổ sung chương / tập mới** ở phần xem trước mục lục.
3. Chọn nhập bằng tay hoặc EPUB, lưu bản nháp, xem trước và gửi duyệt.
4. Có thể xem trạng thái/lý do, sửa bản nhập tay được yêu cầu chỉnh sửa hoặc hủy bản gửi. Nhấn tải lại để lấy trạng thái mới.
5. Chỉnh mục lục EPUB và duyệt nội dung bổ sung thực hiện trên web.

## Quy tắc cần nhớ

- Nhập tay tối đa 100 chương/bản bổ sung, mỗi chương tối đa 500.000 ký tự; tổng yêu cầu JSON tối đa 12 MB. Tệp EPUB tối đa 100 MiB, tối đa 5.000 chương và 500 tập sau khi đọc cấu trúc.
- Chọn EPUB của phần mới. Hệ thống **chưa tự loại chương trùng** khi nhập lại cả truyện. Quản trị viên cần so với truyện hiện tại trước khi duyệt; có liên kết về chi tiết truyện.
- Chỉ nối vào tập cuối hoặc tạo tập mới để thứ tự mục lục nhất quán với nút chương trước/chương tiếp của trình đọc. Nếu một bản khác đã tạo tập mới trong lúc chờ duyệt, bản đang trỏ tới tập cũ cần được yêu cầu sửa và chọn lại tập cuối.
- Truyện bị ẩn: vẫn xem lịch sử/hủy bản bổ sung được, nhưng không tạo/gửi/xuất bản phần mới cho đến khi truyện được công khai lại.
- Ảnh trong bản bổ sung chưa duyệt chỉ chủ truyện và quản trị viên xem được. Sau khi duyệt, ảnh mới được công khai cùng chương. EPUB gốc không được mở công khai.
- Không dùng chức năng thay toàn bộ nội dung thủ công để thêm chương vào truyện đã xuất bản. API chặn thao tác đó để tránh xóa chương và tiến độ đọc cũ, kể cả truyện đã ẩn sau khi có phần bổ sung được xuất bản.
- Nhiều bản bổ sung cùng chờ duyệt được; thứ tự thực tế phụ thuộc lần duyệt. Cần duyệt theo thứ tự phần/tập mong muốn.

## Cập nhật và kiểm tra sau

1. Khởi động lại API để tự chạy migration **009-story-content-updates** (cần migration 008 trước đó).
2. Chạy lại web và Run app từ Android Studio để nhận màn hình mới.
3. Chọn một truyện đã xuất bản, lưu vị trí đọc của một tài khoản độc giả và theo dõi truyện đó.
4. Tác giả lưu/gửi một bản bổ sung. Độc giả vẫn chỉ thấy chương cũ, chưa có thông báo mới.
5. Quản trị viên yêu cầu sửa → tác giả sửa/gửi lại → quản trị viên duyệt.
6. Tải lại chi tiết truyện: thấy chương mới; bấm đọc tiếp vẫn về vị trí cũ. Trong thông báo, tài khoản theo dõi mở được chương vừa duyệt.
7. Thử EPUB có ảnh và thử hủy/từ chối: bản chưa duyệt không xuất hiện ở mục lục công khai.

## Phần triển khai

- `db/migrations/009-story-content-updates.ts`: bảng bản bổ sung, chương chờ duyệt và liên kết ảnh.
- `apps/api/src/routes/content-updates.ts`: quyền tác giả/admin, nháp, gửi, hủy, sửa và quyết định xuất bản.
- `apps/api/src/services/content-update-import.ts`: đọc EPUB, lưu ảnh riêng, dọn tệp nếu nhập thất bại.
- `apps/api/src/routes/media.ts`: chỉ công khai ảnh thuộc phần bổ sung đã xuất bản.
- `apps/web/src/ContentUpdates.tsx`: màn hình tác giả và hàng đợi duyệt chương.
- `apps/android/app/src/main/java/com/readlite/mobile/ContentUpdatesActivity.java`: gửi và theo dõi bản bổ sung trên điện thoại.

Việc xuất bản khóa hàng truyện trước, sau đó khóa bản bổ sung và chèn chương trong cùng giao dịch. Hai lần duyệt cùng bản không tạo chương trùng; lỗi ở bất kỳ bước nào sẽ hoàn tác cả chương, tập, tổng số chương, trạng thái và thông báo. Migration 008 tạo thông báo từ các chương thực sự được xuất bản.

Các kiểm tra tự động chạy với PostgreSQL trong bộ nhớ, không dùng cơ sở dữ liệu `readlite` cá nhân: quyền truy cập, CSRF, bản nháp không công khai, sửa/gửi lại, duyệt một lần, ảnh EPUB, giữ chương cũ, thông báo, hoàn tác khi lỗi và tương thích migration lõi. Android mới được kiểm tra nguồn/XML; cần build và kiểm tra màn hình trong Android Studio.

Kết quả kiểm tra khi triển khai: API build/typecheck/lint đạt; 30 kiểm tra API liên quan và 26 kiểm tra web đạt; web build/typecheck/lint đạt; 42 tệp XML tài nguyên Android cùng manifest đọc hợp lệ. Build Android từ môi trường công cụ bị dừng ở Gradle với lỗi `Unable to establish loopback connection`, nên chưa xác nhận APK mới biên dịch thành công.
