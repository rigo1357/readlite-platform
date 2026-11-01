import { stat } from 'node:fs/promises';
import { PassThrough, pipeline, Transform, type Readable } from 'node:stream';
import { posix } from 'node:path';
import { TextDecoder } from 'node:util';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse as parseHtml } from 'parse5';
import * as yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import { DEFAULT_EPUB_LIMITS } from './epub-limits.js';
import type { EpubLimits } from './epub-limits.js';
import type {
  ParsedEpub,
  ParsedReaderBlock,
  ParsedVolume,
  ReaderTextRun,
} from './epub-types.js';
import type { MediaStorage, StoredMediaObject } from '../media/media-storage.js';

export type EpubParseErrorCode =
  | 'EPUB_TOO_LARGE'
  | 'ZIP_TOO_MANY_ENTRIES'
  | 'ZIP_ENTRY_TOO_LARGE'
  | 'ZIP_EXPANSION_TOO_LARGE'
  | 'ZIP_RATIO_TOO_HIGH'
  | 'ZIP_ENCRYPTED'
  | 'ZIP_UNSUPPORTED'
  | 'ZIP_PATH_INVALID'
  | 'ZIP_DUPLICATE_PATH'
  | 'EPUB_FILE_MISSING'
  | 'EPUB_CONTENT_TOO_LARGE'
  | 'EPUB_INVALID'
  | 'EPUB_NO_SPINE'
  | 'EPUB_NO_READABLE_CHAPTERS'
  | 'XML_UNSAFE'
  | 'XML_INVALID'
  | 'EPUB_ENTRY_INVALID';

export class EpubParseError extends Error {
  constructor(public readonly code: EpubParseErrorCode) {
    super(code);
    this.name = 'EpubParseError';
  }
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string;
}

interface TocItem {
  title: string;
  path: string | null;
  children: TocItem[];
}

interface SpineDocument {
  path: string;
  manifestItem: ManifestItem;
  parsedTitle: string;
  blocks: ParsedReaderBlock[];
  content: string;
  wordCount: number;
}

interface EmbeddedStoryMetadata {
  isStoryPage: boolean;
  title: string;
  creator: string;
  description: string;
  genres: Array<{ name: string; slug: string | null }>;
}

interface XmlRecord {
  [key: string]: unknown;
}

