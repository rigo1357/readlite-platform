# Thiết kế giao diện và nhập truyện Android ReadLite

- Ngày: 2026-10-20
- Trạng thái: Bản thiết kế cập nhật để người dùng duyệt
- Phạm vi: Ứng dụng Android hiện tại, API và dữ liệu cần thiết cho luồng gửi EPUB
- Thay đổi so với bản trước: bổ sung ảnh truyện và luồng tác giả/quản trị viên gửi EPUB chờ duyệt

## Mục tiêu

Làm mới giao diện ReadLite dựa trên ảnh cũ của ReadLite và giữ các luồng nghiệp vụ đã thống nhất: khám phá, xếp hạng, tủ sách, tài khoản, chi tiết truyện và Reader. Bổ sung luồng tác giả/quản trị viên chọn EPUB, xem trước cấu trúc cùng ảnh, rồi gửi vào quy trình kiểm duyệt.

Hai EPUB người dùng gửi dùng làm mẫu tương thích và kiểm tra sau này. Không chép nội dung truyện hay file EPUB vào repository hoặc seed database.

## Quyết định thiết kế

Chọn hướng kết hợp theo ReadLite: giữ màu xanh và tên thương hiệu ReadLite; lấy cấu trúc trang chủ, tủ sách và trải nghiệm đọc từ ảnh ReadLite cũ; điều chỉnh thành giao diện hiện đại, dễ đọc và có đủ bốn khu vực chính. Ảnh Ranobe Hub và ứng dụng khác chỉ là tài liệu tham khảo, không sao chép bố cục hoặc thương hiệu.

Người dùng duyệt luồng tác giả/quản trị viên gửi EPUB qua API thành bản nháp chờ AI rà soát và quản trị viên duyệt. Đây là nội dung chung của catalog. Nhập EPUB riêng chỉ lưu trong tủ sách cá nhân trên máy chưa nằm trong phạm vi.

## Điều hướng chính

Thanh điều hướng dưới có bốn mục trên màn hình gốc:

1. Khám phá
2. Xếp hạng
3. Tủ sách
4. Tài khoản

Màn hình chi tiết, Reader, trình nhập EPUB và hàng đợi duyệt là màn hình con; mỗi màn hình con có đường quay lại rõ ràng. Không để tiêu đề hoặc nội dung bị status bar che. Thẻ truyện phải mở màn hình chi tiết khi chạm.

## Thiết kế màn hình

### Khám phá

- Thanh đầu trang mang thương hiệu ReadLite và lối vào tài khoản.
- Ô tìm theo tên truyện, tác giả hoặc nội dung; bộ lọc thể loại có thể cuộn ngang hoặc mở danh sách.
- Nếu người dùng có tiến độ, đặt thẻ Đọc tiếp gần đầu trang; hiển thị bìa, chương hiện tại và tiến độ.
- Các dãy bìa gồm Mới cập nhật, Được đánh giá cao và Gợi ý cho bạn khi API gợi ý đã sẵn sàng.
- Thẻ truyện hiển thị bìa tỷ lệ 2:3, tên truyện, tác giả và chỉ số có dữ liệu. Bìa thiếu/lỗi dùng ảnh thay thế có tên truyện.

### Xếp hạng

- Các lựa chọn gồm Mới cập nhật, Phổ biến và Đánh giá cao.
- Mỗi dòng có thứ hạng, bìa, tên truyện, tác giả và số liệu API thực sự trả về.
- Bộ lọc thể loại tiếp tục truy cập được. Không tạo thứ hạng giả khi dữ liệu chưa có.

### Tủ sách

- Hai nhóm: Đang đọc và Yêu thích.
- Đang đọc hiển thị chương và tiến độ đã đồng bộ; nút tiếp tục mở đúng vị trí đã lưu.
- Yêu thích dùng trạng thái tim trên thẻ truyện; nhấn lần nữa sẽ bỏ lưu.
- Trạng thái rỗng hướng dẫn tìm hoặc lưu truyện. Tủ sách yêu cầu đăng nhập và thông báo rõ khi phiên hết hạn.

### Tài khoản và khu vực quản lý

- Hiển thị tài khoản, theme sáng/tối, trạng thái đăng nhập và đăng xuất.
- Tác giả thấy mục Truyện của tôi và Gửi truyện.
- Quản trị viên thấy mục Hàng đợi duyệt và các truyện cần xem xét.
- Người đọc thường không thấy các chức năng tạo hoặc duyệt truyện.
- Vai trò quản trị viên tạo truyện vẫn phải có một quản trị viên khác duyệt.

