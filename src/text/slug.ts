import GithubSlugger, { slug } from 'github-slugger';

import { findCodeSpans } from './markdown';

/**
 * GitHub-compatible heading slugs, so citation anchors match what most Markdown renderers emit
 * (github-slugger, rehype-slug, remark-slug, Docusaurus). The heading is rendered to the text a
 * reader sees, then slugged by github-slugger itself.
 */

const INLINE_MARKDOWN = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'], // images keep their alt text
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], // links keep their label
  [/<[^<>]+>/g, ''], // inline HTML
  [/~/g, ''], // strikethrough markers
] as const;

function stripInline(text: string): string {
  let out = text;
  for (const [pattern, replacement] of INLINE_MARKDOWN) out = out.replace(pattern, replacement);
  return out;
}

/** A run of `*` or `_`, which may open or close emphasis (CommonMark's delimiter run). */
interface Delimiter {
  char: string;
  /** Length of the run as written. */
  length: number;
  /** Characters not yet used as emphasis; these stay as literal text. */
  count: number;
  canOpen: boolean;
  canClose: boolean;
}

type Token = { text: string; first: string; last: string } | Delimiter;

const isDelimiter = (token: Token): token is Delimiter => 'char' in token;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const isSpace = (char: string | undefined): boolean => char === undefined || /^\s$/u.test(char);
const isPunctuation = (char: string | undefined): boolean =>
  char !== undefined && /^[\p{P}\p{S}]$/u.test(char);

function textToken(text: string, first = text, last = text): Token {
  return { text, first: Array.from(first)[0] ?? '', last: Array.from(last).at(-1) ?? '' };
}

/**
 * Heading Markdown as a reader sees it: code spans verbatim (minus the backticks), links and
 * images reduced to their text, inline HTML and `~` dropped, backslash escapes resolved, and `*`
 * and `_` removed only where they really are emphasis, by CommonMark's delimiter rules, so
 * `snake_case`, `foo_bar_` and `a * b` keep theirs. Whitespace is left as written.
 */
function renderHeading(markdown: string): string {
  const tokens: Token[] = [];
  const prose = (raw: string): void => {
    const text = stripInline(raw);
    let buffer = '';
    const flush = (): void => {
      if (buffer) tokens.push(textToken(buffer));
      buffer = '';
    };
    for (let i = 0; i < text.length;) {
      const char = text[i] ?? '';
      const next = text[i + 1] ?? '';
      if (char === '\\' && ASCII_PUNCTUATION.test(next)) {
        flush();
        tokens.push(textToken(next, '\\', next));
        i += 2;
      } else if (char === '*' || char === '_') {
        flush();
        let end = i;
        while (text[end] === char) end += 1;
        tokens.push({ char, length: end - i, count: end - i, canOpen: false, canClose: false });
        i = end;
      } else {
        buffer += char;
        i += 1;
      }
    }
    flush();
  };

  let last = 0;
  for (const [start, end] of findCodeSpans(markdown)) {
    prose(markdown.slice(last, start));
    const fence = /^`+/.exec(markdown.slice(start))?.[0].length ?? 0;
    let code = markdown.slice(start + fence, end - fence);
    if (/^ [\s\S]* $/.test(code) && code.trim()) code = code.slice(1, -1);
    // A code span borders its neighbours with a backtick: punctuation, for flanking.
    tokens.push(textToken(code, '`', '`'));
    last = end;
  }
  prose(markdown.slice(last));

  const delimiters = tokens.filter(isDelimiter);
  tokens.forEach((token, i) => {
    if (!isDelimiter(token)) return;
    const before = tokens[i - 1];
    const after = tokens[i + 1];
    const previous = before && (isDelimiter(before) ? before.char : before.last);
    const next = after && (isDelimiter(after) ? after.char : after.first);
    const left =
      !isSpace(next) && (!isPunctuation(next) || isSpace(previous) || isPunctuation(previous));
    const right =
      !isSpace(previous) && (!isPunctuation(previous) || isSpace(next) || isPunctuation(next));
    token.canOpen = token.char === '*' ? left : left && (!right || isPunctuation(previous));
    token.canClose = token.char === '*' ? right : right && (!left || isPunctuation(next));
  });
  matchEmphasis(delimiters);

  return tokens
    .map((token) => (isDelimiter(token) ? token.char.repeat(token.count) : token.text))
    .join('');
}

/**
 * CommonMark's "process emphasis": each closer takes the nearest compatible opener before it,
 * one or two characters at a time, and delimiters between a matched pair can no longer match.
 */
function matchEmphasis(stack: Delimiter[]): void {
  for (let c = 0; c < stack.length;) {
    const closer = stack[c];
    if (!closer?.canClose) {
      c += 1;
      continue;
    }
    let o = c - 1;
    for (; o >= 0; o -= 1) {
      const opener = stack[o];
      if (opener?.char !== closer.char || !opener.canOpen) continue;
      // The "rule of 3": a run that can both open and close does not pair across a multiple of 3.
      const sum = opener.length + closer.length;
      const oddMatch =
        (opener.canClose || closer.canOpen) &&
        sum % 3 === 0 &&
        (opener.length % 3 !== 0 || closer.length % 3 !== 0);
      if (!oddMatch) break;
    }
    const opener = stack[o];
    if (!opener) {
      if (closer.canOpen) c += 1;
      else stack.splice(c, 1);
      continue;
    }
    const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    opener.count -= used;
    closer.count -= used;
    stack.splice(o + 1, c - o - 1);
    c = o + 1;
    if (opener.count === 0) {
      stack.splice(o, 1);
      c -= 1;
    }
    if (closer.count === 0) stack.splice(c, 1);
  }
}

/** Heading text for display: rendered as {@link renderHeading}, whitespace collapsed. */
export function plainHeading(text: string): string {
  return renderHeading(text).replace(/\s+/g, ' ').trim();
}

/** Slugifies one heading. Prefer {@link createSlugger} for a whole page, which de-duplicates. */
export function slugify(text: string): string {
  return slug(renderHeading(text));
}

/**
 * Returns a slugger for one page: repeated headings get `-1`, `-2` suffixes, like GitHub.
 * It takes heading Markdown (`## Using \`useAsk\``), as written.
 *
 * Use the same function in your page renderer if you control it, so the anchors citations
 * point at always exist.
 */
export function createSlugger(): (text: string) => string {
  const slugger = new GithubSlugger();
  return (text) => slugger.slug(renderHeading(text));
}
