# ReadLite Platform — Thiết kế Giai đoạn 0

## Mục tiêu

Khởi tạo một dự án ReadLite mới có ba phần dùng chung một nền tảng dữ liệu: ứng dụng Android native cho điện thoại, giao diện web responsive và backend REST API chạy trên web. App Android cũ viết bằng Java/SQLite là tài liệu nghiệp vụ và giao diện tham khảo. Các thư mục cũ không bị sửa; dữ liệu SQLite cũ chưa được tự động chuyển trong Giai đoạn 0.

Giai đoạn 0 tạo ba shell tối thiểu, API health, PostgreSQL 16, migration nền, Compose, hướng dẫn chạy và kiểm tra kết nối Android tới API. Nghiệp vụ thư viện, đăng nhập, nhập EPUB, đồng bộ và social sẽ theo thứ tự giai đoạn trong prompt.

## Giả định đã xác nhận

- Ứng dụng điện thoại là **Android native**, theo lựa chọn của người dùng và lịch sử app Java/SQLite.
- Cần cả giao diện web riêng và backend REST API; web và Android gọi cùng API.
- Giao diện web dùng React 18, Vite và TypeScript; backend dùng Node.js 22 LTS, Express và TypeScript.
- PostgreSQL 16 là nguồn dữ liệu chuẩn cho nhiều người dùng. API truy vấn bằng `pg` với parameterized query, xác thực input bằng Zod và quản lý schema bằng `node-pg-migrate`.
- Android dùng Java/XML và Android Gradle Plugin 9.3.3, Gradle 9.5, compile/target SDK 37, min SDK 24 để khớp dòng công cụ của dự án Android mới nhất trong lịch sử.
- Local chạy API, web, PostgreSQL và Mailpit bằng `docker compose up`; Android build/chạy riêng bằng Android Studio hoặc Gradle wrapper.
- Giai đoạn 0 chưa có bảng nghiệp vụ, đăng nhập, CRUD truyện, import EPUB hay đồng bộ SQLite. Không ghi production secret vào repo.

## Phương án kiến trúc

### Phương án A — Một monorepo, hai client và một API (được chọn)

`apps/android` chứa app Android Java, `apps/web` chứa SPA React, `apps/api` chứa Express REST API, `db/` chứa migration PostgreSQL. Compose khởi chạy API, web, Postgres và Mailpit; Android kết nối API từ emulator/device bên ngoài Compose. Cách này cho phép hai client chia sẻ cùng tài khoản và nghiệp vụ mà không tạo hai backend.

### Phương án B — Tách app Android thành repo riêng

API/web và Android có vòng đời triển khai độc lập hơn, nhưng giai đoạn đầu phải duy trì nhiều repo, cấu hình base URL và hợp đồng API giữa các repo. Chưa chọn khi chức năng còn đang thay đổi.

## Thành phần và ranh giới

- **Android (`apps/android`)**: Java native, XML layouts và Gradle. Giai đoạn 0 có màn hình ReadLite cùng nút gọi `GET /api/v1/health`. Debug emulator mặc định gọi `http://10.0.2.2:3000`; địa chỉ có thể ghi đè bằng Gradle property `readliteApiBaseUrl`. Cleartext chỉ được cho phép ở build debug. Bản release phải dùng HTTPS.
- **Web (`apps/web`)**: React SPA responsive, React Router và TanStack Query. Nginx phục vụ build và proxy `/api/v1/` cùng origin đến API; Vite có proxy tương ứng khi phát triển.
- **API (`apps/api`)**: Express 5, TypeScript, Zod, Helmet, CORS whitelist và pool `pg`. `GET /api/v1/health` trả `{ "status": "ok", "service": "api" }`. API chạy migration trước khi mở cổng.
- **Postgres (`postgres`)**: PostgreSQL 16, named volume và không publish cổng database ra host. Migration nền cài `citext`, `pg_trgm`, `unaccent`; schema nghiệp vụ thuộc Giai đoạn 1.
- **Mailpit (`mailpit`)**: SMTP và giao diện hộp thư giả lập local; không dùng làm dịch vụ email production.

