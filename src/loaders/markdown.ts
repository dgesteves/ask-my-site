import { parse as parseYaml } from 'yaml';

import { plainHeading } from '../text/slug';
import type { SourceDocument } from '../types';

export interface MarkdownMeta {
  /** Document id, usually the file path relative to the content root. */
  id: string;
  /** URL to use when the frontmatter has no `url` or `permalink`. */
  url: string;
  /** Title to use when there is neither a frontmatter `title` nor a leading `# Heading`. */
  fallbackTitle?: string;
  /** Treat the source as MDX: drop `import`/`export` lines and unwrap JSX elements. */
  mdx?: boolean;
}

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FENCED_BLOCK =
  /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2?\3[`~]*[ \t]*(?=\n|$)|$)/g;
const FIRST_H1 = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m;
const INLINE_CODE = /(`+)(?:(?!\1)[\s\S])+?\1/g;

/** Splits YAML frontmatter from the body. A document without frontmatter has empty `data`. */
export function parseFrontmatter(source: string): Frontmatter {
  const match = FRONTMATTER.exec(source);
  if (!match) return { data: {}, body: source.replace(/^\uFEFF/, '') };
  const parsed: unknown = parseYaml(match[1] ?? '');
  const data =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, body: source.slice(match[0].length) };
}

/**
 * Turns a Markdown or MDX source into a {@link SourceDocument}.
 *
 * Frontmatter keys it reads: `title`, `url` (or `permalink`), and `draft: true`, `ask: false` or
 * `noindex: true` to leave the page out (the function then returns `null`).
 *
 * MDX support is text extraction, not evaluation: imports, exports and JSX comments are dropped,
 * JSX tags are removed and their children kept. Fenced code blocks are left exactly as written.
 */
export function fromMarkdown(source: string, meta: MarkdownMeta): SourceDocument | null {
  const { data, body } = parseFrontmatter(source);
  if (data.draft === true || data.ask === false || data.noindex === true) return null;

  const content = mapProse(body, (prose) => cleanProse(prose, meta.mdx ?? false)).trim();
  const h1 = FIRST_H1.exec(content.replace(FENCED_BLOCK, '$1'));
  const title =
    stringField(data.title) ??
    (h1?.[1] ? plainHeading(h1[1]) : undefined) ??
    meta.fallbackTitle ??
    meta.id;
  const url = stringField(data.url) ?? stringField(data.permalink) ?? meta.url;

  return { id: meta.id, url, title, content };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Applies `transform` to everything outside fenced code blocks. */
function mapProse(markdown: string, transform: (prose: string) => string): string {
  let out = '';
  let last = 0;
  for (const match of markdown.matchAll(FENCED_BLOCK)) {
    const start = match.index + (match[1]?.length ?? 0);
    const end = match.index + match[0].length;
    out += transform(markdown.slice(last, start)) + markdown.slice(start, end);
    last = end;
  }
  return out + transform(markdown.slice(last));
}

/** Applies `transform` to everything outside inline code spans. */
function mapOutsideInlineCode(text: string, transform: (prose: string) => string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    out += transform(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + transform(text.slice(last));
}

function cleanProse(prose: string, mdx: boolean): string {
  return mapOutsideInlineCode(prose.replace(/<!--[\s\S]*?-->/g, ''), (text) =>
    cleanText(text, mdx),
  ).replace(/\n{3,}/g, '\n\n');
}

function cleanText(input: string, mdx: boolean): string {
  let text = input;
  if (mdx) {
    text = text
      .replace(/^(?:import|export)\s[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*$/gm, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/<\/?[A-Z][\w.]*(?:\s(?:[^<>{}]|\{[^{}]*\})*)?\/?>/g, '');
  }
  return text
    .replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm, '');
}
