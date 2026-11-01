import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const WORKSPACE = 'C:/Users/Vu Tai/Desktop/readlite-platform-completed/readlite-platform';
const SKILL_DIR = 'C:/Users/Vu Tai/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/presentations';
const BUILD = path.join(WORKSPACE, '.presentation-build');
const OUT = path.join(WORKSPACE, 'deliverables', 'ReadLite_PostgreSQL_thuyet_trinh_moi_v2.pptx');
const W = 1280, H = 720;
const C = {
  navy: '#174B63', deep: '#103D51', teal: '#187B87', cyan: '#8DCED7', ice: '#DDF1F2',
  paper: '#F4FAF9', white: '#FFFFFF', yellow: '#F4C767', ink: '#123B4A', muted: '#52717A',
  line: '#B7D9DB', red: '#B85146', darkCode: '#123542',
};
const deck = Presentation.create({ slideSize: { width: W, height: H } });

function shape(slide, geometry, x, y, w, h, fill='none', stroke='none', sw=0, radius) {
  return slide.shapes.add({
    geometry, position: {left:x, top:y, width:w, height:h}, fill,
    line: {style:'solid', fill:stroke, width:sw},
    ...(radius ? {borderRadius:radius} : {}),
  });
}
function text(slide, content, x, y, w, h, size=24, color=C.ink, bold=false, align='left', opts={}) {
  const s = shape(slide, 'textbox', x,y,w,h);
  s.text = content;
  s.text.style = {
    typeface: 'Arial', fontSize:size, color, bold, alignment:align,
    verticalAlignment: opts.vAlign ?? 'middle',
    wrap:'square', autoFit:'shrinkText', insets:0,
  };
  return s;
}
function line(slide,x,y,w,h,color=C.line,width=2){shape(slide,'line',x,y,w,h,'none',color,width);}
function base(title, index, {dark=false, section='CƠ SỞ DỮ LIỆU'}={}) {
  const s=deck.slides.add(); s.background.fill=dark?C.deep:C.paper;
  shape(s,'rect',0,0,W,15,C.yellow);
  text(s,section,68,40,550,24,15,dark?C.cyan:C.teal,true);
  text(s,title,68,82,1128,92,42,dark?C.white:C.deep,true,'left',{vAlign:'top'});
  line(s,68,652,1144,0,dark?'#4F8290':C.line,1.5);
  text(s,'READLITE  ·  POSTGRESQL',68,663,460,22,13,dark?'#BCD9DC':C.muted,true);
  text(s,String(index).padStart(2,'0'),1147,660,62,28,17,dark?C.yellow:C.teal,true,'right');
  return s;
}
function notes(slide, content, sources='') {
  slide.speakerNotes.text = content + (sources ? '\n\nNguồn mã: ' + sources : '');
}
function row(slide, number, title, body, y, dark=false) {
  const col=dark?C.white:C.deep, sub=dark?'#D7E9E8':C.muted;
  text(slide,number,70,y,56,52,29,C.yellow,true);
  text(slide,title,139,y-2,1030,38,27,col,true);
  text(slide,body,139,y+36,1030,62,20,sub,false,'left',{vAlign:'top'});
  line(slide,139,y+108,1030,0,dark?'#46798B':C.line,1);
}
function node(slide,label,detail,x,y,w,h,fill=C.white) {
  shape(slide,'roundRect',x,y,w,h,fill,C.line,2,16);
  text(slide,label,x+18,y+13,w-36,36,25,C.deep,true,'center');
  text(slide,detail,x+18,y+49,w-36,h-59,17,C.muted,false,'center',{vAlign:'top'});
}
function code(slide, content,x,y,w,h,size=21) {
  shape(slide,'roundRect',x,y,w,h,C.darkCode,'#397F88',1,14);
  text(slide,content,x+23,y+18,w-46,h-36,size,C.white,false,'left',{vAlign:'top'});
}

