/**
 * ondocs/astro: an Astro integration. After `astro build` it indexes the pages the site
 * built into `ask-index.json` in the build output, at the URLs Astro serves them from, and it
 * adds the ask dialog to every page, opened from a floating button or ⌘/Ctrl+I.
 *
 * For a Starlight site, use `ondocs/starlight` instead. The answers come from an endpoint
 * you deploy next to the site (a function running `createAskHandler` from `ondocs/server`);
 * see the README.
 */

import type { AstroIntegration } from 'astro';

import { createIntegration, type OndocsDialogOptions, type OndocsOptions } from './integration';

export type { OndocsDialogOptions, OndocsOptions } from './integration';

/** @deprecated Use `OndocsOptions`. Its name from before ask-my-site became ondocs. */
export type AskMySiteOptions = OndocsOptions;
/** @deprecated Use `OndocsDialogOptions`. Its name from before ask-my-site became ondocs. */
export type AskMySiteDialogOptions = OndocsDialogOptions;

/**
 * ```ts
 * // astro.config.mjs
 * import ondocs from 'ondocs/astro';
 *
 * export default defineConfig({ integrations: [ondocs({ endpoint: '/api/ask' })] });
 * ```
 */
export default function ondocs(options: OndocsOptions = {}): AstroIntegration {
  return createIntegration(options, {});
}
