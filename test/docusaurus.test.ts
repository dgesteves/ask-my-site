import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import askMySite from '../src/docusaurus';
import { parseIndexFile } from '../src/index-file';
import { mockEmbeddingModel } from '../src/mock';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ask-my-site-docusaurus-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** A page as Docusaurus builds it: chrome around an <article>, a TOC beside it in <main>. */
const page = (
  title: string,
  body: string,
) => `<!doctype html><html><head><title>${title} | Docs</title></head>
<body><nav class=navbar>Docs GitHub</nav><main><div class=row><div class=col>
<article><nav class=breadcrumbs>Home</nav><div class="theme-doc-markdown markdown"><header><h1>${title}</h1></header>
${body}</div><footer>Edit this page</footer></article>
<nav class=pagination-nav>Previous Next</nav></div>
<div class=col--3><div class=tableOfContents><ul><li><a href=#setup>Setup</a></li></ul></div></div></div></main>
<footer class=footer>Copyright</footer></body></html>`;

async function site(baseUrl = '/') {
  const outDir = join(root, 'build');
  const files: Record<string, string> = {
    'index.html': page('Introduction', '<p>Welcome to the docs.</p>'),
    'guides/setup/index.html': page(
      'Setup',
      '<h2 id=setup>Install<a href=#setup class=hash-link aria-label="Direct link">​</a></h2><p>Run the installer.</p>',
    ),
    // trailingSlash: false writes the route as a file.
    'guides/deploy.html': page('Deploy', '<p>Ship it.</p>'),
    'changelog/index.html': page('Changelog', '<p>1.0 released.</p>'),
    'landing/index.html': '<html><body><main><h1>Custom React page</h1></main></body></html>',
    '404.html': page('Page not found', '<p>Nothing here.</p>'),
  };
  for (const [file, html] of Object.entries(files)) {
    await mkdir(dirname(join(outDir, file)), { recursive: true });
    await writeFile(join(outDir, file), html);
  }
  const prefix = baseUrl.replace(/\/$/, '');
  const routesPaths = [
    '/',
    '/guides/setup',
    '/guides/deploy',
    '/changelog',
    '/landing',
    '/404.html',
  ].map((r) => (r === '/' ? baseUrl : `${prefix}${r}`));
  const context = {
    siteConfig: { title: 'Acme Docs', baseUrl },
    generatedFilesDir: join(root, '.docusaurus'),
  };
  return { outDir, routesPaths, context };
}

describe('ask-my-site/docusaurus', () => {
  it('indexes the built pages that have an article, at the URLs Docusaurus serves', async () => {
    const { outDir, routesPaths, context } = await site('/docs/');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const plugin = askMySite(context, {
      embeddingModel: mockEmbeddingModel(),
      exclude: ['/docs/changelog'],
    });
    await plugin.postBuild({ outDir, routesPaths });

    const index = parseIndexFile(await readFile(join(outDir, 'ask-index.json'), 'utf8'));
    expect(index.documents.map((d) => [d.url, d.title])).toEqual([
      ['/docs/', 'Introduction'],
      ['/docs/guides/deploy', 'Deploy'],
      ['/docs/guides/setup', 'Setup'],
    ]);
    const text = index.chunks.map((c) => c.text).join('\n');
    // The article only: no navbar, breadcrumbs, table of contents, pagination or footers.
    for (const chrome of ['GitHub', 'Home', 'Previous', 'Edit this page', 'Copyright']) {
      expect([chrome, text.includes(chrome)]).toEqual([chrome, false]);
    }
    // The heading permalink's zero-width space is not part of the heading.
    const setup = index.chunks.find((c) => c.anchor === 'setup');
    expect(setup?.heading).toBe('Install');
    expect(index.embedding?.model).toBe('mock-hash-512');
  });

  it('reuses the previous build’s vectors, and falls back to keyword-only with a warning', async () => {
    const { outDir, routesPaths, context } = await site();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const plugin = askMySite(context, { embeddingModel: mockEmbeddingModel() });
    await plugin.postBuild({ outDir, routesPaths });
    await plugin.postBuild({ outDir, routesPaths });
    expect(log.mock.calls.at(-1)?.[0]).toMatch(
      /^\[ask-my-site\] Indexed 4 pages into \d+ chunks, 0 embedded, \d+ reused → ask-index\.json/,
    );

    await askMySite(context).postBuild({ outDir, routesPaths });
    expect(warn.mock.calls[0]?.[0]).toContain('No embedding model: building a keyword-only index.');
    expect(
      parseIndexFile(await readFile(join(outDir, 'ask-index.json'), 'utf8')).embedding,
    ).toBeNull();
  });

  it('hands the dialog its settings, and points Docusaurus at files that exist', async () => {
    const { context } = await site();
    const plugin = askMySite(context, {
      endpoint: 'https://api.example.com/ask',
      dialog: { shortcut: false },
    });
    const setGlobalData = vi.fn();
    plugin.contentLoaded({ actions: { setGlobalData } });
    expect(setGlobalData).toHaveBeenCalledWith({
      endpoint: 'https://api.example.com/ask',
      dialog: { shortcut: false, title: 'Ask Acme Docs' },
    });
    expect(existsSync(join(plugin.getThemePath(), 'Root.tsx'))).toBe(true);
    expect(existsSync(plugin.getClientModules()[1]!)).toBe(true);
  });
});
