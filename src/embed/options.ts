/** What the dialog and its floating launcher show, in the embed and the framework plugins. */
export interface AskMySiteDialogOptions {
  /** The dialog's accessible name. */
  title?: string;
  placeholder?: string;
  /** Questions offered before the visitor types. */
  suggestions?: string[];
  /** Opens the dialog with ⌘ or Ctrl. Default `"i"`, so ⌘K stays with the site's search. `false` disables it. */
  shortcut?: string | false;
  /** The floating button's label. Default "Ask AI". `false` hides the button (open it with the shortcut). */
  buttonLabel?: string | false;
  /**
   * Which links in an answer stay links: `"all"` (the default), or `"sources"` for only links to
   * the pages the answer's sources are on, so injected text cannot show visitors another site's
   * link. Citations link to their sources either way.
   */
  links?: 'all' | 'sources';
}

/**
 * `auto` follows a `data-theme="light"` or `"dark"` on `<html>`, as Starlight and Docusaurus set
 * it, and `prefers-color-scheme` on a page without one, live in both cases.
 */
export type AskMySiteTheme = 'auto' | 'light' | 'dark';
