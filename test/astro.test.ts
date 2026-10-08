import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { StarlightUserConfig } from '@astrojs/starlight/types';
import type { AstroIntegration } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import askMySite from '../src/astro';
import { parseIndexFile } from '../src/index-file';
import { mockEmbeddingModel } from '../src/mock';
import starlightAskMySite from '../src/starlight';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ask-my-site-astro-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A page as Starlight 0.42 builds it, chrome and all, from what a real build writes. */
function starlightPage(
  title: string,
  markdown: string,
  { pagefind = true, lang = 'en', banner = '' } = {},
): string {
  return `<!DOCTYPE html><html lang="${lang}" dir="ltr" data-theme="dark" data-has-toc data-has-sidebar class="astro-uknsdzpk"><head><meta charset="utf-8"/><title>${title} | Acme Docs</title><script>
	window.StarlightThemeProvider = (() => { const storedTheme = typeof localStorage !== 'undefined' && localStorage.getItem('starlight-theme'); })();
</script></head><body class="astro-uknsdzpk"><a class="sl-skip-link astro-qhummnor" href="#_top">Skip to content</a><div class="page sl-flex astro-g77elgym"><header class="header astro-g77elgym"><div class="header astro-vzdplpq4"><div class="title-wrapper sl-flex astro-vzdplpq4"><a href="/" class="site-title sl-flex astro-mtwtsapi"><span class="astro-mtwtsapi">Acme Docs</span></a></div><site-search class="astro-3zc6wlnj"><button data-open-modal disabled aria-label="Search" class="astro-3zc6wlnj"><span class="sl-hidden md:sl-block astro-3zc6wlnj" aria-hidden="true">Search</span><kbd class="astro-3zc6wlnj"><kbd class="astro-3zc6wlnj">Ctrl</kbd><kbd class="astro-3zc6wlnj">K</kbd></kbd></button><dialog style="padding:0" aria-label="Search" class="astro-3zc6wlnj"><button data-close-modal>Cancel</button></dialog></site-search></div></header><nav class="sidebar print:hidden astro-g77elgym" aria-label="Main"><button popovertarget="starlight__sidebar" class="sl-menu-button sl-flex md:sl-hidden print:hidden astro-gzvgytkx"><span class="sr-only astro-gzvgytkx">Menu</span></button><sl-sidebar-pane popover id="starlight__sidebar" class="sidebar-pane astro-g77elgym"><ul class="top-level astro-cxyjek37"><li class="astro-cxyjek37"><a href="/guides/setup/" class="astro-cxyjek37"><span class="astro-cxyjek37">Sidebar link</span></a></li></ul></sl-sidebar-pane></nav><div class="main-frame astro-g77elgym"><div class="lg:sl-flex astro-diwahtgj"><aside class="right-sidebar-container print:hidden astro-diwahtgj"><div class="right-sidebar astro-diwahtgj"><starlight-toc data-min-h="2" data-max-h="3"><nav aria-labelledby="starlight__on-this-page"><h2 id="starlight__on-this-page">On this page</h2><ul class="astro-u6knexgl"><li class="astro-u6knexgl"><a href="#_top" class="astro-u6knexgl"><span class="astro-u6knexgl">Overview</span></a></li></ul></nav></starlight-toc></div></aside><div class="main-pane astro-diwahtgj"><main${pagefind ? ' data-pagefind-body' : ''} class="astro-uknsdzpk" lang="${lang}" dir="ltr">${banner ? `<div class="sl-banner astro-5wrfavop" data-pagefind-ignore>${banner}</div>` : ''}<div class="content-panel astro-n7rsyblg"><div class="sl-container astro-n7rsyblg"><h1 id="_top" class="astro-mxmfkvky">${title}</h1></div></div><div class="content-panel astro-n7rsyblg"><div class="sl-container astro-n7rsyblg"><div class="sl-markdown-content">${markdown}</div><footer class="sl-flex astro-ocltnucx"><div class="meta sl-flex astro-ocltnucx"><a href="https://github.com/acme/docs/edit/main/page.md" class="sl-flex astro-eez2twj6">Edit page</a><p class="astro-xm4ok7ou">Last updated: <time datetime="2026-10-01T00:00:00.000Z">Oct 1, 2026</time></p></div><div class="pagination-links print:hidden astro-rqi3ghp7" dir="ltr"><a href="/" rel="prev" class="astro-rqi3ghp7"><span class="astro-rqi3ghp7">Previous<br class="astro-rqi3ghp7"><span class="link-title astro-rqi3ghp7">Introduction</span></span></a></div></footer></div></div></main></div></div></div></div></body></html>`;
}