// 1. Cover
{
 const s=deck.slides.add(); s.background.fill=C.navy;
 shape(s,'rect',0,0,W,18,C.yellow);
 text(s,'READLITE',72,68,470,40,22,C.cyan,true);
 text(s,'CƠ SỞ DỮ LIỆU\nPOSTGRESQL',72,169,900,170,58,C.white,true,'left',{vAlign:'top'});
 text(s,'Luồng dữ liệu, lược đồ và demo từ dự án đang chạy',74,383,840,66,27,C.ice);
 line(s,74,493,1080,0,C.cyan,3);
 text(s,'Android + Web    →    REST API    →    PostgreSQL',74,528,1060,52,26,C.yellow,true);
 text(s,'Đồ án ứng dụng đọc truyện ReadLite',74,637,780,25,17,C.ice);
 notes(s,'Mở đầu: ReadLite có app Android và web quản trị, cùng sử dụng API. Phần trình bày tập trung vào dữ liệu được ghi và truy xuất trong PostgreSQL. Bảng màu lấy cảm hứng từ mẫu Canva Blue Teal and Light Blue Modern Data Management Presentation, không sao chép hình minh họa của mẫu.','README.md; docs/architecture.md');
}
// 2. Architecture
{
 const s=base('Một nguồn dữ liệu cho Android và web',2,{section:'KIẾN TRÚC'});
 node(s,'ANDROID','Tìm truyện, đọc, lưu tiến độ',64,223,255,155);
 node(s,'WEB QUẢN TRỊ','Nhập, sửa và duyệt truyện',64,420,255,155);
 text(s,'→',350,293,72,52,43,C.teal,true,'center');
 text(s,'→',350,484,72,52,43,C.teal,true,'center');
 node(s,'REST API','Xác thực, quyền và nghiệp vụ',448,315,303,170,C.ice);
 text(s,'→',776,372,70,52,43,C.teal,true,'center');
 node(s,'POSTGRESQL','Tài khoản, truyện, tiến độ',856,226,340,155);
 node(s,'KHO MEDIA','EPUB gốc, bìa và ảnh chương',856,421,340,155);
 text(s,'API là nơi duy nhất dùng DATABASE_URL.',449,557,400,34,21,C.deep,true);
 notes(s,'Đọc từ trái sang phải. Android và web không kết nối trực tiếp PostgreSQL; cả hai gọi API. API kết nối Postgres bằng pool và lưu bytes media ở kho riêng.','apps/api/src/db/pool.ts; apps/api/src/routes/catalog.ts; docker-compose.yml');
}
// 3. Storage split
{
 const s=base('Dữ liệu được lưu ở ba nơi',3,{section:'KIẾN TRÚC'});
 text(s,'POSTGRESQL',70,212,330,42,28,C.deep,true);
 line(s,70,266,332,0,C.teal,3);
 text(s,'users, stories, volumes, chapters\ngenres, favorites, reading_progress\nmedia_assets, story_review_events',70,290,339,250,22,C.ink,false,'left',{vAlign:'top'});
 text(s,'KHO MEDIA',472,212,330,42,28,C.deep,true);
 line(s,472,266,332,0,C.teal,3);
 text(s,'Tệp EPUB gốc\nẢnh bìa và ảnh trong chương\nPostgreSQL chỉ giữ storage_key, MIME và hash.',472,290,331,250,22,C.ink,false,'left',{vAlign:'top'});
 text(s,'TRÊN ANDROID',870,212,330,42,28,C.deep,true);
 line(s,870,266,332,0,C.teal,3);
 text(s,'Cỡ chữ và giao diện Reader\nSharedPreferences cục bộ\nTủ sách và tiến độ vẫn đồng bộ qua API.',870,290,331,250,22,C.ink,false,'left',{vAlign:'top'});
 notes(s,'Nhấn mạnh media không nằm trong database. user_settings có trong schema nhưng phần cỡ chữ/theme Reader hiện đang lưu cục bộ trên thiết bị.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts; apps/android/app/src/main/java/com/readlite/mobile/ReaderPreferences.java');
}
// 4. ER diagram
{
 const s=base('Quan hệ giữa các bảng cốt lõi',4,{section:'LƯỢC ĐỒ'});
 node(s,'users','id UUID',72,237,205,107,C.ice);
 node(s,'stories','id BIGINT · owner_id',377,237,232,107,C.ice);
 node(s,'volumes','story_id',710,200,216,107,C.ice);
 node(s,'chapters','story_id · volume_id',710,370,216,107,C.ice);
 node(s,'genres','story_genres nối M:N',993,200,217,107,C.ice);
 node(s,'favorites','user_id + story_id',91,483,250,103,C.white);
 node(s,'reading_progress','user_id + story_id',395,483,283,103,C.white);
 text(s,'1 : N',288,265,82,34,19,C.teal,true,'center');
 text(s,'1 : N',619,227,81,34,19,C.teal,true,'center');
 text(s,'1 : N',619,400,81,34,19,C.teal,true,'center');
 text(s,'M : N',934,225,66,34,19,C.teal,true,'center');
 text(s,'Tủ sách và tiến độ thuộc từng người dùng, từng truyện.',91,607,1000,34,21,C.muted);
 notes(s,'Đây là lược đồ rút gọn. users sở hữu stories; stories có volumes và chapters. story_genres nối truyện với thể loại. favorites và reading_progress dùng khóa ghép user_id, story_id.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts');
}
// 5. Constraints
{
 const s=base('Ràng buộc bảo vệ dữ liệu',5,{section:'LƯỢC ĐỒ'});
 row(s,'01','Khóa chính và khóa ngoại','Một chương thuộc đúng truyện; volume_id được kiểm tra cùng story_id.',220);
 row(s,'02','UNIQUE và khóa ghép','Mỗi người chỉ có một dòng favorites và một dòng reading_progress cho mỗi truyện.',356);
 row(s,'03','CHECK','position_permille chỉ nhận 0–1000; truyện public phải có trạng thái published.',492);
 notes(s,'Có thể chỉ trực tiếp trong migration 002: PRIMARY KEY(user_id, story_id), composite FK (current_chapter_id, story_id), CHECK position_permille. Migration 003 thêm CHECK visibility/publication.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts');
}
// 6. Migration
{
 const s=base('Migration chạy trước khi API mở cổng',6,{section:'MIGRATION',dark:true});
 text(s,'001',75,214,94,47,31,C.yellow,true); text(s,'Extensions',179,217,240,42,25,C.white,true);
 text(s,'002',75,280,94,47,31,C.yellow,true); text(s,'Bảng lõi và ràng buộc',179,283,330,42,25,C.white,true);
 text(s,'003',75,346,94,47,31,C.yellow,true); text(s,'EPUB, media, kiểm duyệt',179,349,390,42,25,C.white,true);
 text(s,'004–005',75,412,112,47,31,C.yellow,true); text(s,'Ngày phát hành, thể loại',196,415,455,42,25,C.white,true);
 text(s,'006–007',75,478,112,47,31,C.yellow,true); text(s,'Duyệt thủ công, lịch sử phân quyền',196,481,515,42,23,C.white,true);
 text(s,'Trích lược từ server.ts',719,211,475,36,19,C.ice,true);
 code(s,"await runner({ direction: 'up', dir: migrationDirectory });\napp.listen(env.port);",717,255,483,204,23);
 text(s,'Chưa migrate thành công thì API không nhận request.',719,490,475,71,22,C.ice,true);
 notes(s,'Trong server.ts, runner áp dụng migration còn thiếu. Đoạn code trên slide đã rút gọn các tham số; mở file thật khi được hỏi. Nếu lỗi, API dừng. Migration 006 sửa ràng buộc để ai_review_status skipped cũng có thể được admin duyệt. Migration 007 tạo audit log phân quyền.','apps/api/src/server.ts; db/migrations/001-enable-extensions.ts; db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts; db/migrations/004-story-publication-date.ts; db/migrations/005-genre-catalog.ts; db/migrations/006-manual-admin-review.ts; db/migrations/007-account-role-events.ts');
}
// 7. Lifecycle
{
 const s=base('Từ bản nháp đến catalog Android',7,{section:'NGHIỆP VỤ'});
 node(s,'BẢN NHÁP','private + draft',71,245,273,145,C.ice);
 text(s,'→',361,285,64,49,42,C.teal,true,'center');
 node(s,'HÀNG CHỜ DUYỆT','admin_review_pending',443,245,342,145,C.ice);
 text(s,'→',802,285,64,49,42,C.teal,true,'center');
 node(s,'XUẤT BẢN','public + published',885,245,310,145,C.ice);
 text(s,'Có AI: lưu cảnh báo để admin xem.',74,465,545,48,24,C.deep,true);
 text(s,'Chưa cấu hình AI: chuyển sang duyệt thủ công.',74,521,890,49,24,C.deep,true);
 notes(s,'Không nói rằng AI tự xuất bản. Với cấu hình hiện tại, khi không có AI, trạng thái AI là skipped và bản nháp chuyển vào hàng chờ admin. Chỉ khi admin approve, visibility public và moderation_status published.','apps/api/src/server.ts; apps/api/src/routes/admin-review.ts; db/migrations/006-manual-admin-review.ts');
}
// 8. Import
{
 const s=base('Nhập EPUB có giao dịch PostgreSQL',8,{section:'GHI DỮ LIỆU'});
 text(s,'DATABASE',70,217,400,44,27,C.deep,true);
 text(s,'stories → story_genres → media_assets\n→ volumes → chapters → story_review_events',70,278,530,130,23,C.ink,false,'left',{vAlign:'top'});
 text(s,'BEGIN  /  COMMIT  /  ROLLBACK',70,461,522,45,25,C.teal,true);
 text(s,'FILE STORAGE',658,217,490,44,27,C.deep,true);
 text(s,'Lưu EPUB gốc và ảnh bằng storage_key.\nBản ghi media_assets giữ loại MIME, kích thước và SHA-256.',658,278,520,160,23,C.ink,false,'left',{vAlign:'top'});
 line(s,624,206,0,367,C.line,2);
 text(s,'Nếu ghi database lỗi, rollback và dọn media vừa tạo.',70,565,1050,44,22,C.muted);
 notes(s,'Mỗi tệp EPUB tạo một bản nháp riêng. Service parse, lưu media, rồi mở transaction Postgres. Nếu transaction lỗi, rollback và xóa các file mới tạo. Không nói file bytes nằm trong Postgres.','apps/api/src/services/story-import-service.ts; apps/api/src/media/local-media-storage.ts');
}
// 9. Catalog query
{
 const s=base('Catalog chỉ đọc truyện đã xuất bản',9,{section:'TRUY XUẤT',dark:true});
 code(s,"SELECT ... FROM stories\nWHERE visibility = 'public'\n  AND moderation_status = 'published'\nORDER BY created_at DESC;",71,223,771,273,29);
 text(s,'Android gọi GET /api/v1/stories',881,236,310,82,26,C.yellow,true);
 text(s,'API trả JSON; app không chạy SQL trực tiếp.',881,339,310,154,23,C.ice);
 text(s,'Dùng tham số $1, $2... cho dữ liệu người dùng.',71,540,1075,54,24,C.white,true);
 notes(s,'Mở catalog.ts để chỉ điều kiện public/published và các tham số tìm kiếm. Nếu hỏi SQL injection, cho xem database.query với mảng tham số.','apps/api/src/routes/catalog.ts; apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java');
}
// 10. Library
{
 const s=base('Tủ sách đồng bộ theo tài khoản',10,{section:'ĐỌC VÀ GHI'});
 row(s,'01','Yêu thích','favorites có PRIMARY KEY(user_id, story_id).',208);
 row(s,'02','Tiến độ đọc','reading_progress lưu current_chapter_id và position_permille.',344);
 row(s,'03','Cập nhật an toàn','API dùng INSERT ... ON CONFLICT DO UPDATE cho vị trí đọc.',480);
 notes(s,'Demo trực tiếp: mở truyện, chạm yêu thích, cuộn một chương, quay lại tủ sách. Truy vấn SELECT favorites và reading_progress theo story_id để thấy hàng tương ứng.','apps/api/src/routes/library.ts; db/migrations/002-core-schema.ts; apps/android/app/src/main/java/com/readlite/mobile/ChapterReaderActivity.java');
}
// 11. Security
{
 const s=base('API kiểm tra quyền trước khi ghi',11,{section:'BẢO MẬT'});
 text(s,'user',69,237,220,52,38,C.deep,true); text(s,'đọc, yêu thích, lưu tiến độ',69,292,273,86,21,C.muted);
 text(s,'author',438,237,250,52,38,C.deep,true); text(s,'tạo và quản lý bản nháp',438,292,295,86,21,C.muted);
 text(s,'admin',823,237,250,52,38,C.deep,true); text(s,'duyệt truyện, phân quyền',823,292,302,86,21,C.muted);
 line(s,69,425,1116,0,C.line,2);
 text(s,'Session + CSRF',69,458,365,49,27,C.teal,true);
 text(s,'SQL có tham số',439,458,365,49,27,C.teal,true);
 text(s,'Audit đổi role',813,458,365,49,27,C.teal,true);
 text(s,'users.role',69,514,315,50,21,C.ink);
 text(s,'$1 / $2 trong query',439,514,315,50,21,C.ink);
 text(s,'account_role_events',813,514,340,50,21,C.ink);
 notes(s,'Nói rõ database không nằm trong ứng dụng Android. Web và Android có cơ chế phiên; API xét vai trò và CSRF trước thao tác thay đổi. Lịch sử đổi role ở migration 007.','apps/api/src/routes/auth.ts; apps/api/src/routes/admin-users.ts; db/migrations/007-account-role-events.ts');
}
// 12. Demo
{
 const s=base('Demo trực tiếp trong 3 phút',12,{section:'DEMO',dark:true});
 row(s,'1','Kiểm tra API','Mở /api/v1/health, đảm bảo backend và PostgreSQL đã khởi động.',191,true);
 row(s,'2','Tạo thay đổi từ Android','Mở truyện đã public, yêu thích rồi cuộn một chương để lưu tiến độ.',326,true);
 row(s,'3','Đối chiếu PostgreSQL','SELECT favorites và reading_progress theo story_id vừa thao tác.',461,true);
 notes(s,'Chuẩn bị sẵn một truyện published/public và tài khoản đăng nhập. Trước demo, mở sẵn Android emulator, web, terminal API và công cụ SQL. Không nên nhập 20 EPUB trong lúc thuyết trình. Nếu còn thời gian, mở web để cho thấy hàng chờ admin và trạng thái truyện.','README.md; apps/api/src/routes/health.ts; apps/api/src/routes/library.ts');
}
// 13. Code map
{
 const s=base('Khi giảng viên hỏi, mở mã ở đâu?',13,{section:'MINH CHỨNG'});
 const entries=[
  ['Schema và khóa','db/migrations/002-core-schema.ts'],
  ['EPUB và media','db/migrations/003-story-submissions-media.ts'],
  ['Migration trước khi listen','apps/api/src/server.ts'],
  ['Catalog public','apps/api/src/routes/catalog.ts'],
  ['Yêu thích, tiến độ','apps/api/src/routes/library.ts'],
  ['Transaction nhập EPUB','apps/api/src/services/story-import-service.ts'],
  ['Duyệt thủ công','apps/api/src/routes/admin-review.ts'],
 ];
 let y=194;
 for(const [label,file] of entries){
   text(s,label,71,y,350,40,21,C.deep,true);
   text(s,file,423,y,770,40,20,C.teal);
   line(s,71,y+45,1124,0,C.line,1); y+=59;
 }
 notes(s,'Chuẩn bị tab IDE mở sẵn ở các file này. Nếu hỏi kết nối DB, thêm apps/api/src/db/pool.ts. Nếu hỏi lịch sử phân quyền, mở migration 007 và routes/admin-users.ts.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts; apps/api/src/server.ts; apps/api/src/routes/catalog.ts; apps/api/src/routes/library.ts; apps/api/src/services/story-import-service.ts; apps/api/src/routes/admin-review.ts');
}
// 14. Closing
{
 const s=base('PostgreSQL giúp ReadLite đồng bộ và kiểm soát truyện',14,{section:'KẾT LUẬN',dark:true});
 row(s,'01','Một nguồn dữ liệu chung','Android và web cùng thấy truyện qua REST API.',207,true);
 row(s,'02','Quan hệ có ràng buộc','Khóa, CHECK và transaction giữ dữ liệu nhất quán.',343,true);
 row(s,'03','Chỉ xuất bản sau duyệt','Catalog chỉ hiện truyện public và published.',479,true);
 notes(s,'Kết thúc bằng demo hoặc hỏi đáp. Không hứa rằng hệ thống đã sẵn sàng production: email provider, AI tùy chọn, HTTPS/backup và thử nghiệm triển khai còn là việc vận hành.','README.md; docs/architecture.md');
}

