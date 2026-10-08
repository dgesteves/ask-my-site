/**
 * ask-my-site/docusaurus: a Docusaurus plugin. After `docusaurus build` it indexes the pages the
 * site actually serves into `ask-index.json` in the build output, and it renders the ask dialog,
 * opened from a floating button or a shortcut, from the site's `Root`.
 *
 * The answers come from an endpoint you deploy next to the site (a Vercel, Netlify or Cloudflare
 * function running `createAskHandler` from `ask-my-site/server`); see the README.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AskMySiteDialogOptions as DialogOptions } from '../embed/options';
import {
  buildEmbedding,
  checkIndexOptions,
  consoleLogger,
  excluder,
  warnMissingDialogPeers,
  writeSiteIndex,
  type IndexOptions,
} from '../integrations/build';
import { attribute, fromHtml } from '../loaders/html';
import type { SourceDocument } from '../types';

/** What the dialog shows; passed to `AskDialog`. */
export interface AskMySiteDialogOptions extends DialogOptions {
  /** The dialog's accessible name. Default "Ask {site title}". */
  title?: string;
}

// A type, not an interface, so it fits Docusaurus's `PluginOptions` index signature in a
// `docusaurus.config.ts` plugins entry.
export type AskMySiteOptions = IndexOptions & {
  /** The plugin instance's id, set by Docusaurus. Default `"default"`. */
  id?: string;
  /** URL the dialog posts questions to. Default `/api/ask`. */
  endpoint?: string;
  /** Where the index is written in the build output, and served from. Default `ask-index.json`. */
  indexFile?: string;
  /**
   * Paths to leave out, relative to the site's base URL and locale, e.g. `['/changelog']` (a
   * prefix matches its subpages too). With `baseUrl: '/docs/'`, `/changelog` leaves out
   * `/docs/changelog` and, in French, `/docs/fr/changelog`.
   */
  exclude?: string[];
  dialog?: AskMySiteDialogOptions;
};

/** What the theme reads with `useAllPluginInstancesData('ask-my-site')`. */
export interface AskMySiteGlobalData {
  endpoint: string;
  dialog: AskMySiteDialogOptions & { title: string };
}

interface LoadContext {
  siteDir: string;
  siteConfig: { title: string; titleDelimiter?: string };
  /** The base URL with the locale's path, e.g. `/docs/fr/`. */
  baseUrl: string;
  i18n: { currentLocale: string };
}

interface PostBuildProps {
  outDir: string;
  routesPaths: string[];
}

const here = dirname(fileURLToPath(import.meta.url));

export default function askMySite(context: LoadContext, options: AskMySiteOptions = {}) {
  checkIndexOptions(options);
  warnMissingDialogPeers(consoleLogger());
  const { title: siteTitle, titleDelimiter = '|' } = context.siteConfig;
  const indexFile = (options.indexFile ?? 'ask-index.json').replace(/^\/+/, '');
  const data: AskMySiteGlobalData = {
    endpoint: options.endpoint ?? '/api/ask',
    dialog: { ...options.dialog, title: options.dialog?.title ?? `Ask ${siteTitle}` },
  };

  return {
    name: 'ask-my-site',

    getThemePath() {
      // Root, which renders AskMySite: both can be swizzled.
      return join(here, 'theme');
    },

    getClientModules() {
      // The dialog's stylesheet (dist/styles.css, `ask-my-site/react/styles.css`) and the launcher's.
      return [join(here, '..', 'styles.css'), join(here, 'launcher.css')];
    },

    contentLoaded({ actions }: { actions: { setGlobalData: (data: unknown) => void } }) {
      actions.setGlobalData(data);
    },

    async postBuild({ outDir, routesPaths }: PostBuildProps) {
      const log = consoleLogger();
      const documents = await loadBuiltPages(outDir, routesPaths, context.baseUrl, {
        exclude: options.exclude ?? [],
        titleSuffix: ` ${titleDelimiter} ${siteTitle}`,
      });
      const embedding = await buildEmbedding(options, log);
      await writeSiteIndex({
        documents,
        embeddingModel: embedding.model,
        embeddingProviderOptions: embedding.providerOptions,
        options,
        file: join(outDir, indexFile),
        // One file per locale and plugin instance, in node_modules/.cache, which Netlify and
        // Vercel keep between builds (.docusaurus is not kept).
        cache: join(
          context.siteDir,
          'node_modules',
          '.cache',
          'ask-my-site',
          `${context.i18n.currentLocale}-${options.id ?? 'default'}.json`,
        ),
        name: indexFile,
        log,
      });
    },
  };
}

