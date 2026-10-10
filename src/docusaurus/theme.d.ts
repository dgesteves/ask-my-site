// The theme component the plugin adds, for a site that swizzles `Root` and renders it there.
declare module '@theme/Ondocs' {
  import type { ReactNode } from 'react';

  export interface Props {
    /** The plugin instance to read, when the site uses more than one. Default: the first. */
    readonly pluginId?: string;
  }
  export default function Ondocs(props: Props): ReactNode;
}

// How to connect an AI tool to the site's MCP endpoint, for an MDX page.
declare module '@theme/OndocsMcp' {
  import type { ReactNode } from 'react';

  export interface Props {
    /** The plugin instance to read, when the site uses more than one. Default: the first. */
    readonly pluginId?: string;
  }
  export default function OndocsMcp(props: Props): ReactNode;
}

// The same two components under their names from before ask-my-site became ondocs. They still
// work, and say once to import the new names.
declare module '@theme/AskMySite' {
  import type { ReactNode } from 'react';
  import type { Props } from '@theme/Ondocs';

  export type { Props };
  /** @deprecated Import `Ondocs` from `@theme/Ondocs`. */
  export default function AskMySite(props: Props): ReactNode;
}

declare module '@theme/AskMySiteMcp' {
  import type { ReactNode } from 'react';
  import type { Props } from '@theme/OndocsMcp';

  export type { Props };
  /** @deprecated Import `OndocsMcp` from `@theme/OndocsMcp`. */
  export default function AskMySiteMcp(props: Props): ReactNode;
}