/** A heading as Starlight renders it: an anchor link whose label is for screen readers only. */
const heading = (id: string, text: string) =>
  `<div class="sl-heading-wrapper level-h2"><h2 id="${id}">${text}</h2><a class="sl-anchor-link" href="#${id}"><span aria-hidden="true" class="sl-anchor-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m12.11 15.39-3.88 3.88"/></svg></span><span class="sr-only" data-pagefind-ignore>Section titled “${text}”</span></a></div>`;

/** An Expressive Code terminal block: one <div> per line, the snippet again in data-code. */
const terminal = (...lines: string[]) =>
  `<div class="expressive-code"><link rel="stylesheet" href="/_astro/ec.w36nc.css"><script type="module" src="/_astro/ec.0vx5m.js"></script><figure class="frame is-terminal not-content"><figcaption class="header"><span class="title"></span><span class="sr-only">Terminal window</span></figcaption><pre data-language="sh"><code>${lines
    .map(
      (line) =>
        `<div class="ec-line"><div class="code">${line ? `<span style="--0:#82AAFF;--1:#3B61B0">${line}</span>` : '\n'}</div></div>`,
    )
    .join(
      '',
    )}</code></pre><div class="copy"><div aria-live="polite"></div><button title="Copy to clipboard" data-copied="Copied!" data-code="${lines.join('\u007f')} => <done>"><div></div></button></div></figure></div>`;

const aside = (text: string) =>
  `<aside aria-label="Tip" class="starlight-aside starlight-aside--tip"><p class="starlight-aside__title" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="starlight-aside__icon"><path d="M1 1"/></svg>Tip</p><div class="starlight-aside__content"><p>${text}</p></div></aside>`;

type Format = 'directory' | 'file' | 'preserve';
type TrailingSlash = 'always' | 'never' | 'ignore';

interface SiteOptions {
  format?: Format;
  trailingSlash?: TrailingSlash;
  base?: string;
  i18n?: unknown;
}

/**
 * Writes `pages` (route path → HTML) where Astro writes them for `format`, and returns the
 * `pages` that `astro:build:done` reports: pathnames without a leading slash, with a trailing
 * slash as Astro adds one for `trailingSlash` and `format`.
 */
async function build(
  integration: AstroIntegration,
  pages: Record<string, string>,
  { format = 'directory', trailingSlash = 'ignore', base = '/', i18n }: SiteOptions = {},
) {
  const outDir = join(root, 'dist');
  const reported: { pathname: string }[] = [];
  const slash =
    trailingSlash === 'always' || (trailingSlash === 'ignore' && format === 'directory');
  for (const [path, html] of Object.entries(pages)) {
    const status = path === '404' || path === '500';
    const file =
      path === ''
        ? 'index.html'
        : format === 'directory' && !status
          ? `${path}/index.html`
          : `${path}.html`;
    await mkdir(dirname(join(outDir, file)), { recursive: true });
    await writeFile(join(outDir, file), html);
    reported.push({ pathname: path === '' ? '' : slash ? `${path}/` : path });
  }
  const logger = { info: vi.fn(), warn: vi.fn() };
  const injected: [string, string][] = [];
  const updateConfig = vi.fn();
  const hooks = integration.hooks as Record<string, (options: unknown) => unknown>;
  await hooks['astro:config:setup']?.({
    injectScript: (stage: string, content: string) => injected.push([stage, content]),
    updateConfig,
    logger,
  });
  await hooks['astro:config:done']?.({
    config: {
      root: pathToFileURL(`${root}/`),
      base,
      trailingSlash,
      build: { format },
      ...(i18n ? { i18n } : {}),
    },
    logger,
  });
  await hooks['astro:build:done']?.({
    dir: pathToFileURL(`${outDir}/`),
    pages: reported,
    assets: new Map(),
    logger,
  });
  const read = async (file = 'ask-index.json') =>
    parseIndexFile(await readFile(join(outDir, file), 'utf8'));
  return { outDir, logger, injected, updateConfig, read };
}

/** The Astro integration the Starlight plugin adds, for a Starlight config. */
function starlightIntegration(
  options: Parameters<typeof starlightAskMySite>[0] = {},
  config: Partial<StarlightUserConfig> = {},
): AstroIntegration {
  const plugin = starlightAskMySite({ embeddingModel: mockEmbeddingModel(), ...options });
  let added: AstroIntegration | undefined;
  const setup = plugin.hooks['config:setup'] as unknown as (options: unknown) => void;
  setup({
    config: { title: 'Acme Docs', ...config },
    addIntegration: (integration: AstroIntegration) => {
      added = integration;
    },
  });
  if (!added) throw new Error('the plugin added no integration');
  return added;
}