/**
 * Docusaurus's page types, from the classes it puts on `<html>`. Docs, blog posts and MDX pages
 * are content; blog lists, tag and author pages list content that is indexed on its own page.
 */
const CONTENT_PAGES = ['docs-doc-page', 'blog-post-page', 'mdx-page'];
const LISTING_PAGES = [
  'blog-list-page',
  'blog-tags-list-page',
  'blog-tags-post-list-page',
  'blog-authors-list-page',
  'blog-authors-posts-page',
  'docs-tags-list-page',
  'docs-tags-doc-list-page',
];

/** Whether a built page is content to index, from its page type. */
function isContentPage(html: string): boolean {
  const tag = /<html(?=[\s>])[^<>]*>/i.exec(html)?.[0] ?? '';
  const classes = (attribute(tag, 'class') ?? '').split(/\s+/);
  if (classes.includes('docs-doc-page')) {
    // A generated-index category page is a docs page too, but without the doc's id: its cards
    // repeat the pages they link to.
    return classes.some((name) => name.startsWith('docs-doc-id-'));
  }
  if (CONTENT_PAGES.some((name) => classes.includes(name))) return true;
  if (LISTING_PAGES.some((name) => classes.includes(name))) return false;
  // No page type (an older or custom theme): a page with an article is content.
  return /<article[\s>]/i.test(html);
}

/** `route` relative to the (localized) base URL, with a leading slash: `/docs/fr/intro` → `/intro`. */
function sitePath(route: string, baseUrl: string): string {
  if (route.startsWith(baseUrl)) return `/${route.slice(baseUrl.length)}`;
  return `${route}/` === baseUrl ? '/' : route;
}

/**
 * The pages Docusaurus wrote, as documents: each content page's HTML, read from its `<article>`
 * (the doc or post itself, without the table of contents or pagination, and from Docusaurus's
 * Markdown container when there is one, without breadcrumbs or a post's byline), at the URL it is
 * served from. Listing pages, the 404 page and pages without an article are skipped.
 */
async function loadBuiltPages(
  outDir: string,
  routesPaths: readonly string[],
  baseUrl: string,
  { exclude, titleSuffix }: { exclude: readonly string[]; titleSuffix: string },
): Promise<SourceDocument[]> {
  const excluded = excluder(exclude);
  const documents: SourceDocument[] = [];
  for (const route of [...new Set(routesPaths)].sort()) {
    const path = sitePath(route, baseUrl);
    if (route.endsWith('404.html') || excluded(path)) continue;
    const html = await readBuiltRoute(outDir, path);
    if (html === undefined || !isContentPage(html)) continue;
    const document = fromHtml(html, { id: route, url: route, root: 'article' });
    if (!document?.content.trim()) continue;
    // A title read from <title> ends with the site's: "Setup | Acme Docs".
    const { title } = document;
    documents.push(
      title.endsWith(titleSuffix) && title.length > titleSuffix.length
        ? { ...document, title: title.slice(0, -titleSuffix.length) }
        : document,
    );
  }
  return documents;
}

/** `/intro` is `intro/index.html`, or `intro.html` with `trailingSlash: false`. */
async function readBuiltRoute(outDir: string, path: string): Promise<string | undefined> {
  const clean = path.replace(/^\/+|\/+$/g, '');
  for (const file of [join(outDir, clean, 'index.html'), join(outDir, `${clean}.html`)]) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      // Try the other layout.
    }
  }
  return undefined;
}
