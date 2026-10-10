/// <reference types="@docusaurus/module-type-aliases" />

import { useAllPluginInstancesData } from '@docusaurus/useGlobalData';
import type { ReactNode } from 'react';

import { McpInstall } from '../../react/mcp-install';
import type { AskMySiteGlobalData } from '../index';

export interface Props {
  /** The plugin instance to read, when the site uses more than one. Default: the first. */
  readonly pluginId?: string;
}

/**
 * How to connect an AI tool to the site's MCP endpoint (the plugin's `mcp` option): "Add to
 * Cursor", "Add to VS Code" and "Add to Claude" links, the Claude Code command and the JSON for
 * other clients. For an MDX page:
 *
 * ```mdx
 * import AskMySiteMcp from '@theme/AskMySiteMcp';
 *
 * <AskMySiteMcp />
 * ```
 *
 * Swizzle it to change what it shows. Without the `mcp` option it renders nothing.
 */
export default function AskMySiteMcp({ pluginId }: Props): ReactNode {
  const instances = useAllPluginInstancesData('ask-my-site') as
    Record<string, AskMySiteGlobalData | undefined> | undefined;
  const data = pluginId === undefined ? Object.values(instances ?? {})[0] : instances?.[pluginId];
  if (!data?.mcp) return null;
  return (
    <McpInstall
      url={data.mcp.url}
      name={data.mcp.name}
      buttonClassName="button button--secondary button--sm"
    />
  );
}
