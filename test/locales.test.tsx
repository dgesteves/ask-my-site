// @vitest-environment jsdom
// Locales: the dialog sends the page's locale, the handler answers from that locale's index, the
// Docusaurus plugin picks the build's locale, and the Astro and Starlight page script the page's.
import { act, cleanup, renderHook } from '@testing-library/react';
import type { AstroIntegration } from 'astro';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ondocsAstro from '../src/astro';
import { routeHandlers, serve, type RouteModule } from '../src/astro/route';
import { buildIndex, serializeIndexFile, type SourceDocument } from '../src';
import { configLocales } from '../src/cli/init';
import ondocsDocusaurus, { type OndocsGlobalData } from '../src/docusaurus';
import { mountWithLoader } from '../src/embed/mount';
import { mockLanguageModel } from '../src/mock';
import { useAsk } from '../src/react';
import { createAskHandler } from '../src/server';

const docs = (lang: 'en' | 'fr'): SourceDocument[] => [
  {
    id: 'install.md',
    url: lang === 'en' ? '/install' : '/fr/install',
    title: lang === 'en' ? 'Install' : 'Installation',
    content:
      lang === 'en'
        ? 'Install the package with npm and configure the plugin.'
        : 'Installez le paquet avec npm et configurez le plugin.',
  },
];
const english = (await buildIndex({ documents: docs('en') })).index;
const french = (await buildIndex({ documents: docs('fr') })).index;

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const handler = () =>
  createAskHandler({
    index: english,
    indexes: { fr: () => serializeIndexFile(french) },
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    rateLimit: false,
  });

describe('the handler', () => {
  it('answers from the index of the locale the dialog sends, and from index otherwise', async () => {
    const ask = handler();
    const post = (body: unknown) =>
      ask(
        new Request('http://localhost/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ).then((response) => response.text());
    expect(await post({ question: 'Installez le paquet npm', locale: 'fr' })).toContain(
      '"url":"/fr/install"',
    );
    expect(await post({ question: 'Install the package npm' })).toContain('"url":"/install"');
    // A locale with no index of its own is answered from `index`.
    expect(await post({ question: 'Install the package npm', locale: 'de' })).toContain(
      '"url":"/install"',
    );
    // The conversation's shape takes a locale too.
    expect(
      await post({
        locale: 'fr',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Installez le paquet npm' }] }],
      }),
    ).toContain('"url":"/fr/install"');
  });
});

describe('useAsk', () => {
  it('sends its locale with each question', async () => {
    const bodies: unknown[] = [];
    const ask = handler();
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
      const url = input instanceof Request ? input.url : input;
      return ask(new Request(new URL(url, 'http://localhost'), init));
    });
    const { result } = renderHook(() => useAsk({ fetch, locale: 'fr' }));
    await act(() => result.current.ask('Installez le paquet npm'));
    await act(() => result.current.ask('Et avec pnpm ?'));
    expect(bodies[0]).toEqual({ question: 'Installez le paquet npm', locale: 'fr' });
    expect(bodies[1]).toMatchObject({ locale: 'fr', messages: expect.any(Array) as unknown });
    expect(result.current.turns[0]?.sources[0]?.url).toBe('/fr/install');
  });
});

describe('the Docusaurus plugin', () => {
  const data = (currentLocale: string) => {
    const setGlobalData = vi.fn();
    ondocsDocusaurus(
      {
        siteDir: '/site',
        siteConfig: { title: 'Acme' },
        baseUrl: currentLocale === 'en' ? '/' : `/${currentLocale}/`,
        i18n: { currentLocale, defaultLocale: 'en' },
      },
      {
        embedding: 'none',
        dialog: {
          labels: { footer: 'Check the sources.' },
          suggestions: ['How do I install it?'],
          locales: {
            fr: {
              labels: { launcher: 'Demander', title: 'Demander à Acme' },
              suggestions: ['Comment l’installer ?'],
            },
          },
        },
      },
    ).contentLoaded({ actions: { setGlobalData } });
    return setGlobalData.mock.calls[0]?.[0] as OndocsGlobalData;
  };

  it('picks the build’s locale: its options over the dialog’s, and the locale to send', () => {
    expect(data('fr')).toMatchObject({
      locale: 'fr',
      dialog: {
        title: 'Demander à Acme',
        suggestions: ['Comment l’installer ?'],
        labels: { footer: 'Check the sources.', launcher: 'Demander', title: 'Demander à Acme' },
      },
    });
    expect(data('fr').dialog).not.toHaveProperty('locales');
    const base = data('en');
    expect(base.locale).toBeUndefined();
    expect(base.dialog).toMatchObject({ title: 'Ask Acme', suggestions: ['How do I install it?'] });
  });
});

