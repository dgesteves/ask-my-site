import { removeDelimited } from '../text/markdown';
import type { SourceDocument } from '../types';

export interface HtmlMeta {
  /** Document id, usually the file path relative to the content root. */
  id: string;
  /** URL of the page. */
  url: string;
  /** Title to use when the page has neither `<title>` nor `<h1>`. */
  fallbackTitle?: string;
  /**
   * The element that holds the page's own content. Default `main`, then `article`, then `body`.
   *
   * `article` reads the outermost `<article>` elements first, without the articles nested in them
   * (cards, teasers), and suits sites whose `<main>` also holds a table of contents or
   * pagination. In a Docusaurus page it reads the doc's or blog post's Markdown container, so
   * breadcrumbs, the version badge and a post's date and authors are left out too; the title
   * still comes from the page's `<h1>`.
   */
  root?: 'main' | 'article';
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

/** After a tag name: the name has ended (so `<nav` does not match the custom element `<nav-link>`). */
const NAME_END = '(?=[\\s/>])';

const BASIC_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  trade: '™',
  rarr: '→',
  larr: '←',
  euro: '€',
  // Invisible characters SSGs put in heading permalinks; they carry no text.
  ZeroWidthSpace: '',
  zwj: '',
  zwnj: '',
  lrm: '',
  rlm: '',
};

// Named entities for U+00A0 to U+00FF, in code point order.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn ' +
  'sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave ' +
  'Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN ' +
  'szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute ' +
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml ' +
  'yacute thorn yuml';

const NAMED_ENTITIES = new Map<string, string>([
  ...LATIN1.split(' ').map((name, i): [string, string] => [name, String.fromCharCode(0xa0 + i)]),
  ...Object.entries(BASIC_ENTITIES),
]);

/**
 * Decodes numeric entities, the Latin-1 named set, and the typographic and invisible entities
 * static site generators emit. Names are case-sensitive (`&Eacute;` is not `&eacute;`), with a
 * case-insensitive fallback for legacy forms like `&AMP;`.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][\da-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z\d]{1,31});/g,
    (match, entity: string) => {
      if (entity.startsWith('#')) {
        const hex = entity[1] === 'x' || entity[1] === 'X';
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES.get(entity) ?? BASIC_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^<>]*>/g, ''));
}

/** The value of attribute `name` in the opening tag `tag`, quoted or not. */
export function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

interface Element {
  /** The opening tag's match, with its capture groups. */
  open: RegExpExecArray;
  /** Where the opening tag starts and where the closing tag ends. */
  start: number;
  end: number;
  inner: string;
}

/**
 * The elements in `html`, left to right: an opening tag matched by `open` (a global, case
 * insensitive pattern), up to the first closing tag `close(match)` after it. The same matches as
 * `/<tag …>([\s\S]*?)<\/tag>/gi`, in linear time: once a closing tag is missing after some
 * point it is missing after every later point too, so it is never searched for again (the regex
 * searches again from every opening tag, which is quadratic).
 */
function* elements(
  html: string,
  open: RegExp,
  close: (match: RegExpExecArray) => string,
): Generator<Element> {
  const pattern = new RegExp(open);
  const closers = new Map<string, RegExp>();
  const missingFrom = new Map<string, number>();
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const tag = close(match);
    const innerStart = match.index + match[0].length;
    if (innerStart >= (missingFrom.get(tag) ?? Number.POSITIVE_INFINITY)) continue;
    let closer = closers.get(tag);
    if (!closer) {
      closer = new RegExp(tag, 'gi');
      closers.set(tag, closer);
    }
    closer.lastIndex = innerStart;
    const end = closer.exec(html);
    if (!end) {
      missingFrom.set(tag, innerStart);
      continue;
    }
    pattern.lastIndex = end.index + end[0].length;
    yield {
      open: match,
      start: match.index,
      end: pattern.lastIndex,
      inner: html.slice(innerStart, end.index),
    };
  }
}

/**
 * The outermost `tag` elements in `html`, left to right, each up to its own closing tag, so an
 * element of the same name nested inside does not end it (`elements` stops at the first closing
 * tag). One that is never closed ends at the first closing tag after it, as `elements` reads it.
 * Linear: the tags are found in one scan and paired with a stack.
 */
