import type { SourceDocument } from '../types';

export interface HtmlMeta {
  /** Document id, usually the file path relative to the content root. */
  id: string;
  /** URL of the page. */
  url: string;
  /** Title to use when the page has neither `<title>` nor `<h1>`. */
  fallbackTitle?: string;
}

/** Elements whose content is never prose. */
const DROP_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'select',
  'button',
  'form',
  'nav',
  'aside',
  'footer',
  'dialog',
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  rarr: '→',
  larr: '←',
};

/** Decodes the HTML entities that occur in real pages: numeric ones and a common named set. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''));
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function innerOf(html: string, tag: string): string | undefined {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html)?.[1];
}

/**
 * Turns an HTML page into a {@link SourceDocument} whose content is Markdown-shaped text.
 *
 * It reads `<main>` if the page has one, then `<article>`, then `<body>`. Navigation, scripts,
 * styles, forms and other chrome are dropped. Headings become `#` lines and keep their `id`
 * attribute as the anchor; `<pre>` becomes a fenced code block. Pages with
 * `<meta name="robots" content="noindex">` return `null`.
 *
 * This is a tag stripper, not a DOM parser: it is fast and dependency-free, and it expects the
 * well-formed output of a static site generator rather than arbitrary HTML.
 */
export function fromHtml(source: string, meta: HtmlMeta): SourceDocument | null {
  const robots = /<meta\b[^>]*\bname\s*=\s*["']?robots["']?[^>]*>/i.exec(source)?.[0];
  if (robots && /noindex/i.test(attribute(robots, 'content') ?? '')) return null;

  const headTitle = innerOf(source, 'title');
  let html =
    innerOf(source, 'main') ?? innerOf(source, 'article') ?? innerOf(source, 'body') ?? source;
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_ELEMENTS) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  }

  // The first <h1> beats <title>, which usually carries a " | Site name" suffix.
  const firstH1 = innerOf(html, 'h1');
  const title =
    (firstH1 && stripTags(firstH1).replace(/\s+/g, ' ').trim()) ||
    (headTitle && stripTags(headTitle).replace(/\s+/g, ' ').trim()) ||
    meta.fallbackTitle ||
    meta.id;

  const content = htmlToText(html);
  return { id: meta.id, url: meta.url, title, content };
}

function htmlToText(html: string): string {
  // Code blocks are swapped out first so whitespace normalization never touches them.
  const blocks: string[] = [];
  const text = html
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => {
      const body = stripTags(code.replace(/<br\s*\/?>/gi, '\n')).replace(/^\n+|\s+$/g, '');
      blocks.push(`\`\`\`\n${body}\n\`\`\``);
      return `\n\n\uE000${String(blocks.length - 1)}\uE000\n\n`;
    })
    .replace(
      /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
      (_, level: string, attrs: string, inner: string) => {
        // Entities are decoded once, at the end, for everything outside code blocks.
        const heading = inner
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!heading) return '\n\n';
        const id = attribute(` ${attrs}`, 'id');
        return `\n\n${'#'.repeat(Number(level))} ${heading}${id ? ` {#${id}}` : ''}\n\n`;
      },
    )
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(
      /<\/(?:p|div|section|article|header|ul|ol|table|blockquote|dl|figure|details|summary)>/gi,
      '\n\n',
    )
    .replace(/<tr\b[^>]*>/gi, '\n| ')
    .replace(/<(?:p|div|section|br|dt|dd|hr|blockquote|figcaption)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(
      /<code\b[^>]*>([\s\S]*?)<\/code>/gi,
      (_, code: string) => `\`${code.replace(/<[^>]*>/g, '')}\``,
    );

  return decodeEntities(text.replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => blocks[Number(index)] ?? '');
}
