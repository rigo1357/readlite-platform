import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapReaderBlocks } from '../src/routes/catalog.ts';

test('reader text blocks preserve supported formatting runs', () => {
  const blocks = mapReaderBlocks([{
    type: 'text',
    kind: 'quote',
    runs: [
      { text: 'Xin chào', bold: true, italic: false },
      { text: ' thế giới', bold: false, italic: true },
    ],
  }]);

  assert.deepEqual(blocks, [{
    type: 'text',
    kind: 'quote',
    runs: [
      { text: 'Xin chào', bold: true, italic: false },
      { text: ' thế giới', bold: false, italic: true },
    ],
  }]);
});

test('reader image blocks get internal URLs and reject unsafe IDs or malformed blocks', () => {
  const blocks = mapReaderBlocks([
    {
      type: 'image',
      mediaId: '42abbdac-0bf3-4265-a183-b53f75475ad8',
      altText: 'Bản đồ',
      caption: 'Tập một',
      archivePath: 'ignored-internal-field',
    },
    { type: 'image', mediaId: 'https://outside.test/image.png' },
    { type: 'script', text: 'ignored' },
  ]);

  assert.deepEqual(blocks, [{
    type: 'image',
    mediaId: '42abbdac-0bf3-4265-a183-b53f75475ad8',
    url: '/api/v1/media/42abbdac-0bf3-4265-a183-b53f75475ad8',
    altText: 'Bản đồ',
    caption: 'Tập một',
  }]);
});
