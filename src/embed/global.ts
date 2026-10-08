// The prebuilt script embed, dist/embed.global.js: React, the dialog and its styles in one file,
// for sites that do not build with React.
//
//   <script src="https://cdn.jsdelivr.net/npm/ask-my-site@0/dist/embed.global.js"
//     data-endpoint="/api/ask" defer></script>
//
// Once the page has loaded it mounts the dialog with its tag's `data-*` attributes (see
// `scriptOptions`), unless the tag has `data-manual`. `window.AskMySite.mount(options)` mounts
// it by hand.
import dialogStyles from '../react/styles.css';
import { mountAskDialog, type MountAskDialogOptions, type MountedAskDialog } from './index';
import launcherStyles from './launcher.css';
import { scriptOptions } from './script';

declare global {
  interface Window {
    AskMySite?: { mount: (options?: MountAskDialogOptions) => MountedAskDialog };
  }
}

function mount(options?: MountAskDialogOptions): MountedAskDialog {
  if (!document.getElementById('ask-my-site-styles')) {
    const style = document.createElement('style');
    style.id = 'ask-my-site-styles';
    style.textContent = `${dialogStyles}\n${launcherStyles}`;
    // First in <head>, so the site's own stylesheets override it.
    document.head.prepend(style);
  }
  return mountAskDialog(options);
}

window.AskMySite = { mount };

// Only set while the script first runs, and only for a classic script (not type="module").
const script = document.currentScript;
if (script instanceof HTMLScriptElement && script.dataset.manual === undefined) {
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
