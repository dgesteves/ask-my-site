import { describe, expect, it } from 'vitest';

import { chunkDocument, chunkSearchText, createSlugger, slugify } from '../src';
import type { SourceDocument } from '../src';

const doc = (content: string, title = 'Guide'): SourceDocument => ({
  id: 'guide.md',
  url: '/guide',
  title,
  content,
});

const sentence = (n: number): string =>
  `Sentence number ${String(n)} explains one more detail about the system in plain words.`;

describe('chunkDocument', () => {
  it('splits on headings and records the heading path and anchor', () => {
    const chunks = chunkDocument(
      doc(`Intro paragraph.

## Install

Run the installer.

### With pnpm

Use pnpm add.

## Configure

Set the options.`),
    );

    expect(chunks.map((c) => [c.heading, c.anchor, c.text])).toEqual([
      ['', undefined, 'Intro paragraph.'],
      ['Install', 'install', 'Run the installer.'],
      ['Install › With pnpm', 'with-pnpm', 'Use pnpm add.'],
      ['Configure', 'configure', 'Set the options.'],
    ]);
    expect(chunks.map((c) => c.id)).toEqual([
      'guide.md#0',
      'guide.md#1',
      'guide.md#2',
      'guide.md#3',
    ]);
  });

  it('drops a level-one heading that repeats the title, and headings without a body', () => {
    const chunks = chunkDocument(doc('# Guide\n\nWelcome.\n\n## Empty\n\n## Full\n\nBody.'));
    expect(chunks.map((c) => c.heading)).toEqual(['', 'Full']);
    expect(chunks[0]?.anchor).toBeUndefined();
  });

  it('honours explicit {#id} anchors and de-duplicates repeated headings like GitHub', () => {
    const chunks = chunkDocument(
      doc('## Usage {#custom}\n\nA.\n\n## Example\n\nB.\n\n## Example\n\nC.'),
    );
    expect(chunks.map((c) => c.anchor)).toEqual(['custom', 'example', 'example-1']);
  });

  it('ignores headings inside fenced code blocks and never splits a fence mid-line', () => {
    const code = ['```md', '# not a heading', '## also not', '```'].join('\n');
    const chunks = chunkDocument(doc(`## Real\n\nText before.\n\n${code}\n\nText after.`));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe('Real');
    expect(chunks[0]?.text).toContain('# not a heading');
  });

  it('keeps every chunk within maxChars and overlaps consecutive chunks', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => sentence(i)).join('\n\n');
    const chunks = chunkDocument(doc(`## Long\n\n${paragraphs}`), { maxChars: 400, overlap: 100 });

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(400);
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1]!.text;
      const lead = chunks[i]!.text.split('\n\n')[0]!;
      // The new chunk opens with text the previous one ended with.
      expect(previous.endsWith(lead)).toBe(true);
    }
    // Every sentence survives chunking.
    const all = chunks.map((c) => c.text).join('\n');
    for (let i = 0; i < 30; i += 1) expect(all).toContain(sentence(i));
  });

  it('splits an oversized paragraph by sentence, an oversized list by item', () => {
    const paragraph = Array.from({ length: 20 }, (_, i) => sentence(i)).join(' ');
    const list = Array.from(
      { length: 20 },
      (_, i) => `- item ${String(i)} ${'word '.repeat(8)}`,
    ).join('\n');
    const chunks = chunkDocument(doc(`${paragraph}\n\n${list}`), { maxChars: 300, overlap: 0 });

    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(300);
    // Sentences are not cut in half.
    for (const chunk of chunks.filter((c) => c.text.startsWith('Sentence'))) {
      expect(chunk.text).toMatch(/\.$/);
    }
    // List items keep their own lines.
    const listChunk = chunks.find((c) => c.text.startsWith('- item'));
    expect(listChunk?.text.split('\n').every((line) => line.startsWith('- item'))).toBe(true);
  });

  it('does not overlap across sections', () => {
    const body = Array.from({ length: 10 }, (_, i) => sentence(i)).join('\n\n');
    const chunks = chunkDocument(doc(`## A\n\n${body}\n\n## B\n\nFresh start.`), {
      maxChars: 300,
      overlap: 120,
    });
    expect(chunks.at(-1)?.text).toBe('Fresh start.');
  });

  it('is deterministic and rejects invalid options', () => {
    const input = doc('## A\n\nText.');
    expect(chunkDocument(input)).toEqual(chunkDocument(input));
    expect(() => chunkDocument(input, { maxChars: 50 })).toThrow(RangeError);
    expect(() => chunkDocument(input, { maxChars: 400, overlap: 300 })).toThrow(RangeError);
  });

  it('prefixes the search text with where the chunk sits', () => {
    expect(chunkSearchText({ title: 'Guide', heading: 'Install › pnpm', text: 'Body' })).toBe(
      'Guide › Install › pnpm\n\nBody',
    );
    expect(chunkSearchText({ title: 'Guide', heading: '', text: 'Body' })).toBe('Guide\n\nBody');
  });
});

describe('slugs', () => {
  it('matches github-slugger for common headings', () => {
    expect(slugify('Getting Started')).toBe('getting-started');
    expect(slugify('`createAskHandler()` options')).toBe('createaskhandler-options');
    expect(slugify('What is RRF? (and why)')).toBe('what-is-rrf-and-why');
    expect(slugify('[Link](https://x.y) text')).toBe('link-text');
    expect(slugify('Ünïcödé headings')).toBe('ünïcödé-headings');
  });

  it('suffixes duplicates', () => {
    const slug = createSlugger();
    expect([slug('A'), slug('A'), slug('A'), slug('A-1')]).toEqual(['a', 'a-1', 'a-2', 'a-1-1']);
  });
});
