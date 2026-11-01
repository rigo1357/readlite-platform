# Trạng thái tiến hành truyện

## Chức năng

Truyện có ba trạng thái sáng tác:

| Trạng thái | Ý nghĩa |
|---|---|
| Đang ra | Tiếp tục cập nhật nội dung; có thể tạo/gửi/duyệt phần bổ sung theo quy trình hiện có. |
| Hoàn thành | Đã kết thúc nội dung; cần ít nhất một chương để đánh dấu. Người theo dõi có thể nhận thông báo hoàn thành trong app. |
| Tạm ngưng | Dừng cập nhật, bắt buộc ghi lý do khi chuyển trạng thái. Các chương đã công khai vẫn đọc được. |

Trạng thái sáng tác độc lập với trạng thái duyệt/xuất bản và với tiến độ đọc của từng độc giả. Đánh dấu hoàn thành cho bản nháp không tự công khai truyện. Truyện hoàn thành hoặc tạm ngưng tiếp tục được đọc khi đang công khai và đã xuất bản.

## Trên web

1. Đăng nhập bằng tác giả sở hữu/gửi truyện hoặc quản trị viên.
2. Vào **Bản thảo/Kho truyện**, mở một truyện.
3. Tìm mục **Tiến hành truyện**, chọn trạng thái mới.
4. Khi tạm ngưng, nhập lý do; các trạng thái khác có thể thêm ghi chú. Ghi chú tối đa 2000 ký tự và chỉ xuất hiện trong phần quản lý.
5. Nhấn **Lưu trạng thái tiến hành** và xác nhận.
6. Mở **Lịch sử trạng thái** để xem trạng thái trước/sau, ghi chú, người thực hiện và thời điểm. Lịch sử phân trang 20 sự kiện; tên người xử lý được chụp lại khi lưu.

Không đổi trạng thái khi truyện đang chờ AI hoặc admin kiểm duyệt. Nếu quản trị viên/tác giả khác đã thay đổi trạng thái, dùng **Tải lại trạng thái** trước khi lưu lại. Các lần gửi lặp về cùng trạng thái không tạo lịch sử hay thông báo trùng.

## Trên Android

- Chi tiết truyện hiển thị **Tiến hành: Đang ra / Hoàn thành / Tạm ngưng**.
- **Khám phá** có bộ lọc trạng thái kết hợp từ khóa, thể loại và cách sắp xếp. Thẻ truyện trong kết quả cũng có trạng thái.
- Thông báo hoàn thành mở trang chi tiết truyện. Chương mới vẫn có thông báo riêng và mở trực tiếp chương.
- Thay đổi trạng thái sáng tác thực hiện trên web. Trong màn hình tác giả trên app, truyện hoàn thành hoặc tạm ngưng không hiện nút tạo phần bổ sung mới.

## Quy tắc bổ sung chương

Muốn thêm nội dung cho truyện hoàn thành hoặc tạm ngưng, chuyển lại **Đang ra** trước. Quy tắc áp dụng khi tạo bản nháp bổ sung, nhập EPUB, gửi duyệt và khi admin duyệt xuất bản. Bản đang chờ duyệt vẫn được giữ để xử lý sau khi truyện được mở cập nhật lại.

Một trigger PostgreSQL cũng chặn chèn chương mới vào truyện công khai đã xuất bản nếu truyện chưa ở trạng thái Đang ra. Đổi trạng thái giữ nguyên chương cũ, mã chương, tiến độ đọc, dấu trang và tổng số chương.

## Thông báo hoàn thành

- Chỉ gửi khi truyện **Hoàn thành + công khai + đã xuất bản**.
- Gửi cho người đang theo dõi, tài khoản hoạt động và đã xác minh email.
- Mỗi người nhận tối đa một thông báo hoàn thành trên mỗi truyện, dù trạng thái được đổi qua lại hoặc truyện được xuất bản lại.
- Theo dõi sau khi truyện đã hoàn thành không phát thông báo lịch sử ngay lúc theo dõi.
- Đánh dấu hoàn thành khi truyện đang ẩn/riêng tư chưa gửi thông báo. Khi công khai lại, các người theo dõi đủ điều kiện chưa nhận thông báo hoàn thành có thể nhận.
- Đây là thông báo trong app; cần mở/tải lại danh sách để xem. Ghi chú nội bộ của tác giả/admin không được đưa vào thông báo hay dữ liệu công khai.
- Trạng thái, lịch sử và thông báo được ghi trong cùng giao dịch; lỗi ghi dữ liệu sẽ hoàn tác toàn bộ.

## Cập nhật và dùng thử sau

1. Khởi động lại API để chạy migration **011-story-lifecycle** cùng các migration còn thiếu trước đó.
2. Chạy lại web và Run app trong Android Studio.
3. Các truyện hiện có mặc định **Đang ra**; tác giả/admin đặt lại trạng thái đúng với nội dung thực tế. Migration không tự suy đoán truyện đã kết thúc, không đổi nội dung hay gửi thông báo cũ.
4. Dùng một tài khoản độc giả theo dõi truyện và lưu vị trí đọc.
5. Tác giả chọn Tạm ngưng, nhập lý do: độc giả vẫn đọc tiếp được; tạo/duyệt phần bổ sung bị chặn.
6. Chuyển Đang ra, bổ sung và duyệt một chương. Sau đó chọn Hoàn thành: độc giả thấy nhãn mới và một thông báo hoàn thành.
7. Thử lọc Hoàn thành trong Khám phá và mở truyện; tiến độ đọc trước đó vẫn còn.

## Mã nguồn liên quan

- `db/migrations/011-story-lifecycle.ts`: cột trạng thái trên stories, lịch sử, loại thông báo hoàn thành, trigger kiểm tra chèn chương và thông báo.
- `apps/api/src/routes/story-lifecycle.ts`: quyền quản lý, cập nhật có phiên bản, kiểm tra trạng thái và lịch sử.
- `apps/api/src/routes/catalog.ts`: trạng thái công khai và bộ lọc `lifecycle=ongoing|completed|paused`.
- `apps/api/src/services/content-update-import.ts`: khóa truyện và kiểm tra Đang ra trong luồng bổ sung chương.
- `apps/web/src/StoryLifecycle.tsx`: biểu mẫu và lịch sử trên web.
- Android: `CatalogActivity`, `StoryDetailActivity`, `ReaderUpdatesActivity`, `StoryLifecycleLabels`.

API quản lý: `GET /api/v1/author/stories/:storyId/lifecycle?page=1` và `PATCH` cùng đường dẫn. Body cập nhật gồm `status`, `expectedVersion`, `note`; yêu cầu cookie phiên hợp lệ và CSRF. API công khai không trả ghi chú/lịch sử quản trị.

## Kiểm tra đã thực hiện

37 kiểm tra API liên quan và 37 kiểm tra web đạt; API/web build, typecheck và lint đạt. Các kiểm tra PostgreSQL chạy trong bộ nhớ, không kết nối database `readlite` cá nhân. Đã kiểm tra giữ chương/tiến độ, quyền và CSRF, trạng thái cũ, bản nháp không bị công khai, bộ lọc kết hợp, thông báo không trùng, chặn duyệt phần bổ sung và hoàn tác khi lỗi.

42 tệp XML tài nguyên Android được đọc hợp lệ. Build Android qua công cụ vẫn bị dừng ở Gradle với lỗi `Unable to establish loopback connection`; chưa xác nhận APK mới biên dịch hoặc giao diện chạy trên máy giả lập.