interface HtmlNode {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

const ignoredHtmlTags = new Set([
  'head', 'script', 'style', 'noscript', 'template', 'iframe', 'object',
  'embed', 'form', 'svg', 'canvas', 'video', 'audio',
]);
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMPORTED_IMAGE_BYTES = 10 * 1024 * 1024;

export async function parseEpub(
  epubPath: string,
  limits: EpubLimits = DEFAULT_EPUB_LIMITS,
): Promise<ParsedEpub> {
  const fileInfo = await stat(epubPath).catch(() => null);
  if (!fileInfo?.isFile()) {
    throw new EpubParseError('EPUB_INVALID');
  }
  if (fileInfo.size > limits.maxArchiveBytes) {
    throw new EpubParseError('EPUB_TOO_LARGE');
  }

  const zip = await openZip(epubPath);
  try {
    const entries = await inventoryEntries(zip, limits);
    return await parseArchive(zip, entries, limits);
  } catch (error) {
    if (error instanceof EpubParseError) {
      throw error;
    }
    throw new EpubParseError('EPUB_INVALID');
  } finally {
    zip.close();
  }
}

export async function extractReferencedMedia(
  epubPath: string,
  archivePaths: string[],
  storage: MediaStorage,
  maxImageBytes = MAX_IMPORTED_IMAGE_BYTES,
  mimeTypes: Readonly<Record<string, string>> = {},
): Promise<Map<string, StoredMediaObject & { mimeType: string }>> {
  const zip = await openZip(epubPath);
  const stored = new Map<string, StoredMediaObject & { mimeType: string }>();
  try {
    const entries = await inventoryEntries(zip, DEFAULT_EPUB_LIMITS);
    for (const archivePath of new Set(archivePaths)) {
      const entry = entries.get(archivePath);
      if (!entry || entry.uncompressedSize > maxImageBytes) {
        throw new EpubParseError(entry ? 'ZIP_ENTRY_TOO_LARGE' : 'EPUB_FILE_MISSING');
      }
      const mimeType = mimeTypes[archivePath];
      if (!mimeType || !allowedImageTypes.has(mimeType)) {
        throw new EpubParseError('EPUB_ENTRY_INVALID');
      }
      const stream = await zip.openReadStreamPromise(entry);
      let detectedMimeType: string | null = null;
      const media = await storage.put(validateImageStream(stream, (detected) => {
        detectedMimeType = detected;
      }), maxImageBytes);
      if (!detectedMimeType) {
        await storage.delete(media.key);
        throw new EpubParseError('EPUB_ENTRY_INVALID');
      }
      stored.set(archivePath, { ...media, mimeType: detectedMimeType });
    }
    return stored;
  } catch (error) {
    await Promise.all([...stored.values()].map((media) => storage.delete(media.key)));
    if (error instanceof EpubParseError) {
      throw error;
    }
    throw new EpubParseError('EPUB_ENTRY_INVALID');
  } finally {
    zip.close();
  }
}

function validateImageStream(source: Readable, onDetected: (mimeType: string) => void): Readable {
  let header = Buffer.alloc(0);
  let pending: Buffer[] = [];
  let validated = false;

  const detect = (): string | null => {
    if (header.length >= 8
      && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return 'image/png';
    }
    if (header.length >= 3
      && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return 'image/jpeg';
    }
    if (header.length >= 12
      && header.subarray(0, 4).toString('ascii') === 'RIFF'
      && header.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'image/webp';
    }
    return null;
  };

  const validator = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (validated) {
        callback(null, chunk);
        return;
      }
      pending.push(chunk);
      const needed = Math.max(0, 12 - header.length);
      if (needed > 0) {
        header = Buffer.concat([header, chunk.subarray(0, needed)]);
      }
      if (header.length < 12) {
        callback();
        return;
      }
      const detected = detect();
      if (!detected) {
        callback(new EpubParseError('EPUB_ENTRY_INVALID'));
        return;
      }
      onDetected(detected);
      validated = true;
      for (const part of pending) validator.push(part);
      pending = [];
      callback();
    },
    flush(callback) {
      if (!validated) {
        const detected = detect();
        if (!detected) {
          callback(new EpubParseError('EPUB_ENTRY_INVALID'));
          return;
        }
        onDetected(detected);
        for (const part of pending) validator.push(part);
        pending = [];
      }
      callback();
    },
  });
  // Keep the ZIP reader and validator in a pipeline so errors from either
  // stream are handled and propagated to the storage stream. A plain pipe can
  // leave an error unhandled and terminate the API process.
  const output = new PassThrough();
  pipeline(source, validator, output, () => undefined);
  return output;
}
async function parseArchive(
  zip: ZipFile,
  entries: Map<string, Entry>,
  limits: EpubLimits,
): Promise<ParsedEpub> {
  let parsedTextBytes = 0;
  const warnings: string[] = [];
  const readText = async (archivePath: string): Promise<string> => {
    const entry = entries.get(archivePath);
    if (!entry) {
      throw new EpubParseError('EPUB_FILE_MISSING');
    }
    const bytes = await readEntry(zip, entry, limits.maxEntryBytes);
    parsedTextBytes += bytes.length;
    if (parsedTextBytes > limits.maxTotalParsedTextBytes) {
      throw new EpubParseError('EPUB_CONTENT_TOO_LARGE');
    }
    return decodeText(bytes);
  };

  const containerXml = parseXml(await readText('META-INF/container.xml'));
  const container = findRecord(containerXml, 'container');
  const rootfiles = childRecord(container, 'rootfiles');
  const rootfile = asRecords(rootfiles?.rootfile)[0];
  const packagePath = resolveArchiveReference(
    attribute(rootfile, 'full-path'),
    '',
  );
  if (!packagePath || !entries.has(packagePath)) {
    throw new EpubParseError('EPUB_FILE_MISSING');
  }

  const packageXml = parseXml(await readText(packagePath));
  const packageRoot = findRecord(packageXml, 'package');
  const metadata = childRecord(packageRoot, 'metadata');
  const manifestRecord = childRecord(packageRoot, 'manifest');
  const spineRecord = childRecord(packageRoot, 'spine');
  const manifestItems = asRecords(manifestRecord?.item)
    .map((item) => toManifestItem(item, packagePath))
    .filter((item): item is ManifestItem => item !== null);
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
  const manifestByPath = new Map(manifestItems.map((item) => [item.path, item]));

  const spineReferences = asRecords(spineRecord?.itemref);
  const spineItems = spineReferences
    .map((reference) => manifestById.get(attribute(reference, 'idref')))
    .filter((item): item is ManifestItem => item !== undefined);
  if (spineItems.length === 0) {
    throw new EpubParseError('EPUB_NO_SPINE');
  }

  const tocItems = await readTableOfContents(
    entries,
    manifestItems,
    manifestById,
    spineRecord,
    readText,
    warnings,
  );
  const declaredCover = findCoverPath(metadata, manifestItems, manifestById);
  const guide = childRecord(packageRoot, 'guide');
  const guideCover = asRecords(guide?.reference).find((item) => attribute(item, 'type').toLowerCase() === 'cover');
  const guidePath = guideCover ? resolveArchiveReference(attribute(guideCover, 'href'), packagePath) : null;
  const candidates = [declaredCover, guidePath,
    ...manifestItems.filter((item) => /(?:^|[/_-])cover(?:[._-]|$)/iu.test(item.path) || /^cover/iu.test(item.id)).map((item) => item.path),
  ].filter((path): path is string => Boolean(path));
  let resolvedCoverPath: string | null = null;
  for (const candidate of candidates) {
    if (!entries.has(candidate)) continue;
    const kind = manifestByPath.get(candidate)?.mediaType ?? '';
    if (allowedImageTypes.has(kind)) { resolvedCoverPath = candidate; break; }
    if (['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(kind)) {
      const page = parseHtml(await readText(candidate)) as unknown as HtmlNode;
      for (const image of findHtmlNodes(page, (node) => tagName(node) === 'img' || tagName(node) === 'image')) {
        const src = attributeHtml(image, 'src') || attributeHtml(image, 'href') || attributeHtml(image, 'xlink:href');
        const path = src ? resolveArchiveReference(src, candidate) : null;
        if (path && entries.has(path) && allowedImageTypes.has(manifestByPath.get(path)?.mediaType ?? '')) {
          resolvedCoverPath = path; break;
        }
      }
      if (resolvedCoverPath) break;
    }
  }
  if (!resolvedCoverPath) {
    warnings.push('Không tìm thấy ảnh bìa JPEG, PNG hoặc WebP hợp lệ trong EPUB.');
  }

  const spineDocuments: SpineDocument[] = [];
  const metadataDocumentPaths = new Set<string>();
  let embeddedMetadata: EmbeddedStoryMetadata | null = null;
  for (const item of spineItems) {
    if (!['application/xhtml+xml', 'text/html'].includes(item.mediaType)) {
      continue;
    }
    const archiveEntry = entries.get(item.path);
    if (!archiveEntry) {
      warnings.push('Bỏ qua một mục nội dung không có trong tệp EPUB.');
      continue;
    }
    const xhtml = parseHtml(await readText(item.path)) as unknown as HtmlNode;
    const pageMetadata = extractEmbeddedStoryMetadata(xhtml, item.path);
    if (pageMetadata.isStoryPage) {
      metadataDocumentPaths.add(item.path);
      embeddedMetadata ??= pageMetadata;
      continue;
    }

    const blocks = extractReaderBlocks(xhtml, item.path, entries, manifestByPath, warnings);
    const content = textContent(blocks);
    if (!content && !blocks.some((block) => block.type === 'image')) {
      warnings.push('Bỏ qua một mục nội dung rỗng trong EPUB.');
      continue;
    }
    spineDocuments.push({
      path: item.path,
      manifestItem: item,
      parsedTitle: documentTitle(xhtml),
      blocks,
      content,
      wordCount: countWords(content),
    });
  }

  if (spineDocuments.length === 0) {
    throw new EpubParseError('EPUB_NO_READABLE_CHAPTERS');
  }

  const titleFromMetadata = embeddedMetadata?.title || xmlText(metadata, 'title');
  const creator = embeddedMetadata?.creator || xmlText(metadata, 'creator');
  const language = xmlText(metadata, 'language') || 'vi';
  const description = xmlText(metadata, 'description') || embeddedMetadata?.description || '';
  const publicationDate = parsePublicationDate(xmlText(metadata, 'date'));
  const genres = mergeGenres(
    embeddedMetadata?.genres ?? [],
    xmlTexts(metadata, 'subject').map((name) => ({ name, slug: null })),
  );  const title = titleFromMetadata || 'Chưa đặt tên';
  if (!titleFromMetadata) {
    warnings.push('EPUB chưa có tên truyện trong metadata.');
  }
  if (!creator) {
    warnings.push('EPUB chưa có tên tác giả trong metadata.');
  }
  if (!xmlText(metadata, 'language')) {
    warnings.push('EPUB chưa có ngôn ngữ trong metadata; tạm dùng tiếng Việt.');
  }

  const chaptersByPath = new Map(spineDocuments.map((chapter) => [chapter.path, chapter]));
  const usedPaths = new Set<string>();
  type VolumeDraft = { title: string; documents: Array<{ doc: SpineDocument; title: string }> };
  const volumeDrafts: VolumeDraft[] = [];
  let currentVolume: VolumeDraft | null = null;
  const newVolume = (titleValue = ''): VolumeDraft => {
    const volume = {
      title: titleValue.trim() || `Tập ${volumeDrafts.length + 1}`,
      documents: [],
    };
    volumeDrafts.push(volume);
    currentVolume = volume;
    return volume;
  };
  const defaultVolume = (): VolumeDraft => currentVolume ?? newVolume();
  const addDocument = (doc: SpineDocument, titleValue: string, target?: VolumeDraft): void => {
    if (usedPaths.has(doc.path)) {
      return;
    }
    usedPaths.add(doc.path);
    (target ?? defaultVolume()).documents.push({
      doc,
      title: titleValue || doc.parsedTitle,
    });
  };
  const readTocItems = (items: TocItem[], target?: VolumeDraft): void => {
    for (const item of items) {
      const doc = item.path ? chaptersByPath.get(item.path) : undefined;
      const linksToStoryMetadata = Boolean(item.path && metadataDocumentPaths.has(item.path));
      const isVolumeEntry = isVolumeTitle(item.title)
        && (item.children.length > 0 || linksToStoryMetadata || !doc);
      if (isVolumeEntry) {
        const volume = newVolume(item.title);
        readTocItems(item.children, volume);
        continue;
      }
      if (item.children.length > 0) {
        readTocItems(item.children, target ?? currentVolume ?? undefined);
        continue;
      }
      if (item.path && !linksToStoryMetadata && doc) {
        addDocument(doc, item.title, target);
      }
    }
  };
  readTocItems(tocItems);

  const fallbackVolume = volumeDrafts[0] ?? newVolume();
  for (const document of spineDocuments) {
    if (!usedPaths.has(document.path)) {
      addDocument(document, document.parsedTitle, fallbackVolume);
    }
  }

  let chapterOrder = 0;
  const volumes: ParsedVolume[] = volumeDrafts.map((draft, volumeIndex) => ({
    title: draft.title,
    order: volumeIndex + 1,
    chapters: draft.documents.map(({ doc, title: tocTitle }) => {
      chapterOrder += 1;
      const chapterTitle = tocTitle || doc.parsedTitle || `Chương ${chapterOrder}`;
      const blocks = withoutRepeatedChapterTitle(doc.blocks, chapterTitle);
      const content = textContent(blocks);
      return {
        title: chapterTitle,
        order: chapterOrder,
        sourcePaths: [doc.path],
        blocks,
        content,
        wordCount: countWords(content),
      };
    }),
  })).filter((volume) => volume.chapters.length > 0);

  return {
    metadata: {
      title,
      creator,
      language,
      description,
      publicationDate,
      genres,
    },
    coverPath: resolvedCoverPath,
    mediaTypes: Object.fromEntries(referencedPathsByType(manifestByPath, resolvedCoverPath, volumes)),
    volumes,
    warnings: [...new Set(warnings)],
  };
}
function referencedPathsByType(
  manifestByPath: Map<string, ManifestItem>,
  coverPath: string | null,
  volumes: ParsedVolume[],
): Array<[string, string]> {
  const paths = new Set<string>();
  if (coverPath) paths.add(coverPath);
  for (const volume of volumes) {
    for (const chapter of volume.chapters) {
      for (const block of chapter.blocks) {
        if (block.type === 'image') paths.add(block.archivePath);
      }
    }
  }
  return [...paths].flatMap((path) => {
    const mimeType = manifestByPath.get(path)?.mediaType;
    return mimeType ? [[path, mimeType] as [string, string]] : [];
  });
}
async function readTableOfContents(
  entries: Map<string, Entry>,
  manifestItems: ManifestItem[],
  manifestById: Map<string, ManifestItem>,
  spine: XmlRecord | null,
  readText: (archivePath: string) => Promise<string>,
  warnings: string[],
): Promise<TocItem[]> {
  const navItem = manifestItems.find((item) => item.properties.split(/\s+/u).includes('nav'));
  if (navItem && entries.has(navItem.path)) {
    return parseHtmlToc(await readText(navItem.path), navItem.path);
  }

  const ncxId = attribute(spine, 'toc');
  const ncxItem = ncxId ? manifestById.get(ncxId) : undefined;
  if (ncxItem && entries.has(ncxItem.path)) {
    return parseNcxToc(await readText(ncxItem.path), ncxItem.path);
  }

  warnings.push('EPUB không có mục lục hợp lệ; dùng thứ tự đọc trong spine.');
  return [];
}

function extractEmbeddedStoryMetadata(root: HtmlNode, contentPath: string): EmbeddedStoryMetadata {
  const titleLink = findHtmlNodes(root, (node) => {
    if (tagName(node) !== 'a') return false;
    const href = attributeHtml(node, 'href');
    return Boolean(href && resolveArchiveReference(href, contentPath) === contentPath);
  }).find((node) => htmlText(node).length > 0);
  const title = titleLink ? htmlText(titleLink) : '';

  const authorLabel = findHtmlNodes(root, (node) =>
    ['tac gia', 'author'].includes(normalizeMetadataLabel(htmlText(node))),
  ).find((node) => ['span', 'div', 'p'].includes(tagName(node)));
  const creator = authorLabel ? textAfterSibling(authorLabel) : '';

  const descriptionHeading = findHtmlNodes(root, (node) => /^h[1-6]$/u.test(tagName(node))
    && ['tom tat', 'gioi thieu', 'description', 'summary'].includes(normalizeMetadataLabel(htmlText(node))))[0];
  const description = descriptionHeading ? textAfterHeading(descriptionHeading) : '';

  const genres = findHtmlNodes(root, (node) => tagName(node) === 'a')
    .flatMap((node) => {
      const href = attributeHtml(node, 'href');
      const match = href.match(/\/(?:the-loai|genre|genres)\/([^/?#]+)/iu);
      const name = htmlText(node);
      if (!match || !name) return [];
      let slug = match[1];
      try { slug = decodeURIComponent(slug); } catch { /* Keep the safe raw slug. */ }
      return [{ name, slug: slug.toLowerCase() }];
    });
  const uniqueGenres = mergeGenres(genres);

  return {
    isStoryPage: Boolean(title && (creator || description || uniqueGenres.length > 0)),
    title,
    creator,
    description,
    genres: uniqueGenres,
  };
}

function textAfterSibling(node: HtmlNode): string {
  const siblings = node.parentNode?.childNodes ?? [];
  const index = siblings.indexOf(node);
  return siblings.slice(index + 1)
    .map(htmlText)
    .find((text) => text.trim().length > 0)
    ?.trim() ?? '';
}

function textAfterHeading(node: HtmlNode): string {
  const siblings = node.parentNode?.childNodes ?? [];
  const index = siblings.indexOf(node);
  for (const sibling of siblings.slice(index + 1)) {
    const siblingText = htmlText(sibling).trim();
    if (!siblingText) continue;
    const paragraphs = findHtmlNodes(sibling, (child) => tagName(child) === 'p')
      .map(htmlText)
      .map((text) => text.trim())
      .filter(Boolean);
    return paragraphs.length > 0 ? paragraphs.join('\n\n') : siblingText;
  }
  return '';
}

function normalizeMetadataLabel(value: string): string {
  return value.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('vi')
    .replace(/[：:]\s*$/u, '')
    .trim();
}

function normalizeGenreKey(value: string): string {
  return value.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function mergeGenres(...groups: Array<Array<{ name: string; slug: string | null }>>): Array<{ name: string; slug: string | null }> {
  const result: Array<{ name: string; slug: string | null }> = [];
  const seen = new Set<string>();
  for (const genre of groups.flat()) {
    const name = genre.name.trim();
    if (!name) continue;
    const slug = genre.slug?.trim().toLowerCase() || null;
    const key = normalizeGenreKey(slug || name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, slug });
  }
  return result;
}

function parsePublicationDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/u);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : null;
}

function isVolumeTitle(value: string): boolean {
  return /^(?:tập|tap|vol(?:ume)?\.?)\s*(?:#\s*)?(?:\d+|[ivxlcdm]+)\b/iu.test(value.trim());
}

function textContent(blocks: ParsedReaderBlock[]): string {
  return blocks
    .filter((block): block is Extract<ParsedReaderBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.runs.map((run) => run.text).join(''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function withoutRepeatedChapterTitle(blocks: ParsedReaderBlock[], title: string): ParsedReaderBlock[] {
  const first = blocks[0];
  if (first?.type !== 'text') return blocks;
  const firstText = first.runs.map((run) => run.text).join('').replace(/\s+/gu, ' ').trim();
  const normalizedTitle = title.replace(/\s+/gu, ' ').trim();
  return firstText.localeCompare(normalizedTitle, 'vi', { sensitivity: 'accent' }) === 0
    ? blocks.slice(1)
    : blocks;
}
function parseHtmlToc(markup: string, archivePath: string): TocItem[] {
  const root = parseHtml(markup) as unknown as HtmlNode;
  const navs = findHtmlNodes(root, (node) => tagName(node) === 'nav');
  const selected = navs.find((node) => {
    const type = attributeHtml(node, 'epub:type') || attributeHtml(node, 'type') || '';
    const role = attributeHtml(node, 'role') || '';
    return type.split(/\s+/u).includes('toc') || role === 'doc-toc';
  }) ?? navs[0];
  if (!selected) {
    return [];
  }
  const list = findHtmlNodes(selected, (node) => ['ol', 'ul'].includes(tagName(node)))[0];
  return list ? parseHtmlList(list, archivePath) : [];
}

function parseHtmlList(list: HtmlNode, archivePath: string): TocItem[] {
  const items: TocItem[] = [];
  for (const child of list.childNodes ?? []) {
    if (tagName(child) !== 'li') {
      continue;
    }
    const anchor = findHtmlNodes(child, (node) => tagName(node) === 'a')[0];
    const label = anchor ?? findHtmlNodes(child, (node) => tagName(node) === 'span')[0];
    const nestedList = (child.childNodes ?? []).find((node) => ['ol', 'ul'].includes(tagName(node)));
    const href = anchor ? attributeHtml(anchor, 'href') : '';
    const path = href ? resolveArchiveReference(href, archivePath) : null;
    const children = nestedList ? parseHtmlList(nestedList, archivePath) : [];
    items.push({ title: label ? htmlText(label) : '', path, children });
  }
  return items;
}

function parseNcxToc(markup: string, archivePath: string): TocItem[] {
  const root = findRecord(parseXml(markup), 'ncx');
  const navMap = childRecord(root, 'navMap');
  const parsePoints = (pointValue: unknown): TocItem[] => asRecords(pointValue).map((point) => {
    const navLabel = childRecord(point, 'navLabel');
    const content = childRecord(point, 'content');
    const src = attribute(content, 'src');
    const children = childRecord(point, 'navPoint');
    return {
      title: xmlText(navLabel, 'text'),
      path: src ? resolveArchiveReference(src, archivePath) : null,
      children: parsePoints(children),
    };
  });
  return parsePoints(navMap?.navPoint);
}

function extractReaderBlocks(
  root: HtmlNode,
  contentPath: string,
  entries: Map<string, Entry>,
  manifestByPath: Map<string, ManifestItem>,
  warnings: string[],
): ParsedReaderBlock[] {
  const output: ParsedReaderBlock[] = [];
  const chapterBody = findHtmlNodes(root, (node) => attributeHtml(node, 'id') === 'chapter-content')[0] ?? root;
  const visit = (node: HtmlNode): void => {
    const tag = tagName(node);
    if (tag === 'svg') {
      for (const image of findHtmlNodes(node, (entry) => tagName(entry) === 'image')) {
        appendImage(image, contentPath, entries, manifestByPath, output, warnings);
      }
      return;
    }
    if (ignoredHtmlTags.has(tag)) {
      return;
    }
    if (tag === 'img') {
      appendImage(node, contentPath, entries, manifestByPath, output, warnings);
      return;
    }
    if (tag === 'p' || /^h[1-6]$/u.test(tag) || tag === 'blockquote') {
      appendInlineBlocks(node, contentPath, entries, manifestByPath, output, warnings);
      return;
    }
    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };
  visit(chapterBody);
  return output;
}

function appendInlineBlocks(
  node: HtmlNode,
  contentPath: string,
  entries: Map<string, Entry>,
  manifestByPath: Map<string, ManifestItem>,
  output: ParsedReaderBlock[],
  warnings: string[],
): void {
  const kind: 'paragraph' | 'heading' | 'quote' = tagName(node) === 'blockquote'
    ? 'quote'
    : /^h[1-6]$/u.test(tagName(node)) ? 'heading' : 'paragraph';
  let runs: ReaderTextRun[] = [];
  const flush = (): void => {
    const normalized = normalizeRuns(runs);
    if (normalized.length > 0) {
      output.push({ type: 'text', kind, runs: normalized });
    }
    runs = [];
  };
  const readInline = (child: HtmlNode, bold: boolean, italic: boolean): void => {
    const tag = tagName(child);
    if (ignoredHtmlTags.has(tag)) {
      return;
    }
    if (tag === 'img') {
      flush();
      appendImage(child, contentPath, entries, manifestByPath, output, warnings);
      return;
    }
    if (child.nodeName === '#text') {
      const text = (child.value ?? '').replace(/\s+/gu, ' ');
      if (text) {
        runs.push({
          text,
          bold: bold || tag === 'b' || tag === 'strong',
          italic: italic || tag === 'i' || tag === 'em',
        });
      }
      return;
    }
    if (tag === 'br') {
      runs.push({ text: '\n', bold, italic });
      return;
    }
    const nextBold = bold || tag === 'b' || tag === 'strong';
    const nextItalic = italic || tag === 'i' || tag === 'em';
    for (const nested of child.childNodes ?? []) {
      readInline(nested, nextBold, nextItalic);
    }
  };
  for (const child of node.childNodes ?? []) {
    readInline(child, false, false);
  }
  flush();
}

function appendImage(
  node: HtmlNode,
  contentPath: string,
  entries: Map<string, Entry>,
  manifestByPath: Map<string, ManifestItem>,
  output: ParsedReaderBlock[],
  warnings: string[],
): void {
  const source = attributeHtml(node, 'src') || attributeHtml(node, 'href') || attributeHtml(node, 'xlink:href');
  const archivePath = source ? resolveArchiveReference(source, contentPath) : null;
  if (!archivePath) {
    warnings.push('Bỏ qua ảnh ngoài EPUB hoặc đường dẫn ảnh không hợp lệ.');
    return;
  }
  const manifestItem = manifestByPath.get(archivePath);
  if (!entries.has(archivePath) || !manifestItem
      || !allowedImageTypes.has(manifestItem.mediaType)) {
    warnings.push('Bỏ qua ảnh không có trong manifest hoặc không thuộc định dạng hỗ trợ.');
    return;
  }
  output.push({
    type: 'image',
    archivePath,
    altText: attributeHtml(node, 'alt')?.trim() ?? '',
    caption: findFigureCaption(node),
  });
}

function findFigureCaption(node: HtmlNode): string | null {
  let parent = node.parentNode;
  while (parent) {
    if (tagName(parent) === 'figure') {
      const caption = findHtmlNodes(parent, (child) => tagName(child) === 'figcaption')[0];
      const text = caption ? htmlText(caption) : '';
      return text || null;
    }
    parent = parent.parentNode;
  }
  return null;
}

function normalizeRuns(runs: ReaderTextRun[]): ReaderTextRun[] {
  const joined = runs.map((run) => ({ ...run, text: run.text.replace(/\s+/gu, ' ') }));
  while (joined.length > 0 && joined[0].text.trim() === '') {
    joined.shift();
  }
  while (joined.length > 0 && joined[joined.length - 1].text.trim() === '') {
    joined.pop();
  }
  const result: ReaderTextRun[] = [];
  for (const run of joined) {
    if (!run.text) {
      continue;
    }
    const previous = result[result.length - 1];
    if (previous && previous.bold === run.bold && previous.italic === run.italic) {
      previous.text += run.text;
    } else {
      result.push({ ...run });
    }
  }
  return result;
}

function documentTitle(root: HtmlNode): string {
  const chapterHeading = findHtmlNodes(root, (node) => tagName(node) === 'h4'
    && attributeHtml(node, 'class').split(/\s+/u).includes('title-item1'))[0];
  if (chapterHeading) return htmlText(chapterHeading);
  const titleNode = findHtmlNodes(root, (node) => tagName(node) === 'title')[0];
  const title = titleNode ? htmlText(titleNode) : '';
  if (title && !/^unknown$/iu.test(title)) return title;
  const chapterBody = findHtmlNodes(root, (node) => attributeHtml(node, 'id') === 'chapter-content')[0] ?? root;
  const heading = findHtmlNodes(chapterBody, (node) => /^h[1-6]$/u.test(tagName(node)))[0];
  return heading ? htmlText(heading) : title;
}

function htmlText(node: HtmlNode): string {
  if (node.nodeName === '#text') {
    return (node.value ?? '').replace(/\s+/gu, ' ');
  }
  return (node.childNodes ?? []).map(htmlText).join('').replace(/\s+/gu, ' ').trim();
}

function findHtmlNodes(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const found: HtmlNode[] = [];
  const visit = (node: HtmlNode): void => {
    if (predicate(node)) {
      found.push(node);
    }
    for (const child of node.childNodes ?? []) {
      visit(child);
    }
  };
  visit(root);
  return found;
}

function tagName(node: HtmlNode): string {
  return (node.tagName ?? node.nodeName ?? '').toLowerCase();
}

function attributeHtml(node: HtmlNode, name: string): string {
  const attribute = node.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return attribute?.value ?? '';
}

function toManifestItem(record: XmlRecord, packagePath: string): ManifestItem | null {
  const id = attribute(record, 'id');
  const href = attribute(record, 'href');
  const path = href ? resolveArchiveReference(href, packagePath) : null;
  if (!id || !path) {
    return null;
  }
  return {
    id,
    path,
    mediaType: attribute(record, 'media-type').toLowerCase().replace(/^image\/jpg$/u, 'image/jpeg'),
    properties: attribute(record, 'properties'),
  };
}

function findCoverPath(
  metadata: XmlRecord | null,
  manifestItems: ManifestItem[],
  manifestById: Map<string, ManifestItem>,
): string | null {
  const coverMeta = asRecords(metadata?.meta).find((item) => attribute(item, 'name') === 'cover');
  const byMetadata = coverMeta ? manifestById.get(attribute(coverMeta, 'content')) : undefined;
  const byProperties = manifestItems.find((item) =>
    item.properties.split(/\s+/u).includes('cover-image'));
  return byMetadata?.path ?? byProperties?.path ?? null;
}

function parseXml(markup: string): XmlRecord {
  if (/<!ENTITY\b/iu.test(markup)) {
    throw new EpubParseError('XML_UNSAFE');
  }
  const validation = XMLValidator.validate(markup);
  if (validation !== true) {
    throw new EpubParseError('XML_INVALID');
  }
  try {
    return asRecord(xmlParser.parse(markup));
  } catch {
    throw new EpubParseError('XML_INVALID');
  }
}

function decodeText(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  const prefix = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('latin1');
  const xmlEncoding = prefix.match(/encoding\s*=\s*["']([^"']+)["']/iu)?.[1];
  const htmlMetaTags = prefix.match(/<meta\b[^>]*>/giu) ?? [];
  const htmlEncoding = htmlMetaTags.flatMap((tag) => {
    const direct = tag.match(/\bcharset\s*=\s*["']?\s*([^\s"'/>;]+)/iu)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["'][^"']*?charset\s*=\s*([^\s;"']+)/iu)?.[1];
    return [direct, content].filter((value): value is string => Boolean(value));
  })[0];
  const declaredEncoding = xmlEncoding ?? htmlEncoding;
  if (declaredEncoding) {
    try {
      return new TextDecoder(declaredEncoding).decode(bytes);
    } catch {
      // Invalid or unsupported declarations fall back to UTF-8 validation.
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // A number of older EPUBs omit charset metadata while storing legacy Windows text.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
function resolveArchiveReference(reference: string, basePath: string): string | null {
  const trimmed = reference.trim();
  if (!trimmed || /^([a-z][a-z0-9+.-]*:|\/\/)/iu.test(trimmed)) {
    return null;
  }
  const pathPart = trimmed.split(/[?#]/u, 1)[0];
  if (!pathPart) {
    return basePath || null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) {
    return null;
  }
  const normalized = decoded.startsWith('/')
    ? posix.normalize(decoded.replace(/^\/+/, ''))
    : posix.normalize(posix.join(posix.dirname(basePath), decoded));
  if (!normalized || normalized === '.' || normalized === '..'
      || normalized.startsWith('../') || normalized.startsWith('/')) {
    return null;
  }
  return normalized;
}

function validateArchiveEntryPath(fileName: string): string {
  const isDirectory = fileName.endsWith('/');
  const path = isDirectory ? fileName.slice(0, -1) : fileName;
  if (!path || path.startsWith('/') || /^[a-z]:/iu.test(path)
      || path.includes('\\') || path.includes('\0')) {
    throw new EpubParseError('ZIP_PATH_INVALID');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new EpubParseError('ZIP_PATH_INVALID');
  }
  return path;
}

async function openZip(epubPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(epubPath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: false,
    }, (error, zip) => {
      if (error || !zip) {
        reject(new EpubParseError('EPUB_INVALID'));
        return;
      }
      resolve(zip);
    });
  });
}

async function inventoryEntries(
  zip: ZipFile,
  limits: EpubLimits,
): Promise<Map<string, Entry>> {
  if (zip.entryCount > limits.maxEntries) {
    throw new EpubParseError('ZIP_TOO_MANY_ENTRIES');
  }
  const entries = new Map<string, Entry>();
  const allNames = new Set<string>();
  let totalUncompressed = 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: EpubParseError): void => {
      if (settled) {
        return;
      }
      settled = true;
      zip.close();
      reject(error);
    };
    zip.once('error', (error: Error) => {
      fail(new EpubParseError(/path/iu.test(error.message)
        ? 'ZIP_PATH_INVALID'
        : 'EPUB_INVALID'));
    });
    zip.once('end', () => {
      if (!settled) {
        settled = true;
        resolve(entries);
      }
    });
    zip.on('entry', (entry: Entry) => {
      if (settled) {
        return;
      }
      try {
        if (entry.fileNameRaw.includes(0x5c)) {
          throw new EpubParseError('ZIP_PATH_INVALID');
        }
        const path = validateArchiveEntryPath(entry.fileName);
        if (allNames.has(path)) {
          throw new EpubParseError('ZIP_DUPLICATE_PATH');
        }
        allNames.add(path);
        if ((entry.generalPurposeBitFlag & 1) !== 0 || entry.isEncrypted()) {
          throw new EpubParseError('ZIP_ENCRYPTED');
        }
        if (!entry.canDecodeFileData()) {
          throw new EpubParseError('ZIP_UNSUPPORTED');
        }
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (unixMode === 0xa000) {
          throw new EpubParseError('ZIP_PATH_INVALID');
        }
        if (entry.uncompressedSize > limits.maxEntryBytes) {
          throw new EpubParseError('ZIP_ENTRY_TOO_LARGE');
        }
        totalUncompressed += entry.uncompressedSize;
        if (totalUncompressed > limits.maxTotalUncompressedBytes) {
          throw new EpubParseError('ZIP_EXPANSION_TOO_LARGE');
        }
        if (entry.uncompressedSize > 0
            && (entry.compressedSize === 0
              || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)) {
          throw new EpubParseError('ZIP_RATIO_TOO_HIGH');
        }
        if (!entry.fileName.endsWith('/')) {
          entries.set(path, entry);
        }
        zip.readEntry();
      } catch (error) {
        fail(error instanceof EpubParseError ? error : new EpubParseError('EPUB_INVALID'));
      }
    });
    zip.readEntry();
  });
}

async function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes) {
    throw new EpubParseError('ZIP_ENTRY_TOO_LARGE');
  }
  try {
    const stream = await zip.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maxBytes) {
        stream.destroy();
        throw new EpubParseError('ZIP_ENTRY_TOO_LARGE');
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof EpubParseError) {
      throw error;
    }
    throw new EpubParseError('EPUB_ENTRY_INVALID');
  }
}

function findRecord(record: XmlRecord, name: string): XmlRecord {
  return childRecord(record, name) ?? record;
}

function childRecord(record: XmlRecord | null, name: string): XmlRecord | null {
  if (!record) {
    return null;
  }
  const candidate = record[name];
  return candidate === undefined ? null : asRecord(Array.isArray(candidate) ? candidate[0] : candidate);
}

function asRecord(value: unknown): XmlRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as XmlRecord
    : {};
}

function asRecords(value: unknown): XmlRecord[] {
  if (value === undefined || value === null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map(asRecord);
}

function attribute(record: XmlRecord | null | undefined, name: string): string {
  const value = record?.[`@_${name}`];
  return typeof value === 'string' ? value.trim() : '';
}

function xmlText(record: XmlRecord | null, name: string): string {
  return xmlTexts(record, name)[0] ?? '';
}

function xmlTexts(record: XmlRecord | null, name: string): string[] {
  const value = record?.[name];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((candidate) => {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const text = String(candidate).trim();
      return text ? [text] : [];
    }
    const text = asRecord(candidate)['#text'];
    if (typeof text !== 'string' && typeof text !== 'number') return [];
    const normalized = String(text).trim();
    return normalized ? [normalized] : [];
  });
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}