### Chi tiết truyện

- Có nút quay lại, bìa, tên truyện, tác giả, thể loại, trạng thái và điểm đánh giá khi có dữ liệu.
- Có nút Đọc ngay/Đọc tiếp và nút tim để lưu vào tủ sách.
- Phần giới thiệu có thể thu gọn/mở rộng.
- Mục lục hiển thị Tập rồi đến Chương khi có dữ liệu phân cấp; dữ liệu chương phẳng vẫn hiển thị đúng thứ tự.
- Dành vị trí cho đánh giá, bình luận và truyện tương tự; chỉ bật khi API tương ứng sẵn sàng.

### Gửi truyện bằng EPUB

Luồng gửi truyện nằm trong khu vực tác giả/quản trị viên:

1. Chọn Gửi truyện rồi chọn file .epub bằng bộ chọn tài liệu Android.
2. Ứng dụng gửi file lên API làm bản nháp. Không gửi file vào repository.
3. API kiểm tra file và phân tích metadata, bìa, mục lục, thứ tự spine, chương và ảnh được tham chiếu trong nội dung.
4. Màn hình xem trước hiển thị tên truyện/tác giả, bìa, thể loại, ngôn ngữ nếu xác định được, danh sách tập/chương và ảnh trong chương. Người gửi có thể sửa metadata, thay bìa, bỏ mục lục sai và xem cảnh báo.
5. Người gửi xác nhận gửi duyệt. Hệ thống AI rà soát nội dung và ghi cảnh báo; AI không tự xuất bản.
6. Quản trị viên xem metadata, nội dung, ảnh và cảnh báo AI rồi duyệt hoặc từ chối kèm lý do. Truyện do quản trị viên tạo cần một quản trị viên khác duyệt.
7. Chỉ truyện được duyệt mới xuất hiện trong catalog công khai.

Màn hình lỗi cần phân biệt EPUB hỏng/không hỗ trợ, không đọc được mục lục, thiếu chương, ảnh lỗi, file quá lớn và lỗi mạng; giữ bản nháp để người gửi có thể sửa hoặc tải lại.

### Chi tiết truyện và ảnh

- Bìa truyện dùng ảnh riêng; có ảnh thay thế nếu chưa có bìa.
- Nội dung EPUB có thể chứa ảnh minh họa giữa chương. Ảnh được giữ cùng thứ tự và vị trí tương đối với đoạn văn.
- Với EPUB gửi lên, màn hình xem trước cho phép thay bìa hoặc kiểm tra ảnh nhúng. Luồng tạo thủ công sau này cũng cần chọn ảnh bìa và thêm ảnh chương.

### Reader

- Thanh trên có quay lại, tên truyện/chương và nút mở mục lục.
- Nội dung hiển thị đoạn văn, định dạng cơ bản và ảnh minh họa; không hiện thẻ HTML/CSS hay metadata EPUB như văn bản chương.
- Android dùng nội dung đã được API làm sạch và renderer chỉ cho phép ảnh từ media ReadLite; không thực thi script hoặc mở điều hướng tùy ý từ EPUB.
- Thanh điều khiển có A−, A+, tiến độ, chương trước/sau và chọn chương.
- Lưu vị trí theo chương và phần trăm; mở lại truyện sẽ khôi phục vị trí gần nhất.
- Theme Reader theo cài đặt toàn app và giữ độ tương phản dễ đọc.

## Hệ thống giao diện

- Sáng: nền xanh xám rất nhạt, bề mặt trắng, chữ xanh đen và xanh lá đậm cho hành động.
- Tối: nền than, thẻ sáng hơn nền và chữ trắng ngà; giữ màu xanh ReadLite cho hành động chính.
- Vàng ấm dùng tiết chế cho huy hiệu xếp hạng.
- Khoảng cách theo nhịp 8 dp; thẻ bo góc vừa phải; bìa giữ tỷ lệ 2:3.
- Cỡ chữ rõ trên điện thoại; vùng bấm tối thiểu 48 dp.
- Tất cả màn hình áp dụng system bar insets nhất quán, kể cả khi bàn phím mở hoặc nội dung cuộn.

## Thiết kế lưu trữ và API

