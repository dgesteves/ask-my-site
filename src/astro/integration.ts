// The Astro integration behind ask-my-site/astro and ask-my-site/starlight. Node.js only.
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroConfig, AstroIntegration } from 'astro';

import type { AskMySiteDialogOptions as DialogOptions, AskMySiteTheme } from '../embed/options';
import {
  buildEmbedding,
  checkIndexOptions,
  dialogEndpoint,
  excluder,
  hintDevEndpoint,
  resolveMcp,
  warnMissingDialogPeers,
  writeSiteIndex,
  type IndexOptions,
  type McpOption,
} from '../integrations/build';
import { fromHtml } from '../loaders/html';
import type { SourceDocument } from '../types';

/** What the dialog shows; passed to `mountAskDialog` from `ask-my-site/embed`. */
export interface AskMySiteDialogOptions extends DialogOptions {
  /** The dialog's accessible name. Default "Ask this site", or "Ask {site title}" in Starlight. */
  title?: string;
  /** Default `auto`: the `data-theme` on `<html>` when the site sets one, else the system's. */
  theme?: AskMySiteTheme;
}

export interface AskMySiteOptions extends IndexOptions {
  /**
   * URL the dialog posts questions to. Default `/api/ask`. The `ASK_ENDPOINT` environment
   * variable, when it is set as the site builds or starts, takes precedence over it:
   * `ASK_ENDPOINT=http://localhost:8787/api/ask` points the dialog at `ask-my-site dev`.
   */
  endpoint?: string;
  /**
   * The part of each page to index, as a selector: a tag name, `#id`, `.class` or `[attribute]`,
   * combined as in `div.prose` or listed as in `main, .post`. Default `main` (then the page's
   * `<article>`s, then its `<body>`). With any other selector, a page where it matches nothing is
   * not indexed.
   */
  content?: string;
  /** Elements to leave out of `content`, as a selector like it, e.g. `.toc, .comments`. */
  ignore?: string;
  /** Where the index is written in the build output, and served from. Default `ask-index.json`. */
  indexFile?: string;
  /**
   * Paths to leave out, relative to `base` and the locale, e.g. `['/changelog']` (a prefix
   * matches its subpages too). With `base: '/docs'`, `/changelog` leaves out `/docs/changelog`
   * and, in French, `/docs/fr/changelog`; `/fr` leaves out the French pages.
   */
  exclude?: string[];
  dialog?: AskMySiteDialogOptions;
  /**
   * The site's MCP endpoint (`createMcpHandler` from `ask-my-site/server`), as an absolute URL or a
   * path on the site such as `/api/mcp` (then `site` must be set), and optionally the name clients
   * list it under (default: from the site title). `McpInstall` from
   * `ask-my-site/astro/McpInstall.astro` then shows how to add it to Cursor, VS Code, Claude and
   * ChatGPT.
   */
  mcp?: McpOption;
}

/** The module `McpInstall.astro` reads the `mcp` option from. */
const MCP_MODULE = 'virtual:ask-my-site/mcp';

/** What a framework built on Astro, such as Starlight, sets on top of the site's options. */
export interface IntegrationPreset {
  /** The selector of each page's content, instead of `content`. */
  content?: string;
  /** The selector of what to leave out, instead of `ignore`. */
  ignore?: string;
  /** Locale path prefixes that get an index of their own. Default: from Astro's `i18n`. */
  locales?: string[];
  /** The dialog's title unless the site sets one. */
  title?: string;
  /** The site's title, which names the MCP server in clients unless `mcp.name` does. */
  siteTitle?: string;
  /** Stylesheets for the dialog, after its own and the launcher's. */
  stylesheets?: string[];
}

