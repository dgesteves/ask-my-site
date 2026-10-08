// Stand-ins for the client modules Docusaurus gives theme components at build time, aliased in
// vitest.config.ts.
import type { ReactNode } from 'react';

export default function BrowserOnly({ children }: { children: () => ReactNode }): ReactNode {
  return children();
}

export function useHistory(): { push: (url: string) => void } {
  return { push: () => undefined };
}

/** What `useAllPluginInstancesData` returns, by plugin instance id. */
export const globalData: { instances: Record<string, unknown> } = { instances: {} };

export function useAllPluginInstancesData(): Record<string, unknown> {
  return globalData.instances;
}
