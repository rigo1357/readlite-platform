import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const ROOT = 'C:/Users/Vu Tai/Desktop/readlite-platform-completed/readlite-platform';
const SKILL = 'C:/Users/Vu Tai/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/presentations';
const BUILD = path.join(ROOT, '.presentation-build', 'structured');
const OUT = path.join(ROOT, 'deliverables', 'ReadLite_PostgreSQL_ban_thuyet_trinh_final.pptx');
const W = 1280, H = 720;
const C = { bg:'#F6FAFC', white:'#FFFFFF', navy:'#103E69', dark:'#071D31', teal:'#0BB6AE', tealDark:'#087B84', strip:'#0E7188', pale:'#E6F3F8', line:'#C7DBE3', ink:'#15334A', muted:'#527084', code:'#061B2D', codeText:'#77EDBE' };
const deck = Presentation.create({slideSize:{width:W,height:H}});

function shape(s,g,x,y,w,h,fill='none',stroke='none',sw=0){return s.shapes.add({geometry:g,position:{left:x,top:y,width:w,height:h},fill,line:{style:'solid',fill:stroke,width:sw}});}
function text(s,v,x,y,w,h,size=24,color=C.ink,bold=false,align='left',opts={}){
  const sh=shape(s,'textbox',x,y,w,h); sh.text=v;
  sh.text.style={typeface:'Arial',fontSize:size,color,bold,alignment:align,verticalAlignment:opts.verticalAlignment??'middle',wrap:'square',autoFit:'shrinkText',insets:0};
  return sh;
}
function rule(s,x,y,w,color=C.line,sw=1){shape(s,'line',x,y,w,0,'none',color,sw);}
function notes(s,speech,sources=''){s.speakerNotes.text=speech+(sources?`\n\nMã nguồn: ${sources}`:'');}
function blank(){const s=deck.slides.add();s.background.fill=C.bg;return s;}
function content(title,subtitle,n){
  const s=blank();shape(s,'rect',0,0,W,10,C.teal);
  shape(s,'rect',68,57,14,14,C.teal);
  text(s,title,96,45,1090,56,40,C.ink,true);
  if(subtitle) text(s,subtitle,68,112,1110,52,21,C.muted,false,'left',{verticalAlignment:'top'});
  rule(s,68,660,1143,C.line,1);
  text(s,'READLITE  |  POSTGRESQL',68,669,450,18,12,C.muted,true);
  text(s,String(n).padStart(2,'0'),1145,665,65,26,15,C.tealDark,true,'right');
  return s;
}
function divider(num,title,subtitle,n){
  const s=deck.slides.add();s.background.fill=C.navy;
  shape(s,'rect',850,0,430,H,C.strip);
  text(s,String(num).padStart(2,'0'),72,111,280,126,102,C.teal,true);
  text(s,title,72,259,725,145,49,C.white,true,'left',{verticalAlignment:'top'});
  text(s,subtitle,72,486,700,72,23,'#D8E8F1');
  text(s,String(n).padStart(2,'0'),1160,659,48,25,15,C.white,true,'right');
  return s;
}
function paragraph(s,heading,body,x,y,w,h=125){
  text(s,heading,x,y,w,37,25,C.ink,true);
  text(s,body,x,y+43,w,h-43,21,C.muted,false,'left',{verticalAlignment:'top'});
}
function codePanel(s,codeLines,explanations){
  shape(s,'rect',68,195,717,403,C.code);
  text(s,codeLines,91,218,670,360,21,C.codeText,false,'left',{verticalAlignment:'top'});
  shape(s,'rect',805,195,405,403,C.pale);
  let y=219;
  for(const [h,b] of explanations){
    text(s,h,827,y,357,29,22,C.ink,true);
    text(s,b,827,y+31,357,54,19,C.muted,false,'left',{verticalAlignment:'top'});
    y+=89;
  }
}
function tableRows(s,rows,x=68,y=202,w=1142,rowH=57,leftW=310){
  for(let i=0;i<rows.length;i++){
    const yy=y+i*rowH;
    if(i%2===1) shape(s,'rect',x,yy,w,rowH,C.pale);
    text(s,rows[i][0],x+17,yy+9,leftW-27,rowH-18,22,C.ink,true);
    text(s,rows[i][1],x+leftW+11,yy+9,w-leftW-29,rowH-18,20,C.muted);
    rule(s,x,yy+rowH,w,C.line,1);
  }
}
function entity(s,label,detail,x,y,w=225,h=95){
  shape(s,'rect',x,y,w,h,C.white,C.line,2);
  text(s,label,x+13,y+10,w-26,38,24,C.ink,true,'center');
  text(s,detail,x+13,y+51,w-26,27,17,C.muted,false,'center');
}