PostgreSQL là nguồn dữ liệu chuẩn sau đăng nhập. SQLite của app cũ chỉ là dữ liệu legacy; nếu thêm SQLite vào Android mới để cache/offline, nó sẽ là bản cache có đồng bộ với API, không tạo một thư viện người dùng độc lập. Quy tắc đồng bộ và chuyển dữ liệu cũ sẽ chốt trước khi xây tính năng đọc có trạng thái.

## Xác thực đa client

API thống nhất quyền và dữ liệu giữa web/mobile. Giai đoạn auth sau này dùng cookie `HttpOnly`, `Secure`, `SameSite` và CSRF cho web; Android dùng access token trong bộ nhớ và refresh token lưu bằng Android Keystore. Refresh token vẫn được xoay vòng và chỉ lưu dạng hash ở server. Web không lưu token trong `localStorage`. Giai đoạn 0 chưa triển khai session hay CSRF middleware.

## Luồng local

1. Trình duyệt mở web tại `http://localhost:8080`; web gọi API cùng origin qua Nginx.
2. Android emulator gọi API ở `http://10.0.2.2:3000`; Android device thật dùng địa chỉ LAN của máy chạy Compose hoặc domain HTTPS.
3. API chờ PostgreSQL healthy, chạy migration rồi mới listen ở cổng 3000.
4. Mailpit cung cấp giao diện local ở cổng 8025 và SMTP ở cổng 1025.

Compose không chạy Android container. Cấu hình local không cần `.env`; `.env.example` chỉ ghi các giá trị local. Secret mặc định không được dùng khi triển khai.

## Khả năng tương thích nghiệp vụ cũ

Các giai đoạn sau phải giữ hành vi thư viện/reader của Android: truyện và nhiều chương, nội dung legacy trong `stories.content`, import metadata/TOC/spine EPUB, bỏ tiêu đề lặp, tiến độ theo permille `0..1000`, bookmark, cỡ chữ `14..32`, theme sáng/tối và đọc tiếp. Schema nhiều người dùng gắn dữ liệu với `owner_id`/`user_id`. Giai đoạn import sẽ đối chiếu `EpubImporter.java` và `DatabaseHelper.java` từ dự án tham khảo.

Vị trí bookmark nên tham chiếu `chapter_id` ổn định thay cho thứ tự chương; schema cần giữ `chapters.is_read` và vị trí permille. Khi trùng EPUB, lựa chọn là **Ghi đè / Tạo bản sao / Hủy**; semantics dữ liệu cá nhân được giữ khi ghi đè phải chốt trong giai đoạn import.

## Bảo mật và môi trường

- Compose hiện là cấu hình local HTTP; API và web production cần HTTPS, secret riêng, CORS hạn chế và SMTP thật.
- API không trả lỗi nội bộ hoặc credential database cho client.
- CORS chỉ áp dụng cho web browser; Android native không dựa vào CORS để bảo mật.
- Chưa có upload, auth, phân quyền, CSRF hoặc xử lý EPUB trong Giai đoạn 0.
- Android app nhận API URL theo build type/property; không hard-code production secret hay token.

## Cấu trúc dự án

```text
readlite-platform/
├── apps/android/       # Android native Java/XML
├── apps/api/           # Express REST API
├── apps/web/           # React/Vite SPA và Nginx
├── db/migrations/      # Migration PostgreSQL
├── db/seeds/           # Seed các giai đoạn sau
└── docs/               # Kiến trúc, giai đoạn và hướng dẫn
```

## Tiêu chí Giai đoạn 0

- Build được Android debug APK; màn hình có thể gọi API health ở emulator.
- Web shell mở được và Nginx proxy `/api/v1/health` trả JSON.
- API chỉ listen sau khi migration nền hoàn tất; migration lỗi không báo healthy.
- `docker compose config`, npm format/lint/typecheck/build và test API/web qua.
- README ghi rõ Android Studio/JDK/SDK cần có, lệnh khởi chạy, API URL emulator và giới hạn local.

Giai đoạn 0 dừng ở các shell chạy được. Giai đoạn 1 mới tạo schema multi-user đầy đủ; không tự bắt đầu nghiệp vụ sau khi hoàn tất.
