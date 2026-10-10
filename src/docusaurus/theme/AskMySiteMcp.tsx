/// <reference types="@docusaurus/module-type-aliases" />

import OndocsMcp, { type Props } from '@theme/OndocsMcp';
import type { ReactNode } from 'react';

import { warnRenamed } from '../renamed';

export type { Props };

/**
 * `@theme/OndocsMcp` under its name from before ask-my-site became ondocs, for an MDX page that
 * still imports `@theme/AskMySiteMcp`. It renders the same block, and says once to import
 * `@theme/OndocsMcp` instead.
 *
 * @deprecated Import `OndocsMcp` from `@theme/OndocsMcp`.
 */
export default function AskMySiteMcp(props: Props): ReactNode {
  warnRenamed('@theme/AskMySiteMcp', '@theme/OndocsMcp');
  return <OndocsMcp {...props} />;
}
