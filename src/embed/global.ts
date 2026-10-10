// The prebuilt script embed, dist/embed.global.js: the "Ask AI" button and the shortcut, with
// their styles, for sites that do not build with React. The dialog itself (React, Radix, cmdk and
// its styles) is dist/embed-dialog.global.js, next to this file, which it loads the first time
// the dialog is wanted.
//
//   <script src="https://cdn.jsdelivr.net/npm/ask-my-site@0/dist/embed.global.js"
//     data-endpoint="/api/ask" defer></script>
//
// Once the page has loaded it mounts with its tag's `data-*` attributes (see `scriptOptions`),
// unless the tag has `data-manual`. `window.AskMySite.mount(options)` mounts it by hand.
// `data-dialog-src` gives the dialog's URL, for a copy hosted elsewhere.
import launcherStyles from './launcher.css';
import {
  mountWithLoader,
  type DialogRenderer,
  type MountAskDialogOptions,
  type MountedAskDialog,
} from './mount';
import { scriptOptions } from './script';

declare global {
  interface Window {
    AskMySite?: { mount: (options?: MountAskDialogOptions) => MountedAskDialog };
    /** Set by dist/embed-dialog.global.js. */
    AskMySiteDialog?: DialogRenderer;
  }
}

// Only set while the script first runs, and only for a classic script (not type="module").
const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
const dialogSrc =
  script?.dataset.dialogSrc ??
  (script?.src ? new URL('embed-dialog.global.js', script.src).href : 'embed-dialog.global.js');

let dialog: Promise<DialogRenderer> | null = null;

/** Adds dist/embed-dialog.global.js to the page, once, and waits for it. */
function loadDialog(): Promise<DialogRenderer> {
  dialog ??= new Promise<DialogRenderer>((resolve, reject) => {
    if (window.AskMySiteDialog) {
      resolve(window.AskMySiteDialog);
      return;
    }
    const tag = document.createElement('script');
    tag.src = dialogSrc;
    tag.async = true;
    tag.addEventListener('load', () => {
      if (window.AskMySiteDialog) resolve(window.AskMySiteDialog);
      else reject(new Error(`${dialogSrc} did not define the dialog.`));
    });
    tag.addEventListener('error', () => {
      reject(new Error(`Could not load ${dialogSrc}.`));
    });
    document.head.append(tag);
  }).catch((error: unknown) => {
    dialog = null;
    throw error;
  });
  return dialog;
}

function mount(options?: MountAskDialogOptions): MountedAskDialog {
  if (!document.getElementById('ask-my-site-styles')) {
    const style = document.createElement('style');
    style.id = 'ask-my-site-styles';
    style.textContent = launcherStyles;
    // First in <head>, so the site's own stylesheets override it.
    document.head.prepend(style);
  }
  return mountWithLoader(options ?? {}, loadDialog);
}

window.AskMySite = { mount };

if (script && script.dataset.manual === undefined) {
  const options = scriptOptions(script.dataset);
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        mount(options);
      },
      { once: true },
    );
  } else {
    mount(options);
  }
}