function* outermost(html: string, tag: string): Generator<Element> {
  const pattern = new RegExp(`<(/?)${tag}${NAME_END}[^<>]*>`, 'gi');
  const tags: { match: RegExpExecArray; close: boolean; end: number }[] = [];
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    tags.push({ match, close: match[1] === '/', end: pattern.lastIndex });
  }
  // closer[i]: the closing tag that pairs with opening tag i, else the first one after it.
  const closer: (number | undefined)[] = [];
  const unclosed: number[] = [];
  tags.forEach(({ close }, i) => {
    if (!close) {
      unclosed.push(i);
      return;
    }
    const opened = unclosed.pop();
    if (opened !== undefined) closer[opened] = i;
  });
  let next: number | undefined;
  for (let i = tags.length - 1; i >= 0; i--) {
    if (tags[i]?.close) next = i;
    else closer[i] ??= next;
  }
  for (let i = 0; i < tags.length; i++) {
    const open = tags[i];
    if (!open || open.close) continue;
    const j = closer[i];
    const close = j === undefined ? undefined : tags[j];
    // No closing tag after this one, so none after any later one either.
    if (j === undefined || !close) return;
    yield {
      open: open.match,
      start: open.match.index,
      end: close.end,
      inner: html.slice(open.end, close.match.index),
    };
    i = j;
  }
}

/** `html` with each of `found` (left to right, not overlapping) replaced by `replace(element)`. */
function replaceEach(
  html: string,
  found: Iterable<Element>,
  replace: (element: Element) => string,
): string {
  let out = '';
  let last = 0;
  for (const element of found) {
    out += html.slice(last, element.start) + replace(element);
    last = element.end;
  }
  return out + html.slice(last);
}

/** `html` with each element `elements` finds replaced by `replace(element)`. */
function replaceElements(
  html: string,
  open: RegExp,
  close: (match: RegExpExecArray) => string,
  replace: (element: Element) => string,
): string {
  return replaceEach(html, elements(html, open, close), replace);
}

const openTag = (tag: string): RegExp => new RegExp(`<${tag}${NAME_END}[^<>]*>`, 'gi');

function innerOf(html: string, tag: string): string | undefined {
  for (const element of outermost(html, tag)) return element.inner;
  return undefined;
}

function innerOfAll(html: string, tag: string): string[] {
  return Array.from(outermost(html, tag), (element) => element.inner);
}

/**
 * Where Docusaurus renders a page's Markdown: a doc's `theme-doc-markdown` container, or a blog
 * post's `__blog-post-container` (the element Docusaurus's own feeds read), without the
 * breadcrumbs, version badge, mobile table of contents, or a post's date and authors around it.
 */
function docusaurusMarkdown(html: string): string | undefined {
  if (!html.includes('theme-doc-markdown') && !html.includes('__blog-post-container')) {
    return undefined;
  }
  const pattern = /<([a-z][a-z\d-]*)(?=[\s/>])[^<>]*>/gi;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    const tag = match[0];
    if (
      attribute(tag, 'class')?.split(/\s+/).includes('theme-doc-markdown') ||
      attribute(tag, 'id') === '__blog-post-container'
    ) {
      for (const element of outermost(html.slice(match.index), match[1] ?? '')) {
        return element.inner;
      }
      return undefined;
    }
  }
  return undefined;
}

