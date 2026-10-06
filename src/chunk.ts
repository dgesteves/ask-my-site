import { createSlugger, plainHeading } from './text/slug';
import type { Chunk, ChunkingOptions, SourceDocument } from './types';

export const DEFAULT_CHUNKING = { maxChars: 1200, overlap: 150 } as const;

/** Bumped whenever chunk boundaries change for the same input, which invalidates every index. */
export const CHUNKER_VERSION = 1;

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const EXPLICIT_ANCHOR = /[ \t]*\{#([\w-]+)\}[ \t]*$/;
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
const SENTENCE_END = /(?<=[.!?:;])\s+/;

/** Tracks fenced code blocks line by line. Returns true while `line` is inside (or opens) one. */
function createFenceTracker(): (line: string) => boolean {
  let fence: string | null = null;
  return (line) => {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line)?.[1];
      if (open) fence = open;
      return open !== undefined;
    }
    const close = FENCE_CLOSE.exec(line)?.[1];
    if (close !== undefined && close.startsWith(fence.charAt(0)) && close.length >= fence.length)
      fence = null;
    return true;
  };
}

interface Section {
  path: string[];
  anchor?: string;
  lines: string[];
}

interface Block {
  text: string;
  code: boolean;
}

export function resolveChunking(options: ChunkingOptions = {}): Required<ChunkingOptions> {
  const maxChars = options.maxChars ?? DEFAULT_CHUNKING.maxChars;
  const overlap = options.overlap ?? DEFAULT_CHUNKING.overlap;
  if (!Number.isInteger(maxChars) || maxChars < 200) {
    throw new RangeError(`chunking.maxChars must be an integer >= 200 (got ${String(maxChars)}).`);
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap > maxChars / 2) {
    throw new RangeError(
      `chunking.overlap must be an integer between 0 and maxChars / 2 (got ${String(overlap)}).`,
    );
  }
  return { maxChars, overlap };
}

/**
 * Splits a document into chunks along its heading structure.
 *
 * - A chunk never crosses a heading, so every chunk has one heading path and one anchor.
 * - Within a section, paragraphs are packed greedily up to `maxChars`. Paragraphs that are too
 *   long on their own are split by sentence, then by word. Fenced code blocks are split by line,
 *   never mid-line.
 * - Consecutive chunks of the same section share up to `overlap` characters of context, cut at a
 *   sentence or word boundary.
 * - Headings inside fenced code blocks are content, not structure.
 */
export function chunkDocument(document: SourceDocument, options?: ChunkingOptions): Chunk[] {
  const { maxChars, overlap } = resolveChunking(options);
  const chunks: Chunk[] = [];
  for (const section of splitSections(document)) {
    const heading = section.path.join(' › ');
    for (const text of packSection(section.lines, maxChars, overlap)) {
      chunks.push({
        id: `${document.id}#${chunks.length}`,
        documentId: document.id,
        url: document.url,
        title: document.title,
        heading,
        ...(section.anchor ? { anchor: section.anchor } : {}),
        text,
      });
    }
  }
  return chunks;
}

/** The text a chunk is embedded and keyword-indexed as: where it sits, then what it says. */
export function chunkSearchText(chunk: Pick<Chunk, 'title' | 'heading' | 'text'>): string {
  const location = chunk.heading ? `${chunk.title} › ${chunk.heading}` : chunk.title;
  return `${location}\n\n${chunk.text}`;
}

function splitSections(document: SourceDocument): Section[] {
  const slug = createSlugger();
  const title = document.title.trim().toLowerCase();
  const stack: { level: number; text: string; anchor: string }[] = [];
  const sections: Section[] = [{ path: [], lines: [] }];
  const inFence = createFenceTracker();

  for (const line of document.content.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = inFence(line) ? null : HEADING.exec(line);
    if (!heading?.[1] || !heading[2]) {
      sections.at(-1)?.lines.push(line);
      continue;
    }

    const level = heading[1].length;
    const explicit = EXPLICIT_ANCHOR.exec(heading[2]);
    const text = plainHeading(explicit ? heading[2].slice(0, explicit.index) : heading[2]);
    const anchor = explicit?.[1] ?? slug(text);
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
    // A level-one heading that repeats the page title adds nothing to a citation.
    if (!(level === 1 && text.toLowerCase() === title)) stack.push({ level, text, anchor });
    sections.push({
      path: stack.map((entry) => entry.text),
      ...(stack.length > 0 ? { anchor: stack.at(-1)?.anchor } : {}),
      lines: [],
    });
  }
  return sections;
}

function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const inFence = createFenceTracker();
  let current: string[] = [];
  let code = false;

  const flush = (): void => {
    const text = code ? current.join('\n') : current.join('\n').trim();
    if (text.trim()) blocks.push({ text, code });
    current = [];
  };

  for (const line of lines) {
    const fenced = inFence(line);
    if (fenced !== code) {
      // Entering a fence: close the paragraph. Leaving one: the closing line already belongs to
      // the code block, so close that instead.
      if (fenced) {
        flush();
        code = true;
        current.push(line);
      } else {
        flush();
        code = false;
        if (line.trim()) current.push(line);
      }
      continue;
    }
    if (!code && line.trim() === '') flush();
    else current.push(line);
  }
  // An unterminated fence is still code.
  flush();
  return blocks;
}

function packSection(lines: string[], maxChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const block of toBlocks(lines)) {
    const pieces = block.text.length > maxChars ? splitBlock(block, maxChars) : [block.text];
    for (const piece of pieces) {
      if (current && current.length + 2 + piece.length <= maxChars) {
        current = `${current}\n\n${piece}`;
        continue;
      }
      const previous = current || chunks.at(-1) || '';
      flush();
      const tail = overlapTail(previous, Math.min(overlap, maxChars - piece.length - 2));
      current = tail ? `${tail}\n\n${piece}` : piece;
    }
  }
  flush();
  return chunks;
}

/** Splits an oversized block by line (lists, tables, code), then by sentence, then by word. */
function splitBlock(block: Block, maxChars: number): string[] {
  const units = block.text.split('\n').flatMap((line) => {
    if (line.length <= maxChars) return [line];
    if (block.code) return splitWords(line, maxChars);
    return pack(
      line.split(SENTENCE_END).flatMap((s) => splitWords(s, maxChars)),
      ' ',
      maxChars,
    );
  });
  return pack(units, '\n', maxChars).filter((piece) => piece.trim());
}

/** Greedily joins units with `separator` into pieces no longer than `maxChars`. */
function pack(units: string[], separator: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current: string | null = null;
  for (const unit of units) {
    if (current !== null && current.length + separator.length + unit.length > maxChars) {
      pieces.push(current);
      current = unit;
    } else {
      current = current === null ? unit : `${current}${separator}${unit}`;
    }
  }
  if (current !== null) pieces.push(current);
  return pieces;
}

function splitWords(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    // A single "word" longer than a chunk (a minified line, a data URI) is cut hard.
    for (let start = 0; start < word.length; start += maxChars) {
      const part = word.slice(start, start + maxChars);
      if (current && current.length + 1 + part.length > maxChars) {
        pieces.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** The last `size` characters of `text`, starting at a sentence boundary if one fits. */
function overlapTail(text: string, size: number): string {
  if (size <= 0 || !text) return '';
  if (text.length <= size) return text;
  const window = text.slice(-size);
  const sentence = /[.!?]\s+(?=\S)/.exec(window);
  if (sentence) return window.slice(sentence.index + sentence[0].length);
  const space = window.search(/\s/);
  return space === -1 ? '' : window.slice(space + 1);
}