describe('the Astro and Starlight page script', () => {
  /** The page script the integration injects, run at `pathname` with a stand-in mount. */
  function mountAt(integration: AstroIntegration, pathname: string, base = '/docs') {
    let script = '';
    const hook = integration.hooks['astro:config:setup'] as unknown as (options: unknown) => void;
    hook({
      config: {
        base,
        i18n: { defaultLocale: 'en', locales: ['en', 'fr', 'pt-br'] },
      },
      injectScript: (stage: string, content: string) => {
        if (stage === 'page') script = content;
      },
      updateConfig: () => undefined,
      logger: { info: () => undefined, warn: () => undefined },
    });
    const mounted: unknown[] = [];
    const body = script.replace(/^import .*$/m, '');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function('mountAskDialog', 'location', body) as (
      mount: (options: unknown) => void,
      location: { pathname: string },
    ) => void;
    run((options) => mounted.push(options), { pathname });
    return mounted[0] as Record<string, unknown>;
  }

  const integration = () =>
    ondocsAstro({
      embedding: 'none',
      dialog: {
        title: 'Ask Acme',
        locales: { fr: { labels: { launcher: 'Demander' }, title: 'Demander à Acme' } },
      },
    });

  it('picks the page’s locale from its path under base, and sends it', () => {
    expect(mountAt(integration(), '/docs/fr/guides/setup/')).toMatchObject({
      locale: 'fr',
      title: 'Demander à Acme',
      labels: { launcher: 'Demander' },
    });
    expect(mountAt(integration(), '/docs/pt-br')).toMatchObject({
      locale: 'pt-br',
      title: 'Ask Acme',
    });
    const root = mountAt(integration(), '/docs/guides/setup/');
    expect(root).not.toHaveProperty('locale');
    expect(root.title).toBe('Ask Acme');
    // `/docs/french-fries/` is not French.
    expect(mountAt(integration(), '/docs/french-fries/')).not.toHaveProperty('locale');
  });
});

describe('the Astro injected route', () => {
  it('answers each locale from its own index', async () => {
    const files: Record<string, string> = {
      '/docs/ask-index.json': serializeIndexFile(english),
      '/docs/fr/ask-index.json': serializeIndexFile(french),
    };
    const module: RouteModule = {
      settings: {
        siteName: 'Acme',
        indexPath: '/docs/ask-index.json',
        localeIndexPaths: { fr: '/docs/fr/ask-index.json' },
        rateLimit: false,
        mcpRateLimit: false,
        budget: false,
        answerCache: false,
      },
      chatModel: () => mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      openaiEmbedding: null,
      secret: () => undefined,
      assets: () => ({
        fetch: (request: Request) => {
          const text = files[new URL(request.url).pathname];
          return Promise.resolve(text ? new Response(text) : new Response(null, { status: 404 }));
        },
      }),
    };
    const handlers = routeHandlers(module);
    const request = new Request('https://acme.dev/docs/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Installez le paquet npm', locale: 'fr' }),
    });
    const response = await serve(handlers, 'ask', {
      request,
      url: new URL(request.url),
      clientAddress: '203.0.113.1',
      locals: {},
    });
    expect(await response.text()).toContain('"url":"/fr/install"');
  });
});

describe('the script embed’s button', () => {
  it('takes its label and the Ctrl key’s name from labels', () => {
    const mounted = mountWithLoader(
      { labels: { launcher: 'Demander', controlKey: 'Strg' } },
      () => new Promise(() => undefined),
    );
    const button = document.querySelector('.ondocs-launcher');
    expect(button?.textContent).toMatch(/^✦ Demander(Strg I|⌘I)$/);
    mounted.unmount();
  });
});

describe('init', () => {
  it('reads the locales a Docusaurus, Astro or Starlight config gives', () => {
    expect(
      configLocales("i18n: { defaultLocale: 'en', locales: ['en', 'fr', 'pt-BR'] },", false),
    ).toEqual(['fr', 'pt-BR']);
    expect(
      configLocales(
        "starlight({ title: 'Acme', locales: { root: { label: 'English', lang: 'en' }, fr: { label: 'Français' }, 'zh-cn': { label: '简体中文', lang: 'zh-CN' } }, sidebar: [] })",
        true,
      ),
    ).toEqual(['fr', 'zh-cn']);
    expect(configLocales("export default { title: 'Acme' }", false)).toEqual([]);
  });
});