/** True if any `<meta name="robots">` says noindex. Scans tag by tag, without backtracking. */
function isNoindex(html: string): boolean {
  const lower = html.toLowerCase();
  for (
    let start = lower.indexOf('<meta');
    start !== -1;
    start = lower.indexOf('<meta', start + 5)
  ) {
    const end = lower.indexOf('>', start);
    if (end === -1) return false;
    const tag = html.slice(start, end + 1);
    if (
      attribute(tag, 'name')?.toLowerCase() === 'robots' &&
      /noindex/i.test(attribute(tag, 'content') ?? '')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Turns an HTML page into a {@link SourceDocument} whose content is Markdown-shaped text.
 *
 * It reads `<main>` if the page has one, then the outermost `<article>`s, then `<body>`
 * (`root: 'article'` reads the articles first; see {@link HtmlMeta.root}). Navigation, scripts,
 * styles, forms and other chrome are dropped. Headings become `#` lines and keep their `id`
 * attribute as the anchor; `<pre>` becomes a fenced code block. Pages with
 * `<meta name="robots" content="noindex">` return `null`.
 *
 * This is a tag stripper, not a DOM parser: it is fast and dependency-free, and it expects the
 * well-formed output of a static site generator rather than arbitrary HTML.
 */
export function fromHtml(source: string, meta: HtmlMeta): SourceDocument | null {
  if (isNoindex(source)) return null;

  const headTitle = innerOf(source, 'title');
  const articles = innerOfAll(source, 'article');
  const article = articles.length > 0 ? articles.join('\n\n') : undefined;
  let html =
    (meta.root === 'article'
      ? // Every <article> left inside the outermost ones is nested: a card or a teaser.
        ((article === undefined
          ? undefined
          : replaceEach(article, outermost(article, 'article'), () => ' ')) ??
        innerOf(source, 'main'))
      : (innerOf(source, 'main') ?? article)) ??
    innerOf(source, 'body') ??
    source;
  html = removeDelimited(html, '<!--', '-->');
  for (const tag of DROP_ELEMENTS) {
    html = replaceElements(
      html,
      openTag(tag),
      () => `</${tag}>`,
      () => ' ',
    );
  }

  // The first <h1> beats <title>, which usually carries a " | Site name" suffix. It is read from
  // the whole root: a Docusaurus blog post's <h1> sits outside its Markdown container.
  const firstH1 = innerOf(html, 'h1');
  const title =
    (firstH1 && stripTags(firstH1).replace(/\s+/g, ' ').trim()) ||
    (headTitle && stripTags(headTitle).replace(/\s+/g, ' ').trim()) ||
    meta.fallbackTitle ||
    meta.id;

  const content = htmlToText(
    (meta.root === 'article' ? docusaurusMarkdown(html) : undefined) ?? html,
  );
  return { id: meta.id, url: meta.url, title, content };
}

/** A fence longer than any backtick run inside the code, so the code can never close it. */
function fenceFor(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Permalink anchors (`#`, `¶`, an invisible character or entity, such as the zero-width space
 * Docusaurus writes, or an emptied icon) are not heading text.
 * The second `\s*` sits inside the optional group, so whitespace has one way to match.
 */
const PERMALINK =
  /<a(?=[\s>])[^<>]*>\s*(?:(?:[#¶§\u200B-\u200D\u2060\uFEFF]|&[A-Za-z]+;|&#x?[\da-fA-F]+;)\s*)?<\/a>/gi;

function htmlToText(html: string): string {
  // Code blocks are swapped out first so whitespace normalization never touches them.
  const blocks: string[] = [];
  const withoutCode = replaceElements(
    html,
    /<pre(?=[\s>])[^<>]*>/gi,
    () => '</pre>',
    ({ inner }) => {
      const body = stripTags(inner.replace(/<br\s*\/?>/gi, '\n')).replace(/^\n+|\s+$/g, '');
      const fence = fenceFor(body);
      blocks.push(`${fence}\n${body}\n${fence}`);
      return `\n\n\uE000${String(blocks.length - 1)}\uE000\n\n`;
    },
  );
  const withHeadings = replaceElements(
    withoutCode,
    /<h([1-6])(?=[\s>])([^<>]*)>/gi,
    (open) => `</h${open[1] ?? ''}>`,
    ({ open, inner }) => {
      // Entities are decoded once, at the end, for everything outside code blocks.
      const heading = inner
        .replace(PERMALINK, '')
        .replace(/<[^<>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[#¶§] | [#¶§]$/g, '');
      if (!heading) return '\n\n';
      const id = attribute(` ${open[2] ?? ''}`, 'id');
      return `\n\n${'#'.repeat(Number(open[1]))} ${heading}${id ? ` {#${id}}` : ''}\n\n`;
    },
  );
  const text = replaceElements(
    withHeadings
      .replace(/<li(?=[\s>])[^<>]*>/gi, '\n- ')
      .replace(
        /<\/(?:p|div|section|article|header|ul|ol|table|blockquote|dl|figure|details|summary)>/gi,
        '\n\n',
      )
      .replace(/<tr(?=[\s>])[^<>]*>/gi, '\n| ')
      .replace(/<(?:p|div|section|br|dt|dd|hr|blockquote|figcaption)(?=[\s/>])[^<>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | '),
    /<code(?=[\s>])[^<>]*>/gi,
    () => '</code>',
    ({ inner }) => `\`${inner.replace(/<[^<>]*>/g, '')}\``,
  );

  return decodeEntities(text.replace(/<[^<>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\uE000(\d+)\uE000/g, (_, index: string) => blocks[Number(index)] ?? '');
}
