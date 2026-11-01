# Cách nói theo bài trình chiếu cơ sở dữ liệu ReadLite

Bài có 23 slide, chia thành 4 phần giống nhịp của file mẫu: **mục lục → trang mở phần → ví dụ cụ thể → tổng kết**. Thời lượng gợi ý là 10–12 phút, gồm khoảng 3 phút demo. Mỗi slide trong PowerPoint cũng có ghi chú người thuyết trình.

## Mở đầu: slide 1–2

| Slide | Nói gì |
|---|---|
| 1. Trang bìa | “ReadLite gồm ứng dụng Android cho người đọc và web cho tác giả, quản trị viên. Em trình bày cách PostgreSQL lưu và đồng bộ dữ liệu giữa hai giao diện.” |
| 2. Nội dung chính | “Em sẽ đi qua bốn phần: bối cảnh, thiết kế bảng, các thao tác ghi dữ liệu, rồi kiểm chứng bằng truy vấn và demo.” |

## Phần 1: Tổng quan hệ thống, slide 3–6

| Slide | Ý chính cần nói |
|---|---|
| 3. Mở phần | “Đầu tiên, em giải thích dữ liệu đi qua những thành phần nào.” |
| 4. ReadLite là ứng dụng gì? | Lấy một ví dụ: tác giả nhập truyện ở web; sau khi được duyệt, người đọc thấy trên Android. Từ đó nêu nhu cầu dữ liệu chung. |
| 5. Kiến trúc | Chỉ từ trái sang phải: **Android/web → REST API → PostgreSQL**. API xác thực và kiểm tra quyền; EPUB, ảnh nằm ở kho media. |
| 6. Dữ liệu nằm ở đâu? | Phân biệt bản ghi trong PostgreSQL, bytes tệp ở kho media và tùy chọn Reader trên thiết bị. Kết phần bằng câu: “Tiếp theo em đi vào cấu trúc bảng trong PostgreSQL.” |

## Phần 2: Thiết kế cơ sở dữ liệu, slide 7–11

| Slide | Ý chính cần nói |
|---|---|
| 7. Mở phần | “Phần hai là các bảng và quy tắc giữ dữ liệu nhất quán.” |
| 8. Nhóm bảng | Nêu chức năng của từng nhóm, không đọc hết tên bảng: người dùng, truyện, tủ sách, media và duyệt. |
| 9. Quan hệ | Lấy `stories` làm trung tâm: truyện có tập/chương, thuộc tác giả, gắn thể loại. `favorites` và `reading_progress` nối tài khoản với truyện. |
| 10. Ràng buộc | Cho ví dụ cụ thể: khóa ghép ngăn lưu trùng yêu thích; khóa ngoại ngăn tiến độ trỏ sang chương của truyện khác; `CHECK` giữ vị trí 0–1000. |
| 11. Migration | Mở `server.ts` nếu cần. Nói: “API chạy migration trước khi bắt đầu phục vụ request; nếu migration thất bại, API dừng.” Đoạn mã trên slide là **trích lược**. |

**Câu chuyển phần:** “Đã có bảng và ràng buộc, bây giờ em cho thấy các thao tác trên ứng dụng thực sự ghi dữ liệu gì.”

## Phần 3: Ghi và cập nhật dữ liệu, slide 12–16

| Slide | Ý chính cần nói |
|---|---|
| 12. Mở phần | Giới thiệu bốn nghiệp vụ: nhập EPUB, duyệt, yêu thích, lưu tiến độ. |
| 13. Nhập EPUB | EPUB được phân tích thành truyện, tập, chương và media. Các bước ghi database nằm trong transaction; lỗi thì rollback và dọn tệp mới tạo. Đoạn SQL trên slide chỉ là **mô tả luồng**, không phải câu lệnh nguyên văn. |
| 14. Duyệt truyện | Chỉ ba trạng thái: bản nháp riêng tư, hàng chờ, xuất bản công khai. AI là tùy chọn; không cấu hình AI vẫn duyệt thủ công được. |
| 15. Yêu thích | Chạm trái tim trên Android làm API ghi `favorites`. Khóa `(user_id, story_id)` ngăn trùng; truyện phải công khai và đã xuất bản. |
| 16. Tiến độ đọc | Giải thích `UPSERT`: đọc lần đầu thì thêm, đọc tiếp thì cập nhật chương/vị trí. `position_permille` nằm trong khoảng 0–1000. |

**Câu chuyển phần:** “Những dữ liệu vừa ghi sẽ được em kiểm chứng bằng truy vấn và thao tác trực tiếp.”

## Phần 4: Truy vấn và demo, slide 17–21

