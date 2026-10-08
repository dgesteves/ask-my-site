/**
 * ask-my-site/starlight: a Starlight plugin. After `astro build` it indexes what Starlight's own
 * search indexes, the region Starlight marks `data-pagefind-body` on each page, into
 * `ask-index.json` in the build output (one per locale), and it adds the ask dialog to every
 * page, opened from a floating button or ⌘/Ctrl+I.
 *
 * The answers come from an endpoint you deploy next to the site (a function running
 * `createAskHandler` from `ask-my-site/server`); see the README.
 */

import type { StarlightPlugin, StarlightUserConfig } from '@astrojs/starlight/types';

import { createIntegration, type AskMySiteOptions } from '../astro/integration';

export type { AskMySiteDialogOptions } from '../astro/integration';

/**
 * The Astro integration's options, without `content` and `ignore`: the plugin indexes what
 * Starlight's search does. Leave anything else out by marking it `data-pagefind-ignore`.
 */
export type AskMySiteStarlightOptions = Omit<AskMySiteOptions, 'content' | 'ignore'>;

/**
 * ```ts
 * // astro.config.mjs
 * import starlight from '@astrojs/starlight';
 * import askMySite from 'ask-my-site/starlight';
 *
 * export default defineConfig({
 *   integrations: [starlight({ title: 'Docs', plugins: [askMySite({ endpoint: '/api/ask' })] })],
 * });
 * ```
 */
export default function askMySite(options: AskMySiteStarlightOptions = {}): StarlightPlugin {
  return {
    name: 'ask-my-site',
    hooks: {
      'config:setup'({ config, addIntegration }) {
        addIntegration(
          createIntegration(options, {
            // Starlight puts the page title, its Markdown and the page footer (edit link, last
            // updated, pagination; footers are never indexed) in `<main data-pagefind-body>`,
            // except on 404 pages and pages with `pagefind: false`. Heading anchors' labels and
            // banners are `data-pagefind-ignore`; `.sr-only` is text for screen readers, such as
            // a code block's "Terminal window".
            content: '[data-pagefind-body]',
            ignore: '[data-pagefind-ignore], .sr-only',
            stylesheets: ['ask-my-site/starlight/launcher.css'],
            title: `Ask ${siteTitle(config)}`,
            // Starlight serves each locale but the root one under its key: /fr/, /pt-br/.
            ...(config.locales
              ? { locales: Object.keys(config.locales).filter((key) => key !== 'root') }
              : {}),
          }),
        );
      },
    },
  };
}

/** The site title, in the default locale's language when it is translated. */
function siteTitle({ title, locales, defaultLocale }: StarlightUserConfig): string {
  if (typeof title === 'string') return title;
  const lang = (locales?.root ?? (defaultLocale ? locales?.[defaultLocale] : undefined))?.lang;
  return (lang ? title[lang] : undefined) ?? Object.values(title)[0] ?? 'this site';
}
