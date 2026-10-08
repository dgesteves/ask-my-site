/// <reference types="@docusaurus/module-type-aliases" />

import BrowserOnly from '@docusaurus/BrowserOnly';
import { useHistory } from '@docusaurus/router';
import { usePluginData } from '@docusaurus/useGlobalData';
import OriginalRoot from '@theme-init/Root';
import { useEffect, useState, type ReactNode } from 'react';

import type { AskMySiteGlobalData } from '../index';
import { AskDialog } from '../../react/index';

/**
 * Wraps the site with the ask dialog. `Root` sits outside Docusaurus's color mode provider, so the
 * dialog follows the `data-theme` attribute Docusaurus sets on `<html>` instead of its hook.
 */
export default function Root({ children }: { children: ReactNode }) {
  return (
    <OriginalRoot>
      {children}
      <BrowserOnly>{() => <Ask />}</BrowserOnly>
    </OriginalRoot>
  );
}

function Ask() {
  const { endpoint, dialog } = usePluginData('ask-my-site') as AskMySiteGlobalData;
  const history = useHistory();
  const theme = useDocusaurusTheme();
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
              <button type="button" className="ask-my-site-launcher">
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
