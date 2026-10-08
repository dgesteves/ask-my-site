/**
 * ask-my-site/docusaurus: a Docusaurus plugin. After `docusaurus build` it indexes the pages the
 * site actually serves into `ask-index.json` in the build output, and it wraps the site's `Root`
 * with the ask dialog, opened from a floating button or a shortcut.
 *
 * The answers come from an endpoint you deploy next to the site (a Vercel, Netlify or Cloudflare
 * function running `createAskHandler` from `ask-my-site/server`); see the README.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EmbeddingModel } from 'ai';

import { buildIndex, type EmbeddingProviderOptions } from '../build';
import { parseIndexFile, serializeIndexFile, type AskIndexFile } from '../index-file';
import { fromHtml } from '../loaders/html';
import type { ChunkingOptions, SourceDocument } from '../types';

/** What the dialog shows; passed to `AskDialog`. */
export interface AskMySiteDialogOptions {
  /** The dialog's accessible name. Default "Ask {site title}". */
  title?: string;
  placeholder?: string;
  /** Questions offered before the visitor types. */
  suggestions?: string[];
  /** Opens the dialog with ⌘ or Ctrl. Default `"i"`, so ⌘K stays with the site's search. `false` disables it. */
  shortcut?: string | false;
  /** The floating button's label. Default "Ask AI". `false` hides the button (open it with the shortcut). */
  buttonLabel?: string | false;
}

export interface AskMySiteOptions {
  /** URL the dialog posts questions to. Default `/api/ask`. */
  endpoint?: string;
  /**
   * The embedding model for the index; the endpoint must use the same one. Default: OpenAI's
   * `text-embedding-3-small` when `OPENAI_API_KEY` is set at build time, the same model through
   * AI Gateway when only `AI_GATEWAY_API_KEY` is, else `null`: a keyword-only index, with a warning.
   */
  embeddingModel?: EmbeddingModel | null;
  embeddingProviderOptions?: EmbeddingProviderOptions;
  chunking?: ChunkingOptions;
  /** Where the index is written in the build output, and served from. Default `ask-index.json`. */
  indexFile?: string;
  /** Route paths to leave out, e.g. `['/changelog']` (a prefix matches its subpages too). */
  exclude?: string[];
  dialog?: AskMySiteDialogOptions;
}

/** What the theme reads with `usePluginData('ask-my-site')`. */
export interface AskMySiteGlobalData {
  endpoint: string;
  dialog: AskMySiteDialogOptions & { title: string };
}

interface LoadContext {
  siteConfig: { title: string; baseUrl: string };
  generatedFilesDir: string;
}

interface PostBuildProps {
  outDir: string;
  routesPaths: string[];
}

interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

const here = dirname(fileURLToPath(import.meta.url));

export default function askMySite(context: LoadContext, options: AskMySiteOptions = {}) {
  const { baseUrl, title: siteTitle } = context.siteConfig;
  const indexFile = (options.indexFile ?? 'ask-index.json').replace(/^\/+/, '');
  const data: AskMySiteGlobalData = {
    endpoint: options.endpoint ?? '/api/ask',
    dialog: { ...options.dialog, title: options.dialog?.title ?? `Ask ${siteTitle}` },
  };

  return {
    name: 'ask-my-site',

    getThemePath() {
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
      const log = logger();
      const documents = await loadBuiltPages(outDir, routesPaths, baseUrl, options.exclude ?? []);
      const embedding = await defaultEmbedding(options, log);

      // The previous build's index, kept outside the build output, so unchanged pages reuse
      // their vectors instead of being embedded again.
      const cache = join(context.generatedFilesDir, 'ask-my-site', indexFile);
      let previous: AskIndexFile | null = null;
      try {
        previous = parseIndexFile(await readFile(cache, 'utf8'));
      } catch {
        // First build, or an index from an incompatible version: embed everything.
      }

      const started = Date.now();
      const { index, stats } = await buildIndex({
        documents,
        embeddingModel: embedding.model,
        ...(embedding.providerOptions
          ? { embeddingProviderOptions: embedding.providerOptions }
          : {}),
        ...(options.chunking ? { chunking: options.chunking } : {}),
        previous,
      });
      const json = serializeIndexFile(index);
      const target = join(outDir, indexFile);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, json, 'utf8');
      await mkdir(dirname(cache), { recursive: true });
      await writeFile(cache, json, 'utf8');

      const reuse = embedding.model
        ? `, ${String(stats.embedded)} embedded, ${String(stats.reused)} reused`
        : ', keyword-only';
      log.info(
        `Indexed ${String(documents.length)} pages into ${String(stats.chunks)} chunks${reuse} → ${indexFile} (${String(Math.round(json.length / 1024))} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
    },
  };
}

/**
 * The pages Docusaurus wrote, as documents: each route's HTML, read from its `<article>` (the
 * doc or post itself, without the table of contents or pagination), at the URL it is served from.
 * Routes without an article (the 404 page, custom React pages) are skipped.
 */
async function loadBuiltPages(
  outDir: string,
  routesPaths: readonly string[],
  baseUrl: string,
  exclude: readonly string[],
): Promise<SourceDocument[]> {
  const excluded = (route: string) =>
    exclude.some((prefix) => route === prefix || route.startsWith(`${prefix.replace(/\/$/, '')}/`));
  const documents: SourceDocument[] = [];
  for (const route of [...new Set(routesPaths)].sort()) {
    if (route.endsWith('404.html') || excluded(route)) continue;
    const html = await readBuiltRoute(outDir, route, baseUrl);
    if (html === undefined || !/<article[\s>]/i.test(html)) continue;
    const document = fromHtml(html, { id: route, url: route, root: 'article' });
    if (document?.content.trim()) documents.push(document);
  }
  return documents;
}

/** `/docs/intro` is `docs/intro/index.html`, or `docs/intro.html` with `trailingSlash: false`. */
async function readBuiltRoute(
  outDir: string,
  route: string,
  baseUrl: string,
): Promise<string | undefined> {
  const path = route.startsWith(baseUrl) ? route.slice(baseUrl.length) : route.replace(/^\//, '');
  const clean = path.replace(/\/$/, '');
  for (const file of [join(outDir, clean, 'index.html'), join(outDir, `${clean}.html`)]) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      // Try the other layout.
    }
  }
  return undefined;
}

async function defaultEmbedding(
  options: AskMySiteOptions,
  log: Logger,
): Promise<{ model: EmbeddingModel | null; providerOptions?: EmbeddingProviderOptions }> {
  if (options.embeddingModel !== undefined) {
    return {
      model: options.embeddingModel,
      ...(options.embeddingProviderOptions
        ? { providerOptions: options.embeddingProviderOptions }
        : {}),
    };
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return { model: createOpenAI().embedding('text-embedding-3-small') };
    } catch {
      log.warn('OPENAI_API_KEY is set but @ai-sdk/openai is not installed: npm i @ai-sdk/openai');
    }
  }
  if (process.env.AI_GATEWAY_API_KEY) return { model: 'openai/text-embedding-3-small' };
  log.warn(
    'No embedding model: building a keyword-only index. Set OPENAI_API_KEY or AI_GATEWAY_API_KEY ' +
      'at build time, or pass `embeddingModel`, for semantic search.',
  );
  return { model: null };
}

function logger(): Logger {
  return {
    info: (message) => {
      console.log(`[ask-my-site] ${message}`);
    },
    warn: (message) => {
      console.warn(`[ask-my-site] ${message}`);
    },
  };
}