const STARLIGHT_PAGES: Record<string, string> = {
  '': starlightPage('Introduction', '<p>Welcome to the docs.</p>'),
  'guides/setup': starlightPage(
    'Setup',
    `<p>Install it first.</p>${heading('install', 'Install')}${terminal('npm install acme', '', 'npx acme --init')}${aside('Pin the version.')}${heading('configure', 'Configure')}<p>Then configure it.</p>`,
    { banner: 'A new release is out!' },
  ),
  'reference/api': starlightPage('API', `${heading('options', 'Options')}<p>Every option.</p>`),
  // `pagefind: false` in its frontmatter.
  changelog: starlightPage('Changelog', '<p>1.0 released.</p>', { pagefind: false }),
  // Starlight's 404 page has no data-pagefind-body either.
  '404': starlightPage('404', '<p>Page not found.</p>', { pagefind: false }),
};

describe('ask-my-site/starlight', () => {
  it('indexes the region Starlight marks for search, at the URLs Astro serves', async () => {
    const { read } = await build(starlightIntegration(), STARLIGHT_PAGES);
    const index = await read();
    // Not the changelog (`pagefind: false`) or the 404 page.
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([
      ['/', 'Introduction'],
      ['/guides/setup/', 'Setup'],
      ['/reference/api/', 'API'],
    ]);
    const text = index.chunks.map((c) => `${c.heading}\n${c.text}`).join('\n');
    // No header, search, sidebar, table of contents, banner, heading anchors' labels, code
    // frame labels, copy button, edit link, last updated date or pagination.
    for (const chrome of [
      'Skip to content',
      'Search',
      'Ctrl',
      'Sidebar link',
      'On this page',
      'Overview',
      'A new release',
      'Section titled',
      'Terminal window',
      '<done>',
      'Edit page',
      'Last updated',
      'Previous',
      'Acme Docs',
    ]) {
      expect([chrome, text.includes(chrome)]).toEqual([chrome, false]);
    }
    const install = index.chunks.find((c) => c.anchor === 'install');
    // Code blocks keep their lines, and asides (notes, tips) are content.
    expect(install?.text).toBe(
      '```\nnpm install acme\n\nnpx acme --init\n```\n\nTip\n\nPin the version.',
    );
    expect(index.chunks.find((c) => c.anchor === 'configure')?.heading).toBe('Configure');
    expect(index.embedding?.model).toBe('mock-hash-512');
  });

  it('follows base, trailingSlash and build.format', async () => {
    const cases: [SiteOptions, string[]][] = [
      [{ format: 'file' }, ['/', '/guides/setup', '/reference/api']],
      [
        { format: 'directory', trailingSlash: 'never', base: '/docs' },
        ['/docs', '/docs/guides/setup', '/docs/reference/api'],
      ],
      [
        { format: 'file', trailingSlash: 'always', base: '/docs/' },
        ['/docs/', '/docs/guides/setup/', '/docs/reference/api/'],
      ],
      [
        { format: 'preserve', base: '/docs' },
        ['/docs/', '/docs/guides/setup', '/docs/reference/api'],
      ],
    ];
    for (const [site, urls] of cases) {
      await rm(join(root, 'dist'), { recursive: true, force: true });
      const { read } = await build(starlightIntegration(), STARLIGHT_PAGES, site);
      expect([site, (await read()).documents.map((d) => d.url)]).toEqual([site, urls]);
    }
  });

  it('writes an index per locale, and excludes paths relative to base and the locale', async () => {
    const french = (title: string, text: string) =>
      starlightPage(title, `<p>${text}</p>`, { lang: 'fr' });
    const pages = {
      ...STARLIGHT_PAGES,
      fr: french('Introduction', 'Bienvenue.'),
      'fr/guides/setup': french('Installation', 'Installez-le.'),
      'fr/changelog': french('Journal', 'Nouveautés.'),
      'pt-br/guides/setup': starlightPage('Instalação', '<p>Instale.</p>', { lang: 'pt-BR' }),
    };
    const integration = starlightIntegration(
      { exclude: ['/changelog', 'reference'] },
      {
        title: { en: 'Acme Docs', fr: 'Docs Acme' },
        locales: {
          root: { label: 'English', lang: 'en' },
          fr: { label: 'Français' },
          'pt-br': { label: 'Português', lang: 'pt-BR' },
        },
      },
    );
    const { read, logger, outDir } = await build(integration, pages, { base: '/docs' });
    expect((await read()).documents.map((d) => d.url)).toEqual(['/docs/', '/docs/guides/setup/']);
    expect((await read('fr/ask-index.json')).documents.map((d) => [d.url, d.title])).toEqual([
      ['/docs/fr/', 'Introduction'],
      ['/docs/fr/guides/setup/', 'Installation'],
    ]);
    expect((await read('pt-br/ask-index.json')).documents.map((d) => d.url)).toEqual([
      '/docs/pt-br/guides/setup/',
    ]);
    expect(logger.info.mock.calls.map(([message]) => String(message).split(' → ')[1])).toEqual([
      expect.stringMatching(/^ask-index\.json /) as string,
      expect.stringMatching(/^fr\/ask-index\.json /) as string,
      expect.stringMatching(/^pt-br\/ask-index\.json /) as string,
    ]);

    // Every locale under its own path: there is no root index.
    await rm(outDir, { recursive: true });
    const prefixed = starlightIntegration(
      {},
      { defaultLocale: 'en', locales: { en: { label: 'English' }, fr: { label: 'Français' } } },
    );
    const { outDir: dir } = await build(prefixed, {
      en: starlightPage('Introduction', '<p>Welcome.</p>'),
      fr: french('Introduction', 'Bienvenue.'),
    });
    expect(existsSync(join(dir, 'ask-index.json'))).toBe(false);
    expect(existsSync(join(dir, 'en', 'ask-index.json'))).toBe(true);
    expect(existsSync(join(dir, 'fr', 'ask-index.json'))).toBe(true);
  });

  it('reuses vectors per locale from node_modules/.cache, and falls back to keyword-only', async () => {
    const pages = { ...STARLIGHT_PAGES, fr: starlightPage('Introduction', '<p>Bienvenue.</p>') };
    const config = {
      locales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' } },
    };
    await build(starlightIntegration({}, config), pages);
    const { logger } = await build(starlightIntegration({}, config), pages);
    for (const [message] of logger.info.mock.calls) {
      expect(message).toMatch(/^Indexed \d+ pages into \d+ chunks, 0 embedded, \d+ reused → /);
    }
    const cache = join(root, 'node_modules', '.cache', 'ask-my-site');
    expect(existsSync(join(cache, 'astro-root.json'))).toBe(true);
    expect(existsSync(join(cache, 'astro-fr.json'))).toBe(true);

    const keywordOnly = await build(starlightIntegration({ embeddingModel: undefined }), pages);
    expect(keywordOnly.logger.warn.mock.calls[0]?.[0]).toContain(
      'No embedding model: building a keyword-only index.',
    );
    expect((await keywordOnly.read()).embedding).toBeNull();
  });

  it('adds the dialog to every page, titled after the site, in Starlight’s colors', async () => {
    const { injected, updateConfig } = await build(
      starlightIntegration(
        { endpoint: 'https://api.example.com/ask', dialog: { shortcut: 'j', theme: 'light' } },
        {
          title: { fr: 'Docs Acme', en: 'Acme Docs' },
          locales: { root: { label: 'English', lang: 'en' } },
        },
      ),
      STARLIGHT_PAGES,
    );
    const [styles, script] = injected;
    expect(styles?.[0]).toBe('page-ssr');
    expect(styles?.[1].split('\n')).toEqual([
      'import "ask-my-site/react/styles.css";',
      'import "ask-my-site/embed/launcher.css";',
      'import "ask-my-site/starlight/launcher.css";',
    ]);
    expect(script?.[0]).toBe('page');
    expect(script?.[1]).toBe(
      `import { mountAskDialog } from 'ask-my-site/embed';\nmountAskDialog(${JSON.stringify({
        endpoint: 'https://api.example.com/ask',
        shortcut: 'j',
        theme: 'light',
        title: 'Ask Acme Docs',
      })});`,
    );
    expect(updateConfig).toHaveBeenCalledWith({
      vite: {
        plugins: [expect.objectContaining({ name: 'ask-my-site:quiet-use-client' })],
        optimizeDeps: { include: ['ask-my-site/embed'] },
      },
    });
  });
});