| Slide | Ý chính cần nói |
|---|---|
| 17. Mở phần | “Phần cuối cho thấy app chỉ đọc nội dung hợp lệ và dữ liệu người dùng được lưu đúng.” |
| 18. Catalog | API lọc `visibility = 'public'` và `moderation_status = 'published'`. Bản nháp không xuất hiện trong Khám phá. |
| 19. Quyền | API kiểm tra phiên và vai trò `user`, `author`, `admin` trước khi ghi; câu SQL dùng tham số. |
| 20. Demo | Đi đúng bốn bước ghi trên slide. Không nhập một EPUB lớn trực tiếp trong giờ thuyết trình. |
| 21. Mã nguồn | Giữ slide này cho hỏi đáp nếu thời gian ít. Mở file đã chuẩn bị sẵn theo câu hỏi của giảng viên. |

### Demo 3 phút cho slide 20

1. Trước giờ học chạy `docker compose up --build`. Kiểm tra `http://localhost:3000/api/v1/health`, web `http://localhost:8080`, và Android Emulator. Emulator gọi API qua `http://10.0.2.2:3000`.
2. Đăng nhập tài khoản thử nghiệm trên Android. Chọn một truyện đã xuất bản, bấm yêu thích, mở một chương rồi cuộn để lưu tiến độ.
3. Vào **Tủ sách** để cho thấy truyện yêu thích và chương đang đọc.
4. Chạy hai câu SQL dưới đây trong pgAdmin Query Tool. Thay email mẫu bằng email của tài khoản demo. Chỉ dùng truy vấn `SELECT` khi trình bày.

```sql
SELECT s.title, f.created_at
FROM favorites AS f
JOIN stories AS s ON s.id = f.story_id
JOIN users AS u ON u.id = f.user_id
WHERE u.email = 'email-demo@example.com'
ORDER BY f.created_at DESC
LIMIT 5;

SELECT s.title, c.title AS current_chapter,
       rp.position_permille, rp.last_read_at
FROM reading_progress AS rp
JOIN stories AS s ON s.id = rp.story_id
LEFT JOIN chapters AS c ON c.id = rp.current_chapter_id
JOIN users AS u ON u.id = rp.user_id
WHERE u.email = 'email-demo@example.com'
ORDER BY rp.last_read_at DESC
LIMIT 5;
```

Nếu muốn chứng minh việc duyệt truyện, chuẩn bị **trước** một bản nháp đã ở hàng chờ. Admin duyệt trên web, sau đó làm mới Android. Dùng truy vấn sau để chỉ ra trạng thái trước/sau:

```sql
SELECT id, title, visibility, moderation_status, total_chapters
FROM stories
ORDER BY updated_at DESC
LIMIT 10;
```

## Kết bài: slide 22–23

Ở slide 22, nhắc ba kết luận: một nguồn dữ liệu chung qua API; ràng buộc/transaction giữ dữ liệu đúng; chỉ truyện đã duyệt xuất hiện trên app. Slide 23 cảm ơn và chuyển sang hỏi đáp.

## Chuẩn bị các tab mã nguồn trước khi thuyết trình

| Nếu được hỏi | Mở file |
|---|---|
| “Bảng, khóa ngoại và ràng buộc ở đâu?” | `db/migrations/002-core-schema.ts`, thêm `db/migrations/003-story-submissions-media.ts` nếu hỏi EPUB/media. |
| “Migration chạy lúc nào?” | `apps/api/src/server.ts`; kết nối DB ở `apps/api/src/db/pool.ts`. |
| “Vì sao bản nháp không hiện trên app?” | `apps/api/src/routes/catalog.ts` và `apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java`. |
| “Yêu thích và đọc tiếp được lưu thế nào?” | `apps/api/src/routes/library.ts`, tìm `INSERT INTO favorites` và `INSERT INTO reading_progress`. |
| “Nhập EPUB lỗi giữa chừng thì sao?” | `apps/api/src/services/story-import-service.ts`, tìm `BEGIN`, `COMMIT`, `ROLLBACK`. |
| “Ai đổi trạng thái truyện?” | `apps/api/src/routes/admin-review.ts`. |
| “Lịch sử phân quyền nằm ở đâu?” | `db/migrations/007-account-role-events.ts` và `apps/api/src/routes/admin-users.ts`. |

**Lưu ý khi trả lời:** ReadLite dùng PostgreSQL ở máy chủ, không dùng SQLite của file ví dụ. File mẫu chỉ được dùng để tham khảo **cách chia phần và trình bày**, không lấy nội dung SQLite đưa vào ReadLite.
