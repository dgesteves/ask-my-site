/**
 * ask-my-site/astro: an Astro integration. After `astro build` it indexes the pages the site
 * built into `ask-index.json` in the build output, at the URLs Astro serves them from, and it
 * adds the ask dialog to every page, opened from a floating button or ⌘/Ctrl+I.
 *
 * For a Starlight site, use `ask-my-site/starlight` instead. The answers come from an endpoint
 * you deploy next to the site (a function running `createAskHandler` from `ask-my-site/server`);
 * see the README.
 */

import type { AstroIntegration } from 'astro';

import { createIntegration, type AskMySiteOptions } from './integration';

export type { AskMySiteDialogOptions, AskMySiteOptions } from './integration';

/**
 * ```ts
 * // astro.config.mjs
 * import askMySite from 'ask-my-site/astro';
 *
 * export default defineConfig({ integrations: [askMySite({ endpoint: '/api/ask' })] });
 * ```
 */
export default function askMySite(options: AskMySiteOptions = {}): AstroIntegration {
  return createIntegration(options, {});
}
