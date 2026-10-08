/**
 * ask-my-site/embed: the ask dialog on any page, without writing React. `mountAskDialog` renders
 * it with a floating "Ask AI" button into the page, and the prebuilt `dist/embed.global.js` does
 * the same from a `<script>` tag, React included.
 *
 * Import `ask-my-site/react/styles.css` and `ask-my-site/embed/launcher.css` for the default look.
 */

import { useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { AskWithLauncher, useColorScheme } from '../react/launcher';
import type { AskMySiteDialogOptions, AskMySiteTheme } from './options';

export type { AskMySiteDialogOptions, AskMySiteTheme } from './options';

export interface MountAskDialogOptions extends AskMySiteDialogOptions {
  /** URL the dialog posts questions to. Default `/api/ask`. */
  endpoint?: string;
  /** Default `auto`: the page's `data-theme` on `<html>` if it has one, else the system's. */
  theme?: AskMySiteTheme;
  /** Extra request headers, e.g. an auth token. */
  headers?: Record<string, string>;
  /** Where to render. Default: a new `<div class="ask-my-site">` at the end of `<body>`. */
  container?: Element;
  /**
   * Called when a citation or source is clicked. Call `event.preventDefault()` to route with
   * your own router; otherwise the link navigates. The dialog closes either way.
   */
  onNavigate?: (url: string, event: MouseEvent) => void;
}

export interface MountedAskDialog {
  open: () => void;
  close: () => void;
  /** Removes the dialog, the button and, if it created it, the container. */
  unmount: () => void;
}

interface OpenState {
  subscribe: (listener: () => void) => () => void;
  get: () => boolean;
  set: (open: boolean) => void;
}

function openState(): OpenState {
  let open = false;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => open,
    set: (next) => {
      open = next;
      for (const listener of listeners) listener();
    },
  };
}

function Embedded({
  state,
  theme,
  onNavigate,
  ...props
}: Omit<MountAskDialogOptions, 'container' | 'endpoint'> & {
  endpoint: string;
  state: OpenState;
}): ReactNode {
  const open = useSyncExternalStore(state.subscribe, state.get, state.get);
  return (
    <AskWithLauncher
      {...props}
      theme={useColorScheme(theme)}
      open={open}
      onOpenChange={state.set}
      {...(onNavigate
        ? {
            onNavigate: (url, event) => {
              onNavigate(url, event.nativeEvent);
            },
          }
        : {})}
    />
  );
}

/**
 * Renders the ask dialog and its launcher into the page (a container of its own at the end of
 * `<body>`, unless you pass one) and returns controls for it. In the browser only.
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
  const { container: given, endpoint = '/api/ask', ...rest } = options;
  const container = given ?? document.createElement('div');
  // Astro's <ClientRouter /> replaces <body> on navigation, and the dialog's container with it.
  const reattach = () => {
    if (!container.isConnected) document.body.append(container);
  };
  if (!given) {
    container.className = 'ask-my-site';
    document.body.append(container);
    document.addEventListener('astro:after-swap', reattach);
  }
  const state = openState();
  const root = createRoot(container);
  root.render(<Embedded {...rest} endpoint={endpoint} state={state} />);
  return {
    open: () => {
      state.set(true);
    },
    close: () => {
      state.set(false);
    },
    unmount: () => {
      root.unmount();
      if (!given) {
        document.removeEventListener('astro:after-swap', reattach);
        container.remove();
      }
    },
  };
}
