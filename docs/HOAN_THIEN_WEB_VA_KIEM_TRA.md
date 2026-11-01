# Hoàn thiện web ReadLite và hướng dẫn kiểm tra tổng hợp

## Phạm vi đã hoàn tất

Cập nhật 30/10/2026: dashboard và hệ màu đã được tinh chỉnh theo `profile wibu.zip`, dùng Be Vietnam Pro lưu cục bộ. Xem [giao diện dashboard mới](GIAO_DIEN_DASHBOARD.md); các bước kiểm tra nghiệp vụ bên dưới vẫn áp dụng.

Đợt này hoàn thiện đồng bộ giao diện web quản trị/tác giả theo màu trắng và cam nhạt đã chốt. Giao diện tối dùng nâu ấm và cam. Các màn hình dùng chung tiêu đề, biểu mẫu, biểu tượng, bước xác nhận và trạng thái phản hồi.

| Khu vực | Nội dung đã hoàn thiện |
| --- | --- |
| Đăng nhập | Lỗi rõ ràng, hiện/ẩn mật khẩu, khóa biểu mẫu khi đang gửi |
| Điều hướng | Biểu tượng thống nhất; menu mở/đóng trên điện thoại, tự đóng khi chọn trang |
| Tổng quan | Số liệu từ các API hiện có, liên kết tới hàng đợi/kho truyện/báo cáo/tài khoản; không hiển thị số 0 thay dữ liệu chưa tải được |
| Kho truyện / Bản thảo | Nhập EPUB, kết quả từng tệp, tìm không dấu, lọc trạng thái, chọn nhiều bản nháp gửi duyệt |
| Tạo truyện | Biểu mẫu thông tin, thể loại và chương; khóa các trường khi đang lưu, tránh tạo lại bản nháp khi chỉ ảnh bìa bị lỗi |
| Chi tiết truyện | Liên kết tới từng phần, metadata, ảnh bìa, mục lục, nội dung và quản lý trên app; khóa metadata trong lúc chờ duyệt |
| Lưu nội dung | Lưu thông tin, bìa, chương hoặc mục lục riêng; giữ các phần khác đang chỉnh sửa; chặn gửi duyệt nếu còn thay đổi chưa lưu |
| Tiến hành truyện | Đang ra / Hoàn thành / Tạm ngưng, ghi chú, lịch sử và thông báo lưu thành công |
| Bổ sung chương | Tạo bản nhập tay/EPUB theo luồng hiện có; xem trước, gửi duyệt, hủy và phản hồi trạng thái rõ ràng |
| Duyệt truyện | Tìm/lọc theo AI, chọn nhiều mục, xác nhận có danh sách tên, kết quả riêng từng truyện và thử lại phần lỗi |
| Duyệt chương mới | Hàng đợi có phân trang, xem chương trước quyết định, quyền xuất bản chỉ dành cho quản trị viên |
| Quản lý tài khoản | Tìm/lọc, đổi vai trò, khóa/mở khóa có lý do, lịch sử; giữ điều kiện bảo vệ tài khoản của mình và tài khoản chưa đủ điều kiện |
| Báo cáo | Lọc trạng thái, xem lý do/nội dung, xác nhận xóa/ẩn; nội dung không còn tồn tại chỉ được hoàn tất báo cáo |
| Tài khoản cá nhân | Thông tin, vai trò, xác minh email và đăng xuất; hướng dẫn mở Sửa hồ sơ trong Android |
| Xác nhận thao tác | Hộp thoại trong giao diện thay `window.confirm`, có đối tượng, mô tả, Hủy, Escape và nút xác nhận riêng |

Không đổi schema PostgreSQL, tuyến API hoặc mã Android trong đợt giao diện này. Không có migration mới. Các điều kiện nghiệp vụ tại máy chủ vẫn được giữ nguyên.

## Khởi động để kiểm tra

Mở hai cửa sổ PowerShell tại thư mục dự án, dùng cấu hình PostgreSQL đang chạy bình thường của bạn.

Cửa sổ thứ nhất:

```powershell
npm run dev:api
```

Cửa sổ thứ hai:

