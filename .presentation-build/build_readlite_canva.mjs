import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const ROOT='C:/Users/Vu Tai/Desktop/readlite-platform-completed/readlite-platform';
const SKILL='C:/Users/Vu Tai/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/presentations';
const BUILD=path.join(ROOT,'.presentation-build','canva-final');
const OUT=path.join(ROOT,'deliverables','ReadLite_PostgreSQL_phong_cach_Canva.pptx');
const A=path.join(ROOT,'.presentation-build','canva-assets');
const source=JSON.parse(await fs.readFile(path.join(ROOT,'.presentation-build','user-latest-text.json'),'utf8'));
const W=1280,H=720;
const C={navy:'#123F5A',deep:'#0B3048',blue:'#DDF4F4',white:'#FFFFFF',muted:'#C4E0E5',mint:'#8ED6BF',yellow:'#F4CC56',line:'#72B9C9',ink:'#0B3048'};
const deck=Presentation.create({slideSize:{width:W,height:H}});
const bytes={};
for(const name of ['background','folder','database-check','lock','cloud','magnifier','phone-book']) bytes[name]=await fs.readFile(path.join(A,name+'.png'));
function shape(s,g,x,y,w,h,fill='none',stroke='none',sw=0){return s.shapes.add({geometry:g,position:{left:x,top:y,width:w,height:h},fill,line:{style:'solid',fill:stroke,width:sw}});}
function txt(s,v,x,y,w,h,size=24,color=C.white,bold=false,align='left',font='Arial'){
 const q=shape(s,'textbox',x,y,w,h);q.text=String(v);q.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',wrap:'square',autoFit:'shrinkText',insets:0};return q;
}
function img(s,name,x,y,w,h){const b=bytes[name];return s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',alt:name,fit:'contain',position:{left:x,top:y,width:w,height:h}});}
function base(i){const s=deck.slides.add();img(s,'background',0,0,W,H);txt(s,'READLITE  /  POSTGRESQL',58,22,360,28,15,C.muted,true);txt(s,String(i).padStart(2,'0'),1170,22,50,28,15,C.muted,true,'right');s.speakerNotes.text=source[i-1].notes||'';return s;}
function title(s,t,sub='',wide=1110){txt(s,t,64,74,wide,74,49,C.blue,true);if(sub)txt(s,sub,66,153,wide,52,24,C.white);shape(s,'line',66,215,1138,0,'none',C.line,2);}
function divider(i,num,label){const s=base(i);txt(s,num,70,145,282,195,145,C.yellow,true);txt(s,label,363,174,805,235,66,C.blue,true);shape(s,'line',371,440,720,0,'none',C.line,3);return s;}
function rows(s,data,{x=70,y=245,w=1135,gap=93,num=false,head=27,body=20}={}){
 data.forEach((r,j)=>{const yy=y+j*gap;if(num)txt(s,String(j+1).padStart(2,'0'),x,yy,84,60,43,C.yellow,true);const xx=x+(num?103:0);txt(s,r[0],xx,yy,w-(num?103:0),34,head,C.blue,true);txt(s,r[1],xx,yy+38,w-(num?103:0),Math.max(36,gap-45),body,C.white);if(j<data.length-1)shape(s,'line',xx,yy+gap-11,w-(num?103:0),0,'none',C.line,1);});
}
function splitRows(s,data,icon){const leftW=icon?760:1120;rows(s,data,{x:68,y:235,w:leftW,gap:data.length>3?97:132,head:29,body:22});if(icon)img(s,icon,875,268,300,310);}
function codeSlide(i,t,sub,code,data){const s=base(i);title(s,t,sub);shape(s,'roundRect',64,245,690,380,C.deep,C.line,2);txt(s,code,91,269,639,335,21,'#D5F5DF',false,'left','Consolas');rows(s,data,{x:791,y:251,w:425,gap:116,head:24,body:19});return s;}
function flowBox(s,x,y,w,h,head,body,color=C.yellow){shape(s,'roundRect',x,y,w,h,color,C.deep,3);txt(s,head,x+16,y+12,w-32,37,25,C.ink,true,'center');txt(s,body,x+15,y+52,w-30,h-60,18,C.ink,false,'center');}
function pairs(t,start=0,count){const a=[];for(let k=start;k<t.length && (!count||a.length<count);k+=2)a.push([t[k],t[k+1]||'']);return a;}
for(let i=1;i<=23;i++){
 const t=source[i-1].texts.filter((v)=>v!=='READLITE  |  POSTGRESQL' && !(i===11||i===14||i===20 ? v===String(i):false));
 let s;
 if([3,7,12,17].includes(i)){divider(i,t[0],t[1]);continue;}
 if(i===1){s=base(i);txt(s,'CƠ SỞ DỮ LIỆU\nTRONG READLITE',64,117,738,202,63,C.blue,true);txt(s,'Nhóm 18',69,348,470,49,28,C.yellow,true);img(s,'folder',865,98,302,263);const nodes=[['ANDROID','Đọc truyện'],['WEB','Quản trị'],['REST API','Xác thực và xử lý'],['POSTGRESQL','Dữ liệu ứng dụng']];nodes.forEach((a,j)=>{let x=70+j*294;flowBox(s,x,480,260,110,a[0],a[1],j===3?C.mint:C.yellow);if(j<3)txt(s,'→',x+260,502,34,55,34,C.white,true,'center')});continue;}
 if(i===2){s=base(i);title(s,t[0],t[1]);rows(s,[[t[3],t[4]],[t[6],t[7]],[t[9],t[10]],[t[12],t[13]]],{x:76,y:234,w:1100,gap:106,num:true,head:30,body:20});continue;}
 if(i===4){s=base(i);title(s,t[0],t[1]);rows(s,[[t[2],t[3]],[t[4],t[5]],[t[6],t[7]]],{x:65,y:243,w:732,gap:128,head:28,body:21});img(s,'phone-book',874,265,288,315);continue;}
 if(i===5){s=base(i);title(s,t[0],t[1]);flowBox(s,70,255,254,107,t[2],t[3]);flowBox(s,70,423,254,107,t[4],t[5]);txt(s,'→',336,350,60,62,53,C.white,true,'center');flowBox(s,406,337,270,113,t[8],t[9],C.mint);txt(s,'→',691,350,60,62,53,C.white,true,'center');flowBox(s,766,255,404,107,t[11],t[12]);flowBox(s,766,423,404,107,t[13],t[14]);txt(s,t[15],86,586,1080,61,22,C.blue,true,'center');continue;}
 if(i===6){s=base(i);title(s,t[0]);rows(s,[[t[1],t[2]],[t[3],t[4]],[t[5],t[6]]],{x:66,y:234,w:763,gap:118,head:30,body:21});img(s,'cloud',876,241,283,258);txt(s,t[7],66,615,1130,49,22,C.yellow,true);continue;}
 if(i===8){s=base(i);title(s,t[0],t[1]);rows(s,pairs(t,2),{x:73,y:237,w:1100,gap:95,num:true,head:28,body:20});continue;}
 if(i===9){s=base(i);title(s,t[0],t[1]);const names=[['users','id UUID'],['stories','id BIGINT; owner_id'],['volumes','story_id'],['chapters','story_id; volume_id'],['genres','qua story_genres']];names.forEach((a,j)=>flowBox(s,65+j*241,273,213,106,a[0],a[1],j%2?C.mint:C.yellow));txt(s,'1 : N         1 : N         1 : N         N : M',151,397,1000,50,27,C.blue,true,'center');flowBox(s,300,472,295,99,'favorites','user_id + story_id',C.mint);flowBox(s,665,472,295,99,'reading_progress','user_id + story_id',C.mint);txt(s,t.at(-1),125,613,1030,44,23,C.white,false,'center');continue;}
 if(i===10){s=base(i);title(s,t[0],t[1]);rows(s,pairs(t,2),{x:64,y:236,w:760,gap:98,head:27,body:19});img(s,'database-check',851,248,327,327);continue;}
 if(i===11){codeSlide(i,t[0],t[1],t[2],pairs(t,3));continue;}
 if(i===13){codeSlide(i,t[0],t[1],t[2],pairs(t,3));continue;}
 if(i===14){s=base(i);title(s,t[0],t[1]);[[t[2],t[3]],[t[4],t[5]],[t[6],t[7]]].forEach((a,j)=>{let x=76+j*386;flowBox(s,x,313,313,167,a[0],a[1],j===2?C.mint:C.yellow);if(j<2)txt(s,'→',x+319,356,60,65,50,C.white,true,'center')});txt(s,t.at(-1),76,579,1090,75,23,C.blue,false,'center');continue;}
 if(i===15||i===16){codeSlide(i,t[0],t[1],t[2],pairs(t,3));continue;}
 if(i===18){codeSlide(i,t[0],'',t[1],pairs(t,2));continue;}
 if(i===19){s=base(i);title(s,t[0]);rows(s,pairs(t,1,3),{x:64,y:237,w:762,gap:115,head:31,body:21});img(s,'lock',858,263,297,294);txt(s,t.at(-1),65,611,1138,53,21,C.yellow,true);continue;}
 if(i===20){s=base(i);title(s,t[0]);rows(s,[[t[2],t[3]],[t[5],t[6]],[t[8],t[9]],[t[11],t[12]]],{x:76,y:232,w:1100,gap:107,num:true,head:29,body:20});continue;}
 if(i===21){s=base(i);title(s,t[0]);rows(s,pairs(t,1),{x:70,y:225,w:1130,gap:84,head:26,body:20});continue;}
 if(i===22){s=base(i);title(s,t[0]);rows(s,[[t[2],t[3]],[t[5],t[6]],[t[8],t[9]]],{x:75,y:245,w:1100,gap:136,num:true,head:32,body:22});continue;}
 if(i===23){s=base(i);txt(s,t[0],95,207,1090,275,70,C.blue,true,'center');shape(s,'line',310,518,660,0,'none',C.yellow,4);continue;}
}
await fs.mkdir(BUILD,{recursive:true});await fs.mkdir(path.dirname(OUT),{recursive:true});
for(let i=0;i<deck.slides.items.length;i++){const im=await deck.export({slide:deck.slides.items[i],format:'png',scale:1});await fs.writeFile(path.join(BUILD,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await im.arrayBuffer()));}
const draft=path.join(BUILD,'candidate.pptx');await (await PresentationFile.exportPptx(deck)).save(draft);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({explicitTotalSlideCount:23,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],workspaceDir:ROOT,candidatePath:draft,finalPath:OUT,pythonExecutable:'C:/Users/Vu Tai/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],fontPolicy:{basis:'design',families:['Arial','Consolas']},verifyArtifactToolImport:true,receiptPath:path.join(BUILD,'validation.json')});
console.log(JSON.stringify({output:OUT,slides:deck.slides.items.length,validation:result}));
