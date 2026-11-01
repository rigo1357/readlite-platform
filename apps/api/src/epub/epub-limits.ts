export interface EpubLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalUncompressedBytes: number;
  maxTotalParsedTextBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_EPUB_LIMITS: Readonly<EpubLimits> = Object.freeze({
  maxArchiveBytes: 100 * 1024 * 1024,
  maxEntries: 5_000,
  maxEntryBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 500 * 1024 * 1024,
  maxTotalParsedTextBytes: 100 * 1024 * 1024,
  maxCompressionRatio: 1_000,
});
