/// <reference types="@docusaurus/module-type-aliases" />

import BrowserOnly from '@docusaurus/BrowserOnly';
import { useHistory } from '@docusaurus/router';
import { useAllPluginInstancesData } from '@docusaurus/useGlobalData';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { AskMySiteGlobalData } from '../index';
import { AskDialog } from '../../react/index';

export interface Props {
  /** The plugin instance to read, when the site uses more than one. Default: the first. */
  readonly pluginId?: string;
}

/**
 * The ask dialog and its floating launcher, rendered in the browser only. The plugin's `Root`
 * renders it; a site whose `Root` comes from another plugin can swizzle `Root` and render
 * `<AskMySite />` itself. Rendered twice, it shows once.
 */
export default function AskMySite({ pluginId }: Props): ReactNode {
  const instances = useAllPluginInstancesData('ask-my-site') as
    Record<string, AskMySiteGlobalData | undefined> | undefined;
  const data = pluginId === undefined ? Object.values(instances ?? {})[0] : instances?.[pluginId];
  if (!data) return null;
  return <BrowserOnly>{() => <Ask {...data} />}</BrowserOnly>;
}

function Ask({ endpoint, dialog }: AskMySiteGlobalData): ReactNode {
  const history = useHistory();
  const theme = useDocusaurusTheme();
  const first = useFirstInstance();
  if (!first) return null;

  const label = dialog.buttonLabel ?? 'Ask AI';
  const shortcut = dialog.shortcut ?? 'i';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <AskDialog
      endpoint={endpoint}
      title={dialog.title}
      shortcut={shortcut}
      theme={theme}
      {...(dialog.placeholder ? { placeholder: dialog.placeholder } : {})}
      {...(dialog.suggestions ? { suggestions: dialog.suggestions } : {})}
      onNavigate={(url, event) => {
        // Same-site links route without a full page load.
        if (url.startsWith('/') && !url.startsWith('//')) {
          event.preventDefault();
          history.push(url);
        }
      }}
      {...(label === false
        ? {}
        : {
            trigger: (
              <button
                type="button"
                className="ask-my-site-launcher"
                aria-keyshortcuts={
                  shortcut
                    ? `Meta+${shortcut.toUpperCase()} Control+${shortcut.toUpperCase()}`
                    : undefined
                }
              >
                <span aria-hidden="true">✦</span> {label}
                {shortcut ? (
                  <kbd aria-hidden="true">
                    {mac ? '⌘' : 'Ctrl '}
                    {shortcut.toUpperCase()}
                  </kbd>
                ) : null}
              </button>
            ),
          })}
    />
  );
}

/** The mounted instances, in mount order. */
const mounted: object[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether this is the first instance mounted, so a site that renders two shows one dialog. */
function useFirstInstance(): boolean {
  const [self] = useState(() => ({}));
  useEffect(() => {
    mounted.push(self);
    notify();
    return () => {
      mounted.splice(mounted.indexOf(self), 1);
      notify();
    };
  }, [self]);
  return useSyncExternalStore(
    subscribe,
    () => mounted[0] === self,
    () => false,
  );
}

/**
 * The site's color mode. `Root` sits outside Docusaurus's color mode provider, so this follows
 * the `data-theme` attribute Docusaurus sets on `<html>` instead of its hook.
 */
function useDocusaurusTheme(): 'light' | 'dark' {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(read());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return theme;
}