describe('ask-my-site/astro', () => {
  /** A page of a plain Astro site: chrome around <main>. */
  const page = (title: string, main: string, head = '') =>
    `<!DOCTYPE html><html lang="en"><head><title>${title} | Acme</title>${head}</head><body><header><nav><a href="/">Home</a></nav><p>Site header</p></header><main>${main}</main><footer>Site footer</footer></body></html>`;

  const PAGES: Record<string, string> = {
    '': page('Home', '<h1>Welcome</h1><p>The home page.</p>'),
    'guides/setup': page(
      'Setup',
      '<h1>Setup</h1><p>Install it.</p><div class="toc">Table of contents</div><aside>Related links</aside>',
    ),
    hidden: page(
      'Hidden',
      '<h1>Hidden</h1><p>Not for search.</p>',
      '<meta name="robots" content="noindex">',
    ),
    landing:
      '<html><head><title>Landing</title></head><body><div class="hero">Big words</div></body></html>',
    '404': page('Not found', '<h1>Not found</h1>'),
    '500': page('Error', '<h1>Error</h1>'),
  };

  it('indexes each page’s <main>, without noindex, 404 and 500 pages', async () => {
    const integration = askMySite({ embeddingModel: mockEmbeddingModel(), ignore: '.toc' });
    const { read, injected } = await build(integration, PAGES);
    const index = await read();
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([
      ['/', 'Welcome'],
      ['/guides/setup/', 'Setup'],
      // A page without <main> or <article> is read from its <body>.
      ['/landing/', 'Landing'],
    ]);
    const text = index.chunks.map((c) => c.text).join('\n');
    for (const chrome of [
      'Site header',
      'Site footer',
      'Home',
      'Table of contents',
      'Related links',
    ]) {
      expect([chrome, text.includes(chrome)]).toEqual([chrome, false]);
    }
    expect(injected.map(([stage]) => stage)).toEqual(['page-ssr', 'page']);
    expect(injected[0]?.[1]).not.toContain('starlight');
    expect(injected[1]?.[1]).toContain('mountAskDialog({"endpoint":"/api/ask"});');
  });

  it('reads the part of the page `content` selects, and skips pages without it', async () => {
    const integration = askMySite({ embeddingModel: mockEmbeddingModel(), content: '.prose' });
    const pages = {
      a: page('A', '<h1>A</h1><div class="prose"><p>Prose A.</p></div><p>Not prose.</p>'),
      b: page('B', '<h1>B</h1><p>No prose here.</p>'),
    };
    const { read } = await build(integration, pages);
    const index = await read();
    // The title comes from <title> when the selected part has no <h1>.
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([['/a/', 'A | Acme']]);
    expect(index.chunks.map((c) => c.text)).toEqual(['Prose A.']);
  });

  it('writes nothing, with a warning, when no page has content', async () => {
    const integration = askMySite({ embeddingModel: mockEmbeddingModel(), content: '#missing' });
    const { logger, outDir } = await build(integration, PAGES);
    expect(logger.warn).toHaveBeenCalledWith(
      'None of the 6 pages Astro built has content to index in #missing, so there is no ask-index.json.',
    );
    expect(existsSync(join(outDir, 'ask-index.json'))).toBe(false);
  });

  it('writes an index per locale of Astro’s i18n config', async () => {
    const pages = {
      '': page('Home', '<h1>Home</h1><p>English.</p>'),
      es: page('Inicio', '<h1>Inicio</h1><p>Español.</p>'),
      'pt/guide': page('Guia', '<h1>Guia</h1><p>Português.</p>'),
    };
    const i18n = {
      defaultLocale: 'en',
      locales: ['en', 'es', { path: 'pt', codes: ['pt-BR', 'pt'] }],
      routing: { prefixDefaultLocale: false },
    };
    const integration = askMySite({ embeddingModel: mockEmbeddingModel(), indexFile: '/ask.json' });
    const { read } = await build(integration, pages, { i18n });
    expect((await read('ask.json')).documents.map((d) => d.url)).toEqual(['/']);
    expect((await read('es/ask.json')).documents.map((d) => d.url)).toEqual(['/es/']);
    expect((await read('pt/ask.json')).documents.map((d) => d.url)).toEqual(['/pt/guide/']);

    // With the default locale prefixed too, its pages get their own index.
    await rm(join(root, 'dist'), { recursive: true });
    const prefixed = { ...i18n, routing: { prefixDefaultLocale: true } };
    const { outDir } = await build(
      askMySite({ embeddingModel: mockEmbeddingModel() }),
      { 'en/start': page('Start', '<h1>Start</h1><p>English.</p>') },
      { i18n: prefixed },
    );
    expect(existsSync(join(outDir, 'en', 'ask-index.json'))).toBe(true);
    expect(existsSync(join(outDir, 'ask-index.json'))).toBe(false);
  });

  it('posts to ASK_ENDPOINT when set, and says how to get answers in astro dev', async () => {
    // The hint shows once per process.
    Reflect.deleteProperty(globalThis, Symbol.for('ask-my-site.devEndpointHint'));
    const logger = { info: vi.fn(), warn: vi.fn() };
    /** Runs the hooks of `astro dev`, with the routes the site has. */
    const dev = async (integration: AstroIntegration, routes: { patternRegex: RegExp }[]) => {
      const hooks = integration.hooks as Record<string, (options: unknown) => unknown>;
      const injected: string[] = [];
      await hooks['astro:config:setup']?.({
        command: 'dev',
        injectScript: (_: string, content: string) => injected.push(content),
        updateConfig: vi.fn(),
        logger,
      });
      await hooks['astro:routes:resolved']?.({ routes, logger });
      await hooks['astro:server:start']?.({ logger });
      return injected;
    };

    // An SSR site that serves the endpoint itself needs no hint.
    await dev(askMySite({ embeddingModel: null }), [{ patternRegex: /^\/api\/ask\/?$/ }]);
    expect(logger.info).not.toHaveBeenCalled();
    // A static site does not serve it.
    await dev(askMySite({ embeddingModel: null }), [{ patternRegex: /^\/guide\/?$/ }]);
    expect(logger.info).toHaveBeenCalledWith(
      'The dialog posts to /api/ask, which astro dev does not serve. For answers while you work, build the site once, run `npx ask-my-site dev`, and start the site with ASK_ENDPOINT=http://localhost:8787/api/ask.',
    );

    vi.stubEnv('ASK_ENDPOINT', 'http://localhost:8787/api/ask');
    const [, script] = await dev(askMySite({ embeddingModel: null }), []);
    expect(script).toContain('mountAskDialog({"endpoint":"http://localhost:8787/api/ask"});');
  });

  it('passes embeddingProviderOptions to the default OpenAI and AI Gateway models', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const body = JSON.parse(init?.body as string) as { input?: string[]; values?: string[] };
        requests.push({ url, body });
        const vectors = (body.input ?? body.values ?? []).map((_, i) => [1, i, 0, 0]);
        return Promise.resolve(
          Response.json(
            url.startsWith('https://api.openai.com/')
              ? { data: vectors.map((embedding) => ({ embedding })) }
              : { embeddings: vectors },
          ),
        );
      }),
    );
    const options = { embeddingProviderOptions: { openai: { dimensions: 4 } } };

    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const { read } = await build(askMySite(options), PAGES);
    expect(requests.at(-1)).toMatchObject({
      url: 'https://api.openai.com/v1/embeddings',
      body: { model: 'text-embedding-3-small', dimensions: 4 },
    });
    expect((await read()).embedding).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: 4,
    });

    await rm(join(root, 'node_modules'), { recursive: true });
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-test');
    await build(askMySite(options), PAGES);
    expect(requests.at(-1)).toMatchObject({
      url: expect.stringMatching(/\/embedding-model$/) as string,
      body: { providerOptions: { openai: { dimensions: 4 } } },
    });
  });

  it('blanks "use client" in Radix and cmdk only, keeping source positions', async () => {
    const { updateConfig } = await build(askMySite({ embeddingModel: null }), PAGES);
    const [[{ vite }]] = updateConfig.mock.calls as [
      [
        {
          vite: { plugins: { transform: (code: string, id: string) => { code: string } | null }[] };
        },
      ],
    ];
    const [plugin] = vite.plugins;
    const code = '"use client";\nexport const x = 1;';
    const radix = plugin!.transform(
      code,
      '/app/node_modules/.pnpm/x/node_modules/@radix-ui/react-dialog/dist/index.mjs',
    );
    expect(radix?.code).toBe(`${' '.repeat(13)}\nexport const x = 1;`);
    expect(
      plugin!.transform(code, 'C:\\app\\node_modules\\cmdk\\dist\\index.mjs')?.code,
    ).toHaveLength(code.length);
    expect(plugin!.transform(code, '/app/node_modules/some-lib/index.mjs')).toBeNull();
    expect(
      plugin!.transform('export const x = 1;', '/app/node_modules/cmdk/dist/index.mjs'),
    ).toBeNull();
  });
});
