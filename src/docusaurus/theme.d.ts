// The theme component the plugin adds, for a site that swizzles `Root` and renders it there.
declare module '@theme/AskMySite' {
  import type { ReactNode } from 'react';

  export interface Props {
    /** The plugin instance to read, when the site uses more than one. Default: the first. */
    readonly pluginId?: string;
  }
  export default function AskMySite(props: Props): ReactNode;
}