- Android tải file EPUB lên API; API dùng cùng một bộ phân tích cho các client, để TOC và chương không bị parse khác nhau trên từng thiết bị.
- File EPUB gốc và ảnh tách ra được lưu ngoài PostgreSQL. Cơ sở dữ liệu giữ metadata, trạng thái duyệt, khóa media, loại MIME, kích thước và quan hệ ảnh với truyện/chương.
- Môi trường phát triển dùng bộ lưu trữ file riêng của API, không đặt trong thư mục public tùy ý; có thể thay backend lưu trữ bằng object storage khi triển khai.
- Ảnh của bản nháp chỉ người gửi và quản trị viên được quyền xem; ảnh của truyện công khai theo cùng quyền hiển thị với truyện.
- API trả nội dung chương đã làm sạch với tham chiếu ảnh nội bộ. Client không dùng đường dẫn file tùy ý trong EPUB.
- Vai trò, bảng tập, media và trạng thái kiểm duyệt cần migration/API riêng. Schema hiện có chỉ có vai trò user/admin, URL bìa và chương phẳng; chưa có upload endpoint hay kho media.

## Nhập EPUB mẫu

Hai file mẫu là EPUB 2 và dùng mục lục NCX. Một file có các tài liệu chương bị chia nhỏ; file kia có tiêu đề chương kèm metadata trang web. Bộ phân tích cần dựa vào OPF manifest/spine và NCX để tạo chương đúng thứ tự, nhóm các phần chia nhỏ theo mục lục, và làm sạch nội dung trang web rác.

Metadata ngôn ngữ trong EPUB có thể sai. Màn hình xem trước phải cho phép người gửi sửa ngôn ngữ và thông tin, không tự tin tuyệt đối vào metadata. Không hiển thị CSS hoặc markup thô trong Reader.

## Luồng nghiệp vụ được giữ

Đăng nhập thành công trở về Khám phá; truyện mở được từ Khám phá, Xếp hạng hoặc Tủ sách; nút quay lại hoạt động; yêu thích dùng API; theme áp dụng toàn app; Reader có mục lục, cỡ chữ, ảnh và tiến độ đồng bộ.

Nút mở chi tiết trên thẻ truyện và tên truyện là bắt buộc vì thao tác này hiện đã thất bại khi kiểm tra emulator.

## Phạm vi để giai đoạn sau

Đánh giá/bình luận, gợi ý, kiểm duyệt AI hoàn chỉnh và hàng đợi duyệt là các giai đoạn nghiệp vụ cần nối với API. Thiết kế xác định nơi đặt các chức năng và quy trình, nhưng không giả lập kết quả AI hoặc trạng thái duyệt nếu dịch vụ/API chưa có.

Đợt đầu tập trung vào giao diện Android đang có và luồng đọc hiện tại. Nhập EPUB đầy đủ cần parser, migration, API upload, lưu media, phân quyền, kiểm duyệt và Reader hỗ trợ nội dung có ảnh; không gộp tất cả thành một chỉnh sửa XML nhỏ.

## Tiêu chí nghiệm thu

- Bốn mục điều hướng hiện rõ; không có tiêu đề/nội dung bị system bar che.
- Thẻ truyện mở được màn hình chi tiết; trang chi tiết và Reader có nút quay lại.
- Có tìm kiếm, thể loại, xếp hạng, tủ sách, mục lục, cỡ chữ, tiến độ và theme sáng/tối.
- Tác giả/quản trị viên có thể mở bộ chọn EPUB; người đọc thường không thấy chức năng này.
- Xem trước thể hiện metadata, tập/chương và ảnh bìa/ảnh trong nội dung trước khi gửi duyệt.
- Nội dung đã duyệt hiển thị ảnh đúng vị trí trong Reader; EPUB không tạo HTML/CSS thô hoặc script chạy trong app.
- AI chỉ đưa cảnh báo; quản trị viên quyết định duyệt; quản trị viên tạo truyện phải được quản trị viên khác duyệt.
- Trạng thái đang tải, rỗng, lỗi mạng, file không hợp lệ và chưa đăng nhập có thông báo rõ.
- Không đưa EPUB mẫu hoặc nội dung truyện vào repository/database mẫu.

## Rủi ro và giới hạn

API hiện chưa có vai trò tác giả, media storage, upload, bảng tập hoặc workflow duyệt. Các phần này cần migration và endpoint mới. Parser cần giới hạn kích thước và số lượng entry, chặn đường dẫn ZIP thoát thư mục, chỉ chấp nhận media hợp lệ, và làm sạch XHTML trước khi Reader hiển thị.