export function createIntegration(
  options: AskMySiteOptions,
  preset: IntegrationPreset,
): AstroIntegration {
  checkIndexOptions(options);
  const endpoint = dialogEndpoint(options.endpoint);
  let config: AstroConfig | undefined;
  // Whether this is `astro dev`, and whether a route of the site answers the endpoint.
  let dev = false;
  let served = false;
  return {
    name: 'ask-my-site',
    hooks: {
      'astro:config:setup': ({ config: astro, injectScript, updateConfig, logger, command }) => {
        dev = command === 'dev';
        const mcp = resolveMcp(
          options.mcp,
          astro.site,
          preset.siteTitle ?? 'docs',
          "astro.config's site",
        );
        warnMissingDialogPeers(logger);
        // The stylesheets go into every page's CSS: a `page` script's CSS is built but not linked.
        injectScript(
          'page-ssr',
          ['ask-my-site/react/styles.css', 'ask-my-site/embed/launcher.css']
            .concat(preset.stylesheets ?? [])
            .map((stylesheet) => `import ${JSON.stringify(stylesheet)};`)
            .join('\n'),
        );
        // Bundled by Vite with each page's scripts, so React is the site's own copy, if it has one.
        injectScript('page', pageScript(endpoint, options, preset));
        updateConfig({
          vite: {
            plugins: [quietUseClient(), virtualModule(MCP_MODULE, mcp ?? null)],
            // Vite's dev server does not see injected scripts when it scans for dependencies to
            // prebundle, and would find the dialog's on the first page load, then reload it.
            optimizeDeps: { include: ['ask-my-site/embed'] },
          },
        });
      },
      'astro:config:done': ({ config: resolved }) => {
        config = resolved;
      },
      'astro:routes:resolved': ({ routes }) => {
        // An endpoint route, as a page cannot answer a POST: Starlight's `[...slug]` matches any
        // path.
        const path = endpoint.split(/[?#]/)[0] ?? endpoint;
        served = routes.some((route) => route.type === 'endpoint' && route.patternRegex.test(path));
      },
      'astro:server:start': ({ logger }) => {
        if (dev && !served) hintDevEndpoint(endpoint, 'astro dev', logger);
      },
      'astro:build:done': async ({ dir, pages, logger }) => {
        if (!config) throw new Error('ask-my-site: astro:config:done did not run');
        const indexFile = (options.indexFile ?? 'ask-index.json').replace(/^\/+/, '');
        const outDir = fileURLToPath(dir);
        const groups = await loadBuiltPages(outDir, pages, config, options, preset);
        const total = [...groups.values()].reduce((sum, documents) => sum + documents.length, 0);
        if (total === 0) {
          logger.warn(
            `None of the ${String(pages.length)} pages Astro built has content to index in ${preset.content ?? options.content ?? 'main'}, so there is no ${indexFile}.`,
          );
          return;
        }
        const embedding = await buildEmbedding(options, logger);
        for (const [locale, documents] of groups) {
          // A site whose every locale has a path prefix has no pages of its own at the root.
          if (documents.length === 0) continue;
          const name = locale ? `${locale}/${indexFile}` : indexFile;
          await writeSiteIndex({
            documents,
            embeddingModel: embedding.model,
            embeddingProviderOptions: embedding.providerOptions,
            options,
            file: join(outDir, name),
            // One file per locale, in node_modules/.cache, which Netlify and Vercel keep between
            // builds.
            cache: join(
              fileURLToPath(config.root),
              'node_modules',
              '.cache',
              'ask-my-site',
              `astro-${locale || 'root'}.json`,
            ),
            // With an adapter, Astro serves static files from `dist/client/`: say so.
            name: relative(fileURLToPath(config.root), join(outDir, name)) || name,
            log: logger,
          });
        }
      },
    },
  };
}

/**
 * Radix and cmdk start their modules with "use client", a React Server Components directive that
 * means nothing in a browser bundle, and Vite 8 warns about each one at length. This blanks it out
 * in those packages only (with spaces, so source positions do not move).
 */
function quietUseClient() {
  return {
    name: 'ask-my-site:quiet-use-client',
    transform(code: string, id: string) {
      if (!/[\\/]node_modules[\\/](?:@radix-ui[\\/][^\\/]+|cmdk)[\\/]/.test(id)) return null;
      const blanked = code.replace(/^(["'])use client\1;?/, (directive) =>
        ' '.repeat(directive.length),
      );
      return blanked === code ? null : { code: blanked, map: null };
    },
  };
}

/** A Vite plugin serving `id` as a module whose default export is `value`. */
function virtualModule(id: string, value: unknown) {
  const resolved = `\0${id}`;
  return {
    name: 'ask-my-site:virtual-module',
    resolveId: (source: string) => (source === id ? resolved : null),
    load: (module: string) =>
      module === resolved ? `export default ${JSON.stringify(value)};` : null,
  };
}

/** The script every page runs: `mountAskDialog` with the dialog's options. */
function pageScript(
  endpoint: string,
  options: AskMySiteOptions,
  preset: IntegrationPreset,
): string {
  const mount = {
    endpoint,
    ...options.dialog,
    title: options.dialog?.title ?? preset.title,
  };
  return [
    "import { mountAskDialog } from 'ask-my-site/embed';",
    `mountAskDialog(${JSON.stringify(mount)});`,
  ].join('\n');
}

/**
 * The locale path prefixes in Astro's `i18n` config: every locale's path, except the default
 * locale's unless `prefixDefaultLocale` is set.
 */
function astroLocales({ i18n }: AstroConfig): string[] {
  if (!i18n) return [];
  const locales = i18n.locales.map((locale) =>
    typeof locale === 'string' ? { path: locale, codes: [locale] } : locale,
  );
  const prefixDefault = typeof i18n.routing === 'object' && i18n.routing.prefixDefaultLocale;
  const defaultPath = locales.find(
    ({ path, codes }) => path === i18n.defaultLocale || codes.includes(i18n.defaultLocale),
  )?.path;
  return locales.map(({ path }) => path).filter((path) => prefixDefault || path !== defaultPath);
}

/**
 * The pages Astro built, as documents grouped by locale path prefix (`''` for the rest): each
 * page's content at the URL Astro serves it from, under `base`, with the trailing slash that
 * `trailingSlash` and `build.format` give it (the same URLs as Astro's sitemap). The 404 and 500
 * pages, excluded paths and pages without content are skipped. Redirects and i18n fallbacks are
 * not pages to Astro, so they never come up.
 */
async function loadBuiltPages(
  outDir: string,
  pages: readonly { pathname: string }[],
  config: AstroConfig,
  options: AskMySiteOptions,
  preset: IntegrationPreset,
): Promise<Map<string, SourceDocument[]>> {
  const locales = preset.locales ?? astroLocales(config);
  const groups = new Map<string, SourceDocument[]>([['', []]]);
  for (const locale of locales) groups.set(locale, []);
  const excluded = excluder(options.exclude ?? []);
  const base = config.base.replace(/\/+$/, '');
  const root = preset.content ?? options.content ?? 'main';
  const ignore = preset.ignore ?? options.ignore;

  for (const pathname of pages.map((page) => page.pathname.replace(/^\/+/, '')).sort()) {
    const path = pathname.replace(/\/+$/, '');
    if (path === '404' || path === '500') continue;
    const locale = locales.find((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ?? '';
    if (excluded(path) || (locale && excluded(path.slice(locale.length)))) continue;
    const html = await readBuiltPage(outDir, path, config.build.format);
    if (html === undefined) continue;
    const url =
      pathname === ''
        ? base && config.trailingSlash === 'never'
          ? base
          : `${base}/`
        : `${base}/${pathname}`;
    const document = fromHtml(html, { id: url, url, root, ...(ignore ? { ignore } : {}) });
    if (document?.content.trim()) groups.get(locale)?.push(document);
  }
  return groups;
}

/**
 * The HTML Astro wrote for a page: `guides/setup/index.html` for the `directory` format,
 * `guides/setup.html` for `file`, and either for `preserve`, which follows the source file.
 */
async function readBuiltPage(
  outDir: string,
  path: string,
  format: AstroConfig['build']['format'],
): Promise<string | undefined> {
  const files =
    path === ''
      ? ['index.html']
      : format === 'file'
        ? [`${path}.html`, `${path}/index.html`]
        : [`${path}/index.html`, `${path}.html`];
  for (const file of files) {
    try {
      return await readFile(join(outDir, file), 'utf8');
    } catch {
      // Try the other layout.
    }
  }
  return undefined;
}