```powershell
npm run dev:web
```

Mở <http://localhost:5173>. Nếu web đang chạy thì chỉ cần tải lại trang để nhận bản mới. Dùng database ứng dụng `readlite`; `readlite_test` dành cho kiểm thử tự động có database.

## Kiểm tra một lượt theo đúng luồng sử dụng

Chuẩn bị một tài khoản quản trị viên, một tài khoản tác giả/tài khoản phụ và vài truyện mẫu. Dùng bản thảo mẫu cho các thao tác xóa/ẩn và thử nhập EPUB.

| Bước | Thao tác | Kết quả cần thấy |
| --- | --- | --- |
| 1 | Đăng nhập sai một lần, sửa lại rồi đăng nhập đúng; thử hiện/ẩn mật khẩu | Có thông báo lỗi, sửa được dữ liệu, không cần xóa site data để đăng nhập lại |
| 2 | Mở Tổng quan; bấm các số liệu/liên kết | Đến đúng hàng đợi hoặc kho nội dung; số lượng phù hợp dữ liệu đang có |
| 3 | Vào Kho truyện, chọn vài EPUB và nhập | Mỗi tệp có trạng thái; tệp thành công mở được bản nháp; không chọn lại tệp trong lúc đang nhập |
| 4 | Tạo một truyện nhập tay có thể loại, thông tin và một chương | Lưu được bản nháp, tự mở chi tiết; không tạo thêm bản nháp khi bấm lặp trong lúc lưu |
| 5 | Trong chi tiết, gõ tên truyện nhưng chưa lưu; sửa tên chương rồi lưu chương | Tên truyện đang gõ vẫn còn. Làm ngược lại: lưu thông tin phải giữ nội dung chương đang gõ |
| 6 | Lưu hết các phần đã sửa rồi gửi duyệt | Khi còn thay đổi chưa lưu, có thông báo và nút gửi bị khóa. Lưu xong thì gửi được; metadata bị khóa trong lúc chờ duyệt |
| 7 | Dùng admin mở Duyệt truyện; tìm không dấu, thử các bộ lọc AI | Phân biệt rõ duyệt thủ công, cảnh báo và đã rà soát; thay bộ lọc không mất lựa chọn |
| 8 | Chọn nhiều truyện, mở xác nhận rồi Hủy; mở lại và xác nhận | Hủy không gửi quyết định; xác nhận ghi rõ tên/số lượng. Từng truyện có kết quả riêng, mục lỗi được giữ lại để thử lại |
| 9 | Mở Android và tải lại danh mục sau khi duyệt truyện mẫu | Truyện được duyệt xuất hiện, mở chi tiết/chương được; bản nháp chưa duyệt không xuất hiện công khai |
| 10 | Với truyện đang ra đã xuất bản, tạo bản bổ sung chương, gửi và duyệt ở Duyệt chương mới | Bản bổ sung có trạng thái riêng; admin xem trước rồi quyết định; chương cũ và vị trí đọc được giữ lại |
| 11 | Đổi tiến hành sang Tạm ngưng, thử khi chưa nhập ghi chú rồi nhập và lưu | Chưa có ghi chú thì không lưu được Tạm ngưng. Có xác nhận, trạng thái/lịch sử cập nhật, phần khác đang sửa không mất |
| 12 | Vào Phân quyền, chọn tài khoản phụ; đổi vai trò, khóa có lý do, xem lịch sử rồi mở khóa | Có xác nhận và phản hồi; không tự khóa/đổi quyền tài khoản admin đang dùng; tài khoản được mở khóa cần đăng nhập mới theo nghiệp vụ hiện có |
| 13 | Vào Báo cáo; lọc, xử lý một nội dung mẫu, thử Hủy ở xác nhận xóa/ẩn | Hủy không thay đổi nội dung; xử lý xong chuyển đúng trạng thái. Báo cáo mất nội dung gốc không có lựa chọn xóa nội dung đó |
| 14 | Đăng nhập bằng tác giả, mở thử đường dẫn `/users`, `/reports`, `/reviews` | Không vào được khu vực admin, có đường quay lại bản thảo; tác giả không có nút xuất bản chương |
| 15 | Mở Tài khoản rồi đăng xuất, đăng nhập lại | Trở lại màn đăng nhập và vào lại bình thường, không cần F12/clear site data |
| 16 | Thử điện thoại/màn hình hẹp và giao diện tối; có trên 20 tài khoản/chương mới hoặc trên 10 báo cáo thì thử sang trang | Menu thu gọn hoạt động, không tràn ngang, các nút/biểu mẫu dùng được; sang trang hiển thị đúng dữ liệu |

