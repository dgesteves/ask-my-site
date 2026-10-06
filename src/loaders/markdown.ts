import { parse as parseYaml } from 'yaml';

import { mapOutsideCodeSpans, parseAtxHeading, splitFenced } from '../text/markdown';
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

  const segments = splitFenced(body.replace(/\r\n?/g, '\n'));
  const content = segments
    .map((segment) => (segment.code ? segment.text : cleanProse(segment.text, meta.mdx ?? false)))
    .join('\n')
    .trim();
  const title =
    stringField(data.title) ?? firstH1(splitFenced(content)) ?? meta.fallbackTitle ?? meta.id;
  const url = stringField(data.url) ?? stringField(data.permalink) ?? meta.url;

  return { id: meta.id, url, title, content };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The text of the first `# Heading` outside code blocks. */
function firstH1(segments: ReturnType<typeof splitFenced>): string | undefined {
  for (const segment of segments) {
    if (segment.code) continue;
    for (const line of segment.text.split('\n')) {
      const heading = parseAtxHeading(line);
      if (heading?.level === 1) return plainHeading(heading.text) || undefined;
    }
  }
  return undefined;
}

function cleanProse(prose: string, mdx: boolean): string {
  return mapOutsideCodeSpans(prose.replace(/<!--[\s\S]*?-->/g, ''), (text) =>
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
