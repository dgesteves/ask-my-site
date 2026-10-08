/// <reference types="@docusaurus/module-type-aliases" />

import BrowserOnly from '@docusaurus/BrowserOnly';
import { useHistory } from '@docusaurus/router';
import { useAllPluginInstancesData } from '@docusaurus/useGlobalData';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { AskMySiteGlobalData } from '../index';
import { AskWithLauncher, useColorScheme } from '../../react/launcher';

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
  // `Root` sits outside Docusaurus's color mode provider, so this follows the `data-theme`
  // attribute Docusaurus sets on `<html>` instead of its hook.
  const theme = useColorScheme('auto');
  const first = useFirstInstance();
  if (!first) return null;

  return (
    <AskWithLauncher
      {...dialog}
      endpoint={endpoint}
      theme={theme}
      onNavigate={(url, event) => {
        // Same-site links route without a full page load.
        if (url.startsWith('/') && !url.startsWith('//')) {
          event.preventDefault();
          history.push(url);
        }
      }}
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
