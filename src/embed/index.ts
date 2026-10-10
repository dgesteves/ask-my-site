/**
 * ask-my-site/embed: the ask dialog on any page, without writing React. `mountAskDialog` adds a
 * floating "Ask AI" button and the shortcut to the page, and loads the dialog (React, Radix and
 * cmdk, in a chunk of their own) the first time it is wanted: a pointer over or focus on the
 * button, the shortcut, or `open()`. The prebuilt `dist/embed.global.js` does the same from a
 * `<script>` tag.
 *
 * Import `ask-my-site/react/styles.css` and `ask-my-site/embed/launcher.css` for the default look.
 */

import { mountWithLoader, type MountAskDialogOptions, type MountedAskDialog } from './mount';

export type { AskMySiteDialogOptions, AskMySiteTheme } from './options';
export type { MountAskDialogOptions, MountedAskDialog } from './mount';

/**
 * Renders the ask dialog's launcher into the page (a container of its own at the end of
 * `<body>`, unless you pass one) and returns controls for it. The dialog's code loads on first
 * use. In the browser only.
 *
 * ```ts
 * import { mountAskDialog } from 'ask-my-site/embed';
 * import 'ask-my-site/react/styles.css';
 * import 'ask-my-site/embed/launcher.css';
 *
 * const ask = mountAskDialog({ endpoint: '/api/ask', suggestions: ['How do I install it?'] });
 * ```
 */
export function mountAskDialog(options: MountAskDialogOptions = {}): MountedAskDialog {
  return mountWithLoader(options, () => import('./dialog'));
}
