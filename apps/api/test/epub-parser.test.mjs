import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractReferencedMedia,
  parseEpub,
  EpubParseError,
} from '../src/epub/epub-parser.ts';
import { LocalMediaStorage } from '../src/media/local-media-storage.ts';

const roots = [];

async function writeEpub(entries) {
  const root = await mkdtemp(join(tmpdir(), 'readlite-epub-test-'));
  roots.push(root);
  const epubPath = join(root, 'sample.epub');
  await writeFile(epubPath, makeZip(entries));
  return epubPath;
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test('parses EPUB 3 metadata, explicit volume, chapter order, cover and safe image blocks', async () => {
  const epubPath = await writeEpub(epub3Entries());
  const parsed = await parseEpub(epubPath);

  assert.deepEqual(parsed.metadata, {
    title: 'Đường về nhà',
    creator: 'Lê An',
    language: 'vi',
    description: '',
    publicationDate: null,
    genres: [],
  });
  assert.equal(parsed.coverPath, 'OEBPS/images/cover.png');
  assert.equal(parsed.volumes.length, 1);
  assert.equal(parsed.volumes[0].title, 'Tập 1');
  assert.deepEqual(parsed.volumes[0].chapters.map((chapter) => chapter.title), [
    'Chương một',
    'Chương hai',
  ]);

  const firstChapter = parsed.volumes[0].chapters[0];
  const runs = firstChapter.blocks
    .filter((block) => block.type === 'text')
    .flatMap((block) => block.runs);
  assert.ok(runs.some((run) => run.text === 'thế giới' && run.bold));
  assert.ok(firstChapter.blocks.some((block) =>
    block.type === 'image' && block.archivePath === 'OEBPS/images/inside.png'
      && block.altText === 'Bản đồ'));
  assert.ok(!JSON.stringify(firstChapter.blocks).includes('alert('));
  assert.ok(!JSON.stringify(firstChapter.blocks).includes('outside.test'));
  assert.ok(firstChapter.wordCount > 0);
});

test('falls back to spine order and reports missing navigation/cover', async () => {
  const entries = epub3Entries();
  delete entries['OEBPS/nav.xhtml'];
  delete entries['OEBPS/images/cover.png'];
  entries['OEBPS/book.opf'] = entries['OEBPS/book.opf']
    .replace('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '');
  const parsed = await parseEpub(await writeEpub(entries));

  assert.deepEqual(parsed.volumes[0].chapters.map((chapter) => chapter.order), [1, 2]);
  assert.ok(parsed.warnings.some((warning) => warning.includes('mục lục')));
  assert.ok(parsed.warnings.some((warning) => warning.includes('bìa')));
});

test('finds a raster cover referenced by an XHTML cover page', async () => {
  const entries = epub3Entries();
  entries['OEBPS/book.opf'] = entries['OEBPS/book.opf']
    .replace('content="cover"', 'content="coverPage"')
    .replace('<item id="cover" href="images/cover.png" media-type="image/png"/>',
      '<item id="coverPage" href="text/cover.xhtml" media-type="application/xhtml+xml"/><item id="art" href="images/art.png" media-type="image/png"/>');
  entries['OEBPS/text/cover.xhtml'] = '<html><body><svg><image href="../images/art.png"/></svg></body></html>';
  entries['OEBPS/images/art.png'] = entries['OEBPS/images/cover.png'];
  delete entries['OEBPS/images/cover.png'];

  const parsed = await parseEpub(await writeEpub(entries));
  assert.equal(parsed.coverPath, 'OEBPS/images/art.png');
  assert.equal(parsed.mediaTypes['OEBPS/images/art.png'], 'image/png');
});

test('parses EPUB 2 NCX navigation and decodes the chapter title in document order', async () => {
  const epubPath = await writeEpub({
    'META-INF/container.xml': `<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`,
    'OEBPS/book.opf': `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Hành trình</dc:title><dc:creator>An</dc:creator><dc:language>vi</dc:language></metadata>
      <manifest>
        <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine toc="toc"><itemref idref="chapter"/></spine>
    </package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0"?><ncx><navMap><navPoint id="n1">
      <navLabel><text>Chương NCX</text></navLabel><content src="Text/chapter.xhtml"/>
    </navPoint></navMap></ncx>`,
    'OEBPS/Text/chapter.xhtml': '<html><head><title>Tiêu đề XHTML</title></head><body><p>Xin chào.</p></body></html>',
  });
  const parsed = await parseEpub(epubPath);

  assert.equal(parsed.volumes[0].title, 'Tập 1');
  assert.equal(parsed.volumes[0].chapters[0].title, 'Chương NCX');
  assert.equal(parsed.volumes[0].chapters[0].content, 'Xin chào.');
});

test('rejects archive paths that escape the EPUB root', async () => {
  await assert.rejects(
    parseEpub(await writeEpub({
      ...epub3Entries(),
      '../outside.txt': 'không được giải nén',
    })),
    (error) => error instanceof EpubParseError && error.code === 'ZIP_PATH_INVALID',
  );
});

test('rejects malformed or entity-bearing XML instead of parsing it', async () => {
  const entries = epub3Entries();
  entries['META-INF/container.xml'] = '<!DOCTYPE container [<!ENTITY x "y">]><container>&x;</container>';

  await assert.rejects(
    parseEpub(await writeEpub(entries)),
    (error) => error instanceof EpubParseError && error.code === 'XML_UNSAFE',
  );
});

test('extracts only requested EPUB images through the media storage stream', async () => {
  const epubPath = await writeEpub(epub3Entries());
  const mediaRoot = await mkdtemp(join(tmpdir(), 'readlite-media-test-'));
  roots.push(mediaRoot);
  const media = await extractReferencedMedia(
    epubPath,
    ['OEBPS/images/cover.png', 'OEBPS/images/inside.png'],
    new LocalMediaStorage(mediaRoot),
    10 * 1024 * 1024,
    { 'OEBPS/images/cover.png': 'image/png', 'OEBPS/images/inside.png': 'image/png' },
  );

  assert.equal(media.size, 2);
  assert.ok(media.get('OEBPS/images/cover.png')?.byteSize > 0);
  assert.equal(media.get('OEBPS/images/cover.png')?.mimeType, 'image/png');
  assert.equal((await readdir(mediaRoot)).length, 2);
});

test('uses the actual image type when an EPUB labels WebP data as PNG', async () => {
  const entries = epub3Entries();
  entries['OEBPS/images/inside.png'] = Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary');
  const epubPath = await writeEpub(entries);
  const mediaRoot = await mkdtemp(join(tmpdir(), 'readlite-media-test-'));
  roots.push(mediaRoot);

  const media = await extractReferencedMedia(
    epubPath,
    ['OEBPS/images/inside.png'],
    new LocalMediaStorage(mediaRoot),
    10 * 1024 * 1024,
    { 'OEBPS/images/inside.png': 'image/png' },
  );
  assert.equal(media.get('OEBPS/images/inside.png')?.mimeType, 'image/webp');
});

test('invalid embedded image rejects its import without terminating the process or leaving media behind', async () => {
  const entries = epub3Entries();
  entries['OEBPS/images/inside.png'] = Buffer.from('not a PNG image');
  const epubPath = await writeEpub(entries);
  const mediaRoot = await mkdtemp(join(tmpdir(), 'readlite-media-test-'));
  roots.push(mediaRoot);

  await assert.rejects(
    extractReferencedMedia(
      epubPath,
      ['OEBPS/images/cover.png', 'OEBPS/images/inside.png'],
      new LocalMediaStorage(mediaRoot),
      10 * 1024 * 1024,
      { 'OEBPS/images/cover.png': 'image/png', 'OEBPS/images/inside.png': 'image/png' },
    ),
    (error) => error instanceof EpubParseError && error.code === 'EPUB_ENTRY_INVALID',
  );
  assert.equal((await readdir(mediaRoot)).length, 0);

  const validEpubPath = await writeEpub(epub3Entries());
  const media = await extractReferencedMedia(
    validEpubPath,
    ['OEBPS/images/cover.png'],
    new LocalMediaStorage(mediaRoot),
    10 * 1024 * 1024,
    { 'OEBPS/images/cover.png': 'image/png' },
  );
  assert.equal(media.size, 1);
});

test('decodes XHTML using its declared HTML charset so accented text stays readable', async () => {
  const entries = epub3Entries();
  entries['OEBPS/text/one.xhtml'] = Buffer.from(
    '<html><head><meta charset="windows-1252"><title>Capítulo</title></head>' +
      '<body><p>El café tiene aroma.</p></body></html>',
    'latin1',
  );
  const parsed = await parseEpub(await writeEpub(entries));

  assert.equal(parsed.volumes[0].chapters[0].content, 'El café tiene aroma.');
});
function epub3Entries() {
  return {
    'META-INF/container.xml': `<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`,
    'OEBPS/book.opf': `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
        <metadata><dc:title>Đường về nhà</dc:title><dc:creator>Lê An</dc:creator><dc:language>vi</dc:language><meta name="cover" content="cover"/></metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
          <item id="cover" href="images/cover.png" media-type="image/png"/>
          <item id="inside" href="images/inside.png" media-type="image/png"/>
        </manifest>
        <spine><itemref idref="one"/><itemref idref="two"/></spine>
      </package>`,
    'OEBPS/nav.xhtml': `<!doctype html><html xmlns:epub="http://www.idpf.org/2007/ops"><body>
      <nav epub:type="toc"><ol><li><a href="text/one.xhtml">Tập 1</a><ol>
        <li><a href="text/one.xhtml">Chương một</a></li>
        <li><a href="text/two.xhtml">Chương hai</a></li>
      </ol></li></ol></nav></body></html>`,
    'OEBPS/text/one.xhtml': `<?xml version="1.0"?><html><head><title>Chương một</title></head><body>
      <h1>Chương một</h1><p>Chào <strong>thế giới</strong>!</p>
      <p>Trước<img src="../images/inside.png" alt="Bản đồ"/>Sau.</p>
      <script>alert('bad')</script><img src="https://outside.test/x.png" alt="ngoài"/>
    </body></html>`,
    'OEBPS/text/two.xhtml': '<html><body><p>Hết.</p></body></html>',
    'OEBPS/images/cover.png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'OEBPS/images/inside.png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  };
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [fileName, rawValue] of Object.entries(entries)) {
    const name = Buffer.from(fileName, 'utf8');
    const content = Buffer.isBuffer(rawValue) ? rawValue : Buffer.from(rawValue, 'utf8');
    const crc = crc32(content);
    const local = Buffer.alloc(30 + name.length + content.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    content.copy(local, 30 + name.length);
    localParts.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(localParts.length, 8);
  end.writeUInt16LE(localParts.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}



test('extracts metadata and volume boundaries from an EPUB story page without treating it as a chapter', async () => {
  const parsed = await parseEpub(await writeEpub({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
    'OEBPS/book.opf': `<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Duong ve nha</dc:title><dc:creator>ln.dichmau.com</dc:creator><dc:language>en</dc:language><dc:date>2024-09-06</dc:date><dc:subject>Fantasy</dc:subject></metadata>
      <manifest>
        <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="info" href="Text/index.xhtml" media-type="application/xhtml+xml"/>
        <item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/>
        <item id="two" href="Text/two.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine toc="toc"><itemref idref="info"/><itemref idref="one"/><itemref idref="two"/></spine>
    </package>`,
    'OEBPS/toc.ncx': `<ncx><navMap>
      <navPoint id="book"><navLabel><text>Duong ve nha</text></navLabel><content src="Text/index.xhtml"/></navPoint>
      <navPoint id="volume-one"><navLabel><text>Tập 1: Khởi đầu</text></navLabel><content src="Text/index.xhtml"/></navPoint>
      <navPoint id="chapter-one"><navLabel><text>Chương 01</text></navLabel><content src="Text/one.xhtml"/></navPoint>
      <navPoint id="volume-two"><navLabel><text>Vol 2: Trở về</text></navLabel><content src="Text/index.xhtml"/></navPoint>
      <navPoint id="chapter-two"><navLabel><text>Chương 02</text></navLabel><content src="Text/two.xhtml"/></navPoint>
    </navMap></ncx>`,
    'OEBPS/Text/index.xhtml': `<html><body>
      <a class="series-title" href="index.xhtml">Đường về nhà</a>
      <div><a href="https://ln.hako.vn/the-loai/fantasy">Fantasy</a><a href="https://ln.hako.vn/the-loai/action">Action</a></div>
      <div><span>Tác giả:</span>
        <span><a>Lê An</a></span></div>
      <section><h4>Tóm tắt</h4>
        <div><p>Giới thiệu đoạn một.</p><p>Đoạn hai.</p></div></section>
    </body></html>`,
    'OEBPS/Text/one.xhtml': `<html><body>
      <div class="title-top"><h2>Vol 1: Khởi đầu</h2><h4>Chương 01</h4><h6>0 Bình luận - Độ dài: 123 từ</h6></div>
      <div id="chapter-content"><p>Chương 01</p><p>Nội dung tiếng Việt có dấu.</p></div>
    </body></html>`,
    'OEBPS/Text/two.xhtml': `<html><body><div class="title-top"><h4>Chương 02</h4></div><div id="chapter-content"><p>Chương 02</p><p>Chương tiếp theo.</p></div></body></html>`,
  }));

  assert.deepEqual(parsed.metadata, {
    title: 'Đường về nhà',
    creator: 'Lê An',
    language: 'en',
    description: 'Giới thiệu đoạn một.\n\nĐoạn hai.',
    publicationDate: '2024-09-06',
    genres: [
      { name: 'Fantasy', slug: 'fantasy' },
      { name: 'Action', slug: 'action' },
    ],
  });
  assert.deepEqual(parsed.volumes.map((volume) => volume.title), [
    'Tập 1: Khởi đầu',
    'Vol 2: Trở về',
  ]);
  assert.deepEqual(parsed.volumes.map((volume) => volume.chapters.map((chapter) => chapter.title)), [
    ['Chương 01'],
    ['Chương 02'],
  ]);
  assert.equal(parsed.volumes[0].chapters[0].content, 'Nội dung tiếng Việt có dấu.');
  assert.equal(parsed.volumes[1].chapters[0].content, 'Chương tiếp theo.');
});
