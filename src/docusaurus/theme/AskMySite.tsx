/// <reference types="@docusaurus/module-type-aliases" />

import Ondocs, { type Props } from '@theme/Ondocs';
import type { ReactNode } from 'react';

import { warnRenamed } from '../renamed';

export type { Props };

/**
 * `@theme/Ondocs` under its name from before ask-my-site became ondocs, for a swizzled `Root`
 * that still renders `<AskMySite />`. It renders the same dialog, and says once to import
 * `@theme/Ondocs` instead.
 *
 * @deprecated Import `Ondocs` from `@theme/Ondocs`.
 */
export default function AskMySite(props: Props): ReactNode {
  warnRenamed('@theme/AskMySite', '@theme/Ondocs');
  return <Ondocs {...props} />;
}
