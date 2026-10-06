import { findCodeSpans } from './markdown';

/**
 * GitHub-compatible heading slugs, so citation anchors match what most Markdown renderers emit
 * (github-slugger, rehype-slug, remark-slug, Docusaurus, VitePress).
 */

const INLINE_MARKDOWN = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'], // images keep their alt text
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], // links keep their label
  [/<[^<>]+>/g, ''], // inline HTML
  [/[*~]/g, ''], // emphasis and strikethrough markers
  // Underscores are emphasis only at word edges; `max_tokens` and `snake_case` keep theirs.
  [/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, ''],
] as const;

function stripInline(text: string): string {
  let out = text;
  for (const [pattern, replacement] of INLINE_MARKDOWN) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Heading text as a reader sees it: inline Markdown removed, code spans kept verbatim (minus the
 * backticks), whitespace collapsed. GitHub slugs the rendered text, so this is what it slugs too.
 */
export function plainHeading(text: string): string {
  let out = '';
  let last = 0;
  for (const [start, end] of findCodeSpans(text)) {
    out += stripInline(text.slice(last, start)) + text.slice(start, end).replace(/^`+|`+$/g, '');
    last = end;
  }
  out += stripInline(text.slice(last));
  return out.replace(/\s+/g, ' ').trim();
}

/** Slugifies one heading. Prefer {@link createSlugger} for a whole page, which de-duplicates. */
export function slugify(text: string): string {
  return plainHeading(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Returns a slugger for one page: repeated headings get `-1`, `-2` suffixes, like GitHub.
 *
 * Export the same function to your page renderer if you control it, so the anchors citations
 * point at always exist.
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    let slug = base;
    let count = seen.get(base) ?? 0;
    while (seen.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    seen.set(base, count);
    seen.set(slug, 0);
    return slug;
  };
}
