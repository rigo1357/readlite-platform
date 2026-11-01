export interface ReaderTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type ParsedReaderBlock =
  | {
      type: 'text';
      kind: 'paragraph' | 'heading' | 'quote';
      runs: ReaderTextRun[];
    }
  | {
      type: 'image';
      archivePath: string;
      altText: string;
      caption: string | null;
    };

export interface ParsedChapter {
  title: string;
  order: number;
  sourcePaths: string[];
  blocks: ParsedReaderBlock[];
  content: string;
  wordCount: number;
}

export interface ParsedVolume {
  title: string;
  order: number;
  chapters: ParsedChapter[];
}

export interface ParsedEpub {
  metadata: {
    title: string;
    creator: string;
    language: string;
    description: string;
    publicationDate: string | null;
    genres: Array<{ name: string; slug: string | null }>;
  };
  coverPath: string | null;
  mediaTypes: Record<string, string>;
  volumes: ParsedVolume[];
  warnings: string[];
}