await fs.mkdir(BUILD,{recursive:true});
await fs.mkdir(path.dirname(OUT),{recursive:true});
for(let i=0;i<deck.slides.items.length;i++){
  const image=await deck.export({slide:deck.slides.items[i],format:'png',scale:1});
  await fs.writeFile(path.join(BUILD,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await image.arrayBuffer()));
}
const expectedSlideSizeEmu='12192000,6858000';
const requirements={ explicitTotalSlideCount:14, requiredNativeTableOwnerSlides:[], requiredNativeChartOwnerSlides:[] };
const fontPolicy={basis:'design',families:['Arial']};
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const candidate=path.join(BUILD,'readlite-db-candidate.pptx');
await (await PresentationFile.exportPptx(deck)).save(candidate);
const result=await finalizePresentation({
  ...requirements, workspaceDir:WORKSPACE, candidatePath:candidate, finalPath:OUT,
  pythonExecutable:'C:/Users/Vu Tai/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu',expectedSlideSizeEmu,'--validate-bullet-geometry','--validate-heading-fit'],
  requiredNativeTableOwnerSlides:[], fontPolicy, verifyArtifactToolImport:true,
  receiptPath:path.join(BUILD,'validation-v2.json'),
});
console.log(JSON.stringify({output:OUT,slides:deck.slides.items.length,result}));