// 01: Trang bìa
{
  const s=blank();shape(s,'rect',0,0,W,10,C.teal);
  text(s,'READLITE',69,57,525,34,23,C.tealDark,true);
  text(s,'CƠ SỞ DỮ LIỆU\nTRONG READLITE',69,154,664,159,56,C.ink,true,'left',{verticalAlignment:'top'});
  text(s,'PostgreSQL phục vụ Android và web quản trị',69,360,609,82,25,C.muted);
  rule(s,69,505,588,C.teal,3);
  text(s,'Thiết kế  •  Ghi dữ liệu  •  Truy vấn  •  Demo',69,526,617,49,21,C.tealDark,true);
  // Sơ đồ hệ thống là bằng chứng kỹ thuật có thể sửa trong PowerPoint.
  entity(s,'ANDROID','Đọc truyện',763,167,187,92);
  entity(s,'WEB','Quản trị',994,167,187,92);
  text(s,'↓',835,277,50,46,40,C.tealDark,true,'center');
  text(s,'↓',1061,277,50,46,40,C.tealDark,true,'center');
  entity(s,'REST API','Xác thực và xử lý',847,347,254,95);
  text(s,'↓',944,460,50,46,40,C.tealDark,true,'center');
  entity(s,'POSTGRESQL','Dữ liệu ứng dụng',847,527,254,95);
  notes(s,'Thời lượng 20 giây. Giới thiệu đây là phần cơ sở dữ liệu của ReadLite. Dẫn câu hỏi: thao tác trên Android và web gặp nhau ở đâu? Trả lời ở slide kiến trúc.','README.md; docker-compose.yml');
}
// 02: Mục lục
{
  const s=content('NỘI DUNG CHÍNH','Bốn phần đi từ bối cảnh đến dữ liệu kiểm chứng được',2);
  const agenda=[
    ['01','Tổng quan hệ thống','Vì sao ReadLite cần PostgreSQL và dữ liệu nằm ở đâu'],
    ['02','Thiết kế cơ sở dữ liệu','Các bảng, quan hệ, ràng buộc và migration'],
    ['03','Ghi và cập nhật dữ liệu','Nhập EPUB, duyệt truyện, yêu thích và tiến độ đọc'],
    ['04','Truy vấn và demo','Điều kiện xuất bản, quyền truy cập và kiểm chứng trên app'],
  ];
  agenda.forEach((a,i)=>{const y=196+i*105;text(s,a[0],74,y,86,70,48,C.teal,true);text(s,a[1],177,y,650,37,26,C.ink,true);text(s,a[2],177,y+38,923,44,20,C.muted);rule(s,177,y+90,980,C.line,1);});
  notes(s,'Thời lượng 30 giây. Chỉ bốn phần. Nói rõ thứ tự: trước hết hiểu hệ thống, sau đó đọc lược đồ, xem dữ liệu được ghi, cuối cùng demo và đối chiếu database. Chuyển ý: bắt đầu bằng các thành phần của ReadLite.','README.md');
}
// 03-06: Phần một
{
  const s=divider(1,'TỔNG QUAN\nHỆ THỐNG','Từ thao tác trên Android đến dữ liệu ở máy chủ',3);
  notes(s,'Chuyển ý: ReadLite có nhiều giao diện nhưng cần cùng thấy một kho truyện. Phần này giải thích vì sao PostgreSQL nằm ở phía máy chủ.','README.md');
}
{
  const s=content('ReadLite là ứng dụng gì?','Một truyện được tạo trên web và đọc trên Android',4);
  paragraph(s,'Ứng dụng Android','Người dùng tìm truyện, đọc chương, đánh dấu yêu thích và tiếp tục từ vị trí đã lưu.',75,211,521,168);
  paragraph(s,'Web tác giả và quản trị','Tác giả nhập EPUB hoặc tạo bản nháp. Quản trị viên kiểm tra và quyết định xuất bản.',681,211,520,168);
  rule(s,77,414,1114,C.teal,3);
  text(s,'Nhu cầu dữ liệu chung',75,440,450,42,29,C.ink,true);
  text(s,'Truyện vừa được duyệt trên web phải xuất hiện ở Android; tiến độ đọc phải gắn với tài khoản người dùng.',75,490,1110,89,26,C.muted,false,'left',{verticalAlignment:'top'});
  notes(s,'Thời lượng 25 giây. Lấy ví dụ một truyện vừa xuất bản. Trên web thấy trạng thái, trên điện thoại người đọc thấy truyện. Vì vậy cần một nguồn dữ liệu chung. Chuyển ý sang kiến trúc.','README.md');
}
{
  const s=content('Kiến trúc truy cập dữ liệu','Android và web gọi API; API làm việc với PostgreSQL',5);
  entity(s,'ANDROID','Khám phá, đọc',75,239,229,113);
  entity(s,'WEB','Nhập, duyệt',75,435,229,113);
  text(s,'→',324,279,69,55,43,C.tealDark,true,'center');text(s,'→',324,476,69,55,43,C.tealDark,true,'center');
  entity(s,'REST API','Xác thực và nghiệp vụ',419,335,290,114);
  text(s,'→',730,372,69,55,43,C.tealDark,true,'center');
  entity(s,'POSTGRESQL','Tài khoản, truyện, tiến độ',821,231,376,114);
  entity(s,'KHO MEDIA','EPUB, bìa, ảnh chương',821,439,376,114);
  text(s,'API dùng DATABASE_URL để kết nối PostgreSQL.',418,579,703,42,23,C.tealDark,true);
  notes(s,'Thời lượng 35 giây. Đọc từ trái sang phải. Android và web không chứa thông tin kết nối database, chỉ gửi request. API kiểm tra quyền trước khi ghi dữ liệu. EPUB và ảnh thuộc kho media.','apps/api/src/db/pool.ts; docker-compose.yml');
}
{
  const s=content('Dữ liệu nằm ở đâu?','Phân biệt bản ghi quan hệ, tệp nhị phân và tùy chọn trên máy',6);
  tableRows(s,[
    ['PostgreSQL','users, stories, chapters, favorites, reading_progress, trạng thái duyệt'],
    ['Kho media','Tệp EPUB gốc, ảnh bìa, ảnh trong chương; database giữ metadata và storage_key'],
    ['Android','Giao diện và cỡ chữ Reader lưu cục bộ; tủ sách/tiến độ đi qua API'],
  ],68,232,1142,100,283);
  text(s,'Nếu sao lưu dự án, cần giữ cả PostgreSQL và kho media.',73,581,1100,42,24,C.tealDark,true);
  notes(s,'Thời lượng 30 giây. Nhấn mạnh PostgreSQL không giữ bytes EPUB. Chuyển ý: sau khi biết dữ liệu nằm ở đâu, ta xem các bảng và quan hệ giữa chúng.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts; docker-compose.yml');
}
// 07-11: Phần hai
{
  const s=divider(2,'THIẾT KẾ\nCƠ SỞ DỮ LIỆU','Các bảng cốt lõi và quy tắc giữ dữ liệu nhất quán',7);
  notes(s,'Chuyển ý: Phần hai trả lời PostgreSQL tổ chức dữ liệu thế nào và ngăn dữ liệu sai bằng cách nào.','db/migrations/002-core-schema.ts');
}
{
  const s=content('Nhóm bảng chính','Mỗi nhóm bảng phục vụ một chức năng của ReadLite',8);
  tableRows(s,[
    ['Người dùng','users, sessions và lịch sử đổi vai trò'],
    ['Truyện và nội dung','stories, volumes, chapters, story_genres'],
    ['Tủ sách','favorites, reading_progress'],
    ['EPUB và duyệt','media_assets, story_review_events, story_review_jobs'],
  ],68,206,1142,95,307);
  notes(s,'Thời lượng 35 giây. Không đọc từng tên bảng liên tục. Nêu bốn nhóm theo nghiệp vụ: ai dùng, đọc cái gì, đã lưu gì, xuất bản ra sao. Chuyển ý: các bảng nối với nhau bằng khóa.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts; db/migrations/007-account-role-events.ts');
}
{
  const s=content('Quan hệ giữa các bảng','Lược đồ rút gọn để giải thích đường đi của một truyện',9);
  entity(s,'users','id UUID',82,244,200,94);
  entity(s,'stories','id BIGINT; owner_id',388,244,232,94);
  entity(s,'volumes','story_id',725,193,205,94);
  entity(s,'chapters','story_id; volume_id',725,353,205,94);
  entity(s,'genres','qua story_genres',1007,244,205,94);
  text(s,'1 : N',297,268,75,43,22,C.tealDark,true,'center');
  text(s,'1 : N',637,208,78,43,22,C.tealDark,true,'center');
  text(s,'1 : N',637,371,78,43,22,C.tealDark,true,'center');
  text(s,'N : M',939,268,64,43,22,C.tealDark,true,'center');
  entity(s,'favorites','user_id + story_id',130,491,269,86);
  entity(s,'reading_progress','user_id + story_id',476,491,293,86);
  text(s,'Cả hai bảng dưới gắn một người dùng với một truyện.',788,489,402,91,22,C.muted,false,'left',{verticalAlignment:'top'});
  notes(s,'Thời lượng 40 giây. Bắt đầu ở stories: một truyện có tập, chương, nhiều thể loại. users và stories nối qua owner_id. Hai bảng dưới là dữ liệu riêng theo tài khoản. Chuyển ý: khóa và CHECK làm quan hệ này an toàn.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts');
}
{
  const s=content('Ràng buộc dữ liệu','Quy tắc quan trọng được kiểm tra ngay trong PostgreSQL',10);
  tableRows(s,[
    ['PRIMARY KEY','stories.id định danh truyện; users.id định danh tài khoản'],
    ['FOREIGN KEY','current_chapter_id phải thuộc đúng story_id của dòng tiến độ'],
    ['Khóa ghép','favorites và reading_progress dùng (user_id, story_id)'],
    ['CHECK','position_permille từ 0 đến 1000; trạng thái chỉ nhận giá trị hợp lệ'],
  ],68,204,1142,94,298);
  notes(s,'Thời lượng 40 giây. Minh họa lỗi thực tế: không thể lưu tiến độ ở chương thuộc truyện khác. Khóa ghép ngăn một tài khoản có nhiều dòng tiến độ cho cùng truyện. Chuyển ý: các ràng buộc được đưa vào hệ thống qua migration.','db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts');
}
{
  const s=content('Migration PostgreSQL','API áp dụng migration thành công rồi mới mở cổng',11);
  codePanel(s,"await runner({\n  databaseUrl: env.databaseUrl,\n  dir: migrationDirectory,\n  direction: 'up',\n  migrationsTable: 'pgmigrations',\n  verbose: true\n});\n\napp.listen(env.port);",[
    ['001–003','Bật extension, tạo bảng lõi, thêm EPUB và media.'],
    ['004–007','Ngày phát hành, thể loại, duyệt thủ công và lịch sử phân quyền.'],
    ['Nếu migration lỗi','API dừng trước khi nhận yêu cầu.'],
  ]);
  notes(s,'Thời lượng 45 giây. Đoạn mã này là trích lược từ server.ts, bỏ phần try/catch để tập trung thứ tự. Mở file thật nếu hỏi. Chuyển ý: đã có cấu trúc, ta xem những thao tác thật ghi vào các bảng ra sao.','apps/api/src/server.ts; db/migrations/001-enable-extensions.ts; db/migrations/002-core-schema.ts; db/migrations/003-story-submissions-media.ts; db/migrations/004-story-publication-date.ts; db/migrations/005-genre-catalog.ts; db/migrations/006-manual-admin-review.ts; db/migrations/007-account-role-events.ts');
}
// 12-16: Phần ba
{
  const s=divider(3,'GHI VÀ CẬP NHẬT\nDỮ LIỆU','Bốn thao tác thật: nhập, duyệt, yêu thích và đọc tiếp',12);
  notes(s,'Chuyển ý: từ lược đồ chuyển sang nghiệp vụ. Chọn bốn thao tác người dùng nhìn thấy để nói dữ liệu thay đổi trong PostgreSQL.','README.md');
}
{
  const s=content('Nhập một tệp EPUB','Mỗi tệp tạo một bản nháp riêng để kiểm tra trước khi gửi duyệt',13);
  codePanel(s,"BEGIN\n\nINSERT INTO stories ...\nINSERT INTO volumes ...\nINSERT INTO chapters ...\nINSERT INTO media_assets ...\n\nCOMMIT  /  ROLLBACK",[
    ['Đọc tệp','Trích metadata, bìa, mục lục và nội dung chương.'],
    ['Lưu dữ liệu','Bản ghi vào PostgreSQL; bytes EPUB/ảnh vào kho media.'],
    ['Khi có lỗi','Rollback database và dọn tệp vừa tạo.'],
  ]);
  notes(s,'Thời lượng 45 giây. Đây là mã SQL khái quát, không phải câu lệnh nguyên văn. Nhập nhiều EPUB thì mỗi tệp thành bản nháp riêng; lỗi một tệp không làm mất các tệp khác. Chuyển ý: bản nháp chưa hiện trên app vì phải được duyệt.','apps/api/src/services/story-import-service.ts; README.md');
}
{
  const s=content('Duyệt và xuất bản truyện','Trạng thái trong stories quyết định truyện có hiện trên Android',14);
  const st=[['BẢN NHÁP','private / draft'],['HÀNG CHỜ','admin_review_pending'],['XUẤT BẢN','public / published']];
  st.forEach((v,i)=>{const x=75+i*388;shape(s,'rect',x,239,330,158,i===2?C.pale:C.white,C.line,2);text(s,v[0],x+20,264,290,44,27,C.ink,true,'center');text(s,v[1],x+18,319,294,43,20,C.muted,false,'center');});
  text(s,'→',419,274,40,55,39,C.tealDark,true,'center');text(s,'→',807,274,40,55,39,C.tealDark,true,'center');
  text(s,'AI có thể hỗ trợ rà soát. Khi chưa cấu hình AI, quản trị viên vẫn duyệt thủ công.',76,452,1104,91,25,C.ink);
  notes(s,'Thời lượng 40 giây. Theo luồng hiện tại, AI tùy chọn. Không có AI thì bản nháp chuyển sang hàng chờ admin. Chỉ sau khi admin duyệt thì stories chuyển public/published. Chuyển ý: khi đã xuất bản, người đọc có thể lưu truyện vào tủ sách.','apps/api/src/routes/admin-review.ts; db/migrations/006-manual-admin-review.ts; README.md');
}
{
  const s=content('Lưu truyện yêu thích','Một người chỉ có một dòng yêu thích cho mỗi truyện',15);
  codePanel(s,"INSERT INTO favorites\n  (user_id, story_id)\nSELECT $1, s.id\nFROM stories AS s\nWHERE s.id = $2\n  AND s.visibility = 'public'\n  AND s.moderation_status = 'published'\nON CONFLICT (user_id, story_id)\nDO UPDATE ...;",[
    ['Thao tác','Người đọc chạm biểu tượng yêu thích trên Android.'],
    ['Khóa ghép','(user_id, story_id) ngăn lưu trùng.'],
    ['Điều kiện','Chỉ truyện đã xuất bản mới được thêm.'],
  ]);
  notes(s,'Thời lượng 35 giây. Đây là truy vấn rút gọn; trong library.ts có câu đầy đủ. user_id lấy từ phiên đăng nhập, không lấy tùy ý từ app. Chuyển ý: tiến độ đọc dùng cùng khóa ghép nhưng lưu thêm vị trí.','apps/api/src/routes/library.ts; db/migrations/002-core-schema.ts');
}
{
  const s=content('Lưu tiến độ đọc','Đọc lại truyện sẽ mở chương và vị trí đã lưu',16);
  codePanel(s,"INSERT INTO reading_progress\n (user_id, story_id,\n  current_chapter_id, position_permille)\nSELECT $1, s.id, c.id, $4\nFROM stories s JOIN chapters c\n  ON c.story_id = s.id\nWHERE s.id = $2 AND c.id = $3\nON CONFLICT (user_id, story_id)\nDO UPDATE SET ...;",[
    ['Khóa ghép','Mỗi tài khoản có một dòng tiến độ trên mỗi truyện.'],
    ['Vị trí','position_permille nằm trong khoảng 0–1000.'],
    ['Kiểm tra','Chương phải thuộc đúng truyện; API lọc truyện đã xuất bản.'],
  ]);
  notes(s,'Thời lượng 45 giây. Giải thích UPSERT: lần đầu thêm dòng, lần sau cập nhật. Composite FK ngăn chương của truyện khác. Chuyển ý: ta sẽ kiểm chứng các thay đổi này trên API, Android và câu SQL.','apps/api/src/routes/library.ts; db/migrations/002-core-schema.ts');
}
// 17-21: Phần bốn
{
  const s=divider(4,'TRUY VẤN\nVÀ DEMO','Đối chiếu dữ liệu ở PostgreSQL với giao diện Android',17);
  notes(s,'Chuyển ý: từ thao tác ghi sang đọc. Trước khi demo, giải thích vì sao chỉ truyện đã duyệt có mặt trong danh mục.','apps/api/src/routes/catalog.ts');
}
{
  const s=content('Truy vấn danh mục truyện','API chỉ trả truyện ở trạng thái public và published',18);
  codePanel(s,"SELECT ... FROM stories AS s\nWHERE s.visibility = 'public'\n  AND s.moderation_status = 'published'\nORDER BY s.created_at DESC;",[
    ['Android','Gọi GET /api/v1/stories.'],
    ['API','Chạy truy vấn có tham số cho bộ lọc người dùng.'],
    ['Kết quả','Bản nháp riêng tư không hiện trong Khám phá.'],
  ]);
  notes(s,'Thời lượng 35 giây. Truy vấn trên slide là phần điều kiện cốt lõi, được rút gọn. Chỉ vào catalog.ts và CatalogApiClient.java nếu giảng viên muốn thấy cả hai đầu. Chuyển ý: những thao tác ghi còn phải qua kiểm tra tài khoản.','apps/api/src/routes/catalog.ts; apps/android/app/src/main/java/com/readlite/mobile/CatalogApiClient.java');
}
{
  const s=content('Quyền truy cập trước khi ghi','API xác thực phiên và kiểm tra vai trò',19);
  tableRows(s,[
    ['user','Đọc truyện, lưu yêu thích và tiến độ của chính mình'],
    ['author','Tạo, nhập EPUB và quản lý bản nháp của mình'],
    ['admin','Duyệt truyện và phân quyền tài khoản'],
  ],68,210,1142,105,258);
  text(s,'Câu SQL dùng tham số $1, $2...; lịch sử đổi vai trò lưu ở account_role_events.',71,561,1120,69,22,C.tealDark,true);
  notes(s,'Thời lượng 35 giây. Android không dùng DATABASE_URL. Server xác thực và phân quyền, rồi mới chạy câu SQL có tham số. account_role_events ghi ai đổi quyền cho ai. Chuyển ý sang demo trực tiếp.','apps/api/src/routes/library.ts; apps/api/src/routes/admin-review.ts; apps/api/src/routes/admin-users.ts; db/migrations/007-account-role-events.ts');
}
{
  const s=content('Demo trực tiếp trong 3 phút','Một thao tác trên Android được kiểm chứng bằng truy vấn PostgreSQL',20);
  const steps=[
    ['01','Mở hệ thống','API health, web và Android cùng hoạt động'],
    ['02','Thao tác trên app','Yêu thích một truyện và đọc một chương'],
    ['03','Xem tủ sách','Truyện và vị trí đọc hiện đúng tài khoản'],
    ['04','Đối chiếu SQL','SELECT từ favorites và reading_progress'],
  ];
  steps.forEach((a,i)=>{const y=198+i*105;text(s,a[0],71,y,87,70,44,C.teal,true);text(s,a[1],169,y+1,349,34,25,C.ink,true);text(s,a[2],537,y+1,635,55,21,C.muted);rule(s,169,y+88,1010,C.line,1);});
  notes(s,'Thời lượng 3 phút nếu demo trong bài. Chuẩn bị truyện public/published và tài khoản đăng nhập. Bắt đầu bằng health, thao tác yêu thích và đọc trên Android, mở Tủ sách, cuối cùng chạy SELECT theo email tài khoản demo. Không chọn nhập EPUB lớn tại chỗ. Câu SQL đầy đủ ở tài liệu hướng dẫn.','README.md; apps/api/src/routes/library.ts');
}
{
  const s=content('Mã nguồn để trả lời giảng viên','Mở đúng đoạn mã theo câu hỏi thay vì tìm trong lúc trình bày',21);
  tableRows(s,[
    ['Bảng và khóa','db/migrations/002-core-schema.ts'],
    ['Migration','apps/api/src/server.ts'],
    ['Truyện công khai','apps/api/src/routes/catalog.ts'],
    ['Yêu thích, tiến độ','apps/api/src/routes/library.ts'],
    ['Nhập EPUB và duyệt','apps/api/src/services/story-import-service.ts\napps/api/src/routes/admin-review.ts'],
  ],68,194,1142,79,318);
  notes(s,'Thời lượng 25 giây nếu còn thời gian; nếu gần hết giờ, giữ slide này cho hỏi đáp. Chuẩn bị các tab IDE theo đúng thứ tự câu hỏi. Tránh cuộn tìm file trước lớp.','db/migrations/002-core-schema.ts; apps/api/src/server.ts; apps/api/src/routes/catalog.ts; apps/api/src/routes/library.ts; apps/api/src/services/story-import-service.ts; apps/api/src/routes/admin-review.ts');
}
// 22-23: Kết luận
{
  const s=content('Tổng kết','Ba ý cần nhớ về PostgreSQL trong ReadLite',22);
  const points=[
    ['01','Dữ liệu dùng chung','Android và web gặp nhau tại API; API kết nối PostgreSQL.'],
    ['02','Quan hệ có ràng buộc','Khóa, CHECK và transaction giữ truyện, chương và tiến độ nhất quán.'],
    ['03','Truyện chỉ hiện sau duyệt','Catalog chỉ trả truyện public và published.'],
  ];
  points.forEach((a,i)=>{const y=197+i*137;text(s,a[0],72,y,84,57,43,C.teal,true);text(s,a[1],173,y-2,950,39,28,C.ink,true);text(s,a[2],173,y+40,950,57,22,C.muted);rule(s,173,y+110,1003,C.line,1);});
  notes(s,'Thời lượng 30 giây. Kết luận đúng ba ý, nối lại phần một, hai và demo. Không nói hệ thống đã hoàn tất triển khai production. Chuyển sang lời cảm ơn và hỏi đáp.','README.md; apps/api/src/routes/catalog.ts');
}
{
  const s=deck.slides.add();s.background.fill=C.navy;shape(s,'rect',850,0,430,H,C.strip);
  text(s,'CẢM ƠN THẦY\nVÀ CÁC BẠN\nĐÃ LẮNG NGHE',75,180,727,259,54,C.white,true,'left',{verticalAlignment:'top'});
  text(s,'ReadLite  |  PostgreSQL  |  Android + Web',76,580,735,36,20,'#CBE9EF');
  notes(s,'Mời thầy/cô đặt câu hỏi. Khi hỏi mã nguồn, chuyển về slide 21 rồi mở file tương ứng.');
}

await fs.mkdir(BUILD,{recursive:true});
await fs.mkdir(path.dirname(OUT),{recursive:true});
for(let i=0;i<deck.slides.items.length;i++){
  const im=await deck.export({slide:deck.slides.items[i],format:'png',scale:1});
  await fs.writeFile(path.join(BUILD,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await im.arrayBuffer()));
}
const draft=path.join(BUILD,'readlite-structured-candidate.pptx');
await (await PresentationFile.exportPptx(deck)).save(draft);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({
  explicitTotalSlideCount:23,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
  workspaceDir:ROOT,candidatePath:draft,finalPath:OUT,
  pythonExecutable:'C:/Users/Vu Tai/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
  fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,
  receiptPath:path.join(BUILD,'validation-final-v2.json'),
});
console.log(JSON.stringify({output:OUT,slides:deck.slides.items.length,validation:result}));
