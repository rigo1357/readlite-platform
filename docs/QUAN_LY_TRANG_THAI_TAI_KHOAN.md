# Quản lý khóa và mở khóa tài khoản

## Chức năng

Quản trị viên vào **Phân quyền** trên web để mở màn hình **Quản lý tài khoản**. Màn hình gồm:

- Tìm theo email, tên đăng nhập hoặc tên hiển thị.
- Lọc tất cả, đang hoạt động hoặc đã khóa; phân trang 20 tài khoản.
- Đổi vai trò người đọc/tác giả/quản trị viên theo quy tắc hiện có.
- Khóa hoặc mở khóa tài khoản, nhập lý do bắt buộc từ 1–2000 ký tự và xác nhận.
- Xem lịch sử khóa/mở: trạng thái trước/sau, lý do, người thực hiện và thời điểm; phân trang 20 sự kiện.

Lý do và lịch sử chỉ được tra cứu qua quyền quản trị. Tên người thực hiện được chụp lại khi xử lý để lịch sử vẫn rõ khi admin đổi tên hoặc xóa tài khoản.

## Quy tắc nghiệp vụ

1. Chỉ admin đang hoạt động và đã xác minh email được xử lý tài khoản. Quyền được kiểm tra lại trong giao dịch trước khi thay đổi.
2. Admin không tự khóa tài khoản của mình. API giữ ít nhất một admin đang hoạt động, đã xác minh; thao tác đổi quyền, khóa và tự xóa tài khoản cùng dùng khóa giao dịch để bảo vệ điều kiện này.
3. Tài khoản bị khóa bị chặn đăng nhập và các thao tác cần phiên hợp lệ. Danh mục công khai tiếp tục hoạt động theo quyền khách hiện có.
4. Mỗi lần khóa hoặc mở khóa tăng phiên bản phiên đăng nhập và thu hồi các refresh token còn hiệu lực. Sau khi mở khóa, người dùng đăng nhập lại; access token và refresh token cũ tiếp tục bị vô hiệu.
5. Việc chặn có hiệu lực ở yêu cầu tiếp theo đến API; yêu cầu đã bắt đầu và dữ liệu đã tải trên thiết bị không phải thông báo đẩy để thu hồi từ xa.
6. Web đang mở phiên bị khóa nhận thông báo và trở về đăng nhập khi API trả lỗi thu hồi/khóa. Các cookie phiên được xóa từ phản hồi API.
7. Tác giả bị khóa vẫn được giữ dữ liệu. Admin xử lý từng truyện/bình luận/đánh giá qua các mục quản lý nội dung và Báo cáo.
8. Mở khóa khôi phục trạng thái hoạt động; vai trò, tình trạng xác minh email và mật khẩu được giữ nguyên.
9. Nếu màn hình admin đã cũ so với trạng thái trên máy chủ, API từ chối thay đổi và yêu cầu tải lại. Gửi lặp một yêu cầu có trạng thái đích đã áp dụng không tạo thêm lịch sử.
10. Trạng thái, phiên bản phiên, thu hồi refresh token và sự kiện lịch sử được lưu trong một giao dịch. Lỗi ở một bước sẽ hoàn tác toàn bộ thao tác.

## Cập nhật để sử dụng

1. Khởi động lại API để tự chạy migration **010-account-status-management**.
2. Chạy lại web và mở **Phân quyền** bằng tài khoản admin.
3. Các tài khoản hiện có được giữ nguyên; phiên đang dùng tiếp tục hợp lệ cho đến khi bị thu hồi hoặc hết hạn.

Không cần sửa app Android để API thực thi quyền khóa. Thông báo điều hướng về đăng nhập tự động được bổ sung trên web; trên Android, màn hình hiện tại hiển thị lỗi API theo cách xử lý sẵn có.

## Các bước dùng thử sau

1. Chuẩn bị một admin và một tài khoản người đọc/tác giả dùng thử. Đăng nhập tài khoản dùng thử ở trình duyệt khác hoặc app.
2. Admin tìm tài khoản, chọn **Khóa tài khoản**, nhập lý do và xác nhận.
3. Tài khoản dùng thử gọi một chức năng cần đăng nhập: API chặn phiên. Đăng nhập lại bằng đúng mật khẩu cũng bị chặn khi đang khóa.
4. Admin lọc **Đã khóa**, mở **Lịch sử khóa/mở** để xem sự kiện vừa tạo.
5. Admin chọn **Mở khóa**, nhập lý do. Người dùng đăng nhập mới và tiếp tục dùng dữ liệu cũ.
6. Xem lịch sử có cả khóa và mở; tài khoản admin hiện tại không có nút tự khóa dùng được.
7. Khi thử bằng hai admin, giữ một hộp thoại cũ, để admin còn lại đổi trạng thái rồi thử gửi hộp thoại cũ: hệ thống yêu cầu tải lại.

## Phần triển khai

- Migration `010-account-status-management`: thêm `session_version`, lý do/thời điểm trạng thái trên `users`; bảng `account_status_events`.
- `apps/api/src/routes/admin-users.ts`: danh sách/bộ lọc/phân trang, cập nhật trạng thái và lịch sử riêng theo tài khoản.
- `apps/api/src/middleware/session-status.ts`: kiểm tra trạng thái và phiên bản JWT tại API; thu hồi cookie của phiên bị chặn.
- `apps/api/src/routes/auth.ts`: phát JWT có phiên bản; đăng nhập và refresh khóa hàng người dùng trước khi tạo/đổi token; bảo vệ admin cuối khi tự xóa tài khoản.
- `apps/web/src/ManagedUsers.tsx`: trang tài khoản, hộp thoại lý do, lịch sử.
- `apps/web/src/api/admin.ts` và `App.tsx`: xử lý phiên bị khóa/thu hồi trên web.

API mới:

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET | `/api/v1/admin/users?search=&status=all&page=1` | Tra cứu tài khoản; `status`: `all`, `active`, `blocked` |
| PATCH | `/api/v1/admin/users/:userId/status` | Body gồm `isActive`, `reason`, `expectedStatusVersion`; cần CSRF |
| GET | `/api/v1/admin/users/:userId/status-history?page=1` | Trạng thái tài khoản và lịch sử khóa/mở |

Kiểm tra tự động sử dụng PostgreSQL trong bộ nhớ, không kết nối database `readlite` cá nhân. Đã kiểm tra quyền admin/CSRF, lý do, phiên trước/sau khóa, mở khóa và đăng nhập mới, màn hình cũ của admin khác, hoàn tác khi ghi lịch sử lỗi, tên người xử lý và điều kiện admin cuối cùng. Các kiểm tra web bao gồm nút/quyền hiển thị, lý do bắt buộc, phân trang, escape nội dung và thông báo hết phiên.
