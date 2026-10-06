/**
 * The few pieces of Markdown structure ask-my-site needs (fenced code blocks, ATX headings and
 * inline code spans), shared by the loader, the chunker and the answer renderer so they always
 * agree.
 *
 * Everything here runs in linear time. These functions see arbitrary files at build time and
 * model output in the browser, so no regex in this module can backtrack on hostile input.
 */

/** A run of three or more backticks or tildes, indented at most three spaces. */
interface Fence {
  char: '`' | '~';
  length: number;
}

function leadingFence(line: string): (Fence & { rest: string }) | null {
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 32) i += 1;
  const char = line[i];
  if (char !== '`' && char !== '~') return null;
  let end = i;
  while (line[end] === char) end += 1;
  const length = end - i;
  if (length < 3) return null;
  return { char, length, rest: line.slice(end) };
}

export type FenceLine = 'prose' | 'open' | 'inside' | 'close';

/**
 * Classifies Markdown lines one at a time with respect to fenced code blocks, following
 * CommonMark: a backtick fence's info string cannot contain a backtick (so "```npm i x```" is
 * inline code, not a fence), and a closing fence uses the same character, at least as many
 * times, with nothing after it but spaces. An unclosed fence runs to the end of the input.
 */
export function createFenceScanner(): (line: string) => FenceLine {
  let open: Fence | null = null;
  return (line) => {
    const fence = leadingFence(line);
    if (open === null) {
      if (!fence || (fence.char === '`' && fence.rest.includes('`'))) return 'prose';
      open = { char: fence.char, length: fence.length };
      return 'open';
    }
    if (fence?.char === open.char && fence.length >= open.length && fence.rest.trim() === '') {
      open = null;
      return 'close';
    }
    return 'inside';
  };
}

/** True while a line opens, is inside, or closes a fenced code block. */
export function createFenceTracker(): (line: string) => boolean {
  const scan = createFenceScanner();
  return (line) => scan(line) !== 'prose';
}

export interface MarkdownSegment {
  /** True for a fenced code block, opening and closing fence lines included. */
  code: boolean;
  /** The segment's exact source. Joining every segment with "\n" restores the input. */
  text: string;
}

/** Splits Markdown into prose and fenced-code segments, losslessly. */
export function splitFenced(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const scan = createFenceScanner();
  let lines: string[] = [];
  let code = false;
  const flush = (): void => {
    if (lines.length > 0) segments.push({ code, text: lines.join('\n') });
    lines = [];
  };
  for (const line of markdown.split('\n')) {
    const state = scan(line);
    if (state === 'open') {
      flush();
      code = true;
      lines.push(line);
    } else if (state === 'close') {
      lines.push(line);
      flush();
      code = false;
    } else if (state === 'inside') {
      lines.push(line);
    } else {
      if (code) flush();
      code = false;
      lines.push(line);
    }
  }
  flush();
  return segments;
}

/** The body of a fenced code segment: the lines between its opening and closing fences. */
export function fenceBody(segment: string): string {
  const scan = createFenceScanner();
  return segment
    .split('\n')
    .filter((line) => scan(line) === 'inside')
    .join('\n');
}

/** Heading lines longer than this are treated as text: no real heading is this long. */
const MAX_HEADING_LENGTH = 1000;

/**
 * Parses an ATX heading line (`## Title`, `## Title ##`). Returns `null` for anything else,
 * including `#hashtag` (no space) and empty headings.
 *
 * A closing `#` sequence is only removed when whitespace precedes it, so `## C#` stays "C#".
 */
export function parseAtxHeading(line: string): { level: number; text: string } | null {
  if (line.length > MAX_HEADING_LENGTH) return null;
  let i = 0;
  while (i < 3 && line.charCodeAt(i) === 32) i += 1;
  let level = 0;
  while (line[i + level] === '#') level += 1;
  if (level === 0 || level > 6) return null;
  const after = line[i + level];
  if (after !== undefined && after !== ' ' && after !== '\t') return null;
  let text = line.slice(i + level).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t')) {
    text = text.slice(0, end).trimEnd();
  }
  return text ? { level, text } : null;
}

/**
 * Finds inline code spans: a run of N backticks closed by the next run of exactly N backticks.
 * Linear time, using a per-length cursor over the backtick runs.
 */
export function findCodeSpans(text: string): [start: number, end: number][] {
  const runs: { start: number; length: number }[] = [];
  for (let i = 0; i < text.length;) {
    if (text.charCodeAt(i) !== 96) {
      i += 1;
      continue;
    }
    const start = i;
    while (text.charCodeAt(i) === 96) i += 1;
    runs.push({ start, length: i - start });
  }
  const byLength = new Map<number, number[]>();
  runs.forEach((run, index) => {
    const list = byLength.get(run.length);
    if (list) list.push(index);
    else byLength.set(run.length, [index]);
  });
  const cursor = new Map<number, number>();
  const spans: [number, number][] = [];
  for (let r = 0; r < runs.length;) {
    const run = runs[r];
    if (!run) break;
    const list = byLength.get(run.length) ?? [];
    let position = cursor.get(run.length) ?? 0;
    while (position < list.length && (list[position] ?? 0) <= r) position += 1;
    cursor.set(run.length, position);
    const closing = list[position];
    if (closing === undefined) {
      r += 1;
      continue;
    }
    const end = runs[closing];
    if (end) spans.push([run.start, end.start + end.length]);
    r = closing + 1;
  }
  return spans;
}

/** Applies `transform` to the text outside inline code spans, leaving the spans untouched. */
export function mapOutsideCodeSpans(text: string, transform: (prose: string) => string): string {
  let out = '';
  let last = 0;
  for (const [start, end] of findCodeSpans(text)) {
    out += transform(text.slice(last, start)) + text.slice(start, end);
    last = end;
  }
  return out + transform(text.slice(last));
}