Khi nhập EPUB lại sau lỗi mất kết nối mà chưa biết máy chủ đã nhận hay chưa, kiểm tra Kho truyện trước để tránh tự nhập trùng. Danh sách kết quả nhập hiện tại nằm trong bộ nhớ trang; tải lại trang sẽ mất danh sách kết quả này.

## Đã được kiểm tra trong đợt hoàn thiện

- 55 kiểm thử web qua 9 tệp; kiểm tra kiểu dữ liệu, lint và build web.
- Trình duyệt với API giả lập riêng trên loopback, không dùng database ứng dụng: đăng nhập sai/đúng, hiện/ẩn mật khẩu, đăng xuất/đăng nhập lại, quyền hiển thị của admin/tác giả.
- Đổi vai trò, hủy/xác nhận, khóa/mở khóa có lý do và xem lịch sử trên tài khoản giả lập.
- Báo cáo trống, xử lý bình luận và báo cáo mất nội dung gốc.
- Tạo bản thảo nhập tay; lưu chéo thông tin/chương/mục lục và kiểm tra phần chưa lưu được giữ lại; chặn gửi duyệt khi chưa lưu; khóa metadata sau gửi duyệt.
- Đổi tiến hành có ghi chú và xác nhận; giữ chương đang chỉnh sửa khi cập nhật trạng thái.
- Duyệt hàng loạt với một lỗi giả lập, thử lại chỉ truyện lỗi; xác nhận xuất bản chương, tạo/hủy bản bổ sung, tác giả gửi duyệt nhưng không có nút xuất bản.
- Hủy và xác nhận xóa/ẩn truyện giả lập; thử Escape ở xác nhận.
- Phân trang dữ liệu giả lập: 26 tài khoản, 13 báo cáo, 22 bản bổ sung chờ duyệt. Trang 2 lần lượt hiện 6, 3 và 2 mục.
- Kiểm tra màn hình điện thoại 390 px và kích thước trung gian 820 px, giao diện sáng/tối; các trang được rà soát không tràn ngang hoặc trùng mã phần nội dung.

Các bước trên xác minh giao diện và cách gọi API bằng dữ liệu giả lập. Cần chạy bảng kiểm với EPUB và API/PostgreSQL thật của bạn để xác minh file, ảnh, đồng bộ Android và thông báo thực tế. Công cụ detector Impeccable chưa chạy vì engine/bộ nhớ đệm chưa khả dụng; không coi việc cài skill là một lần quét đã đạt.

## Vị trí mã chính

- `apps/web/src/WorkspaceUI.tsx`: tiêu đề, biểu tượng, hộp xác nhận và điều phối xác nhận.
- `apps/web/src/App.tsx`: khung web, đăng nhập, Tổng quan, tạo/chi tiết truyện, báo cáo và Tài khoản.
- `apps/web/src/ManagedUsers.tsx`: quản lý tài khoản và lịch sử.
- `apps/web/src/StoryLibrary.tsx`: nhập EPUB và tìm/lọc kho truyện.
- `apps/web/src/StoryReviewQueue.tsx`, `ModerationUI.tsx`: hàng đợi và quyết định kiểm duyệt.
- `apps/web/src/ContentUpdates.tsx`, `StoryLifecycle.tsx`: bổ sung chương và tiến hành truyện.
- `apps/web/src/styles.css`: bảng màu và bố cục cho các kích thước màn hình.

Nếu cần chạy lại kiểm tra mã web:

```powershell
npm run test --workspace @readlite/web
npm run typecheck --workspace @readlite/web
npm run lint --workspace @readlite/web
npm run build --workspace @readlite/web
```
