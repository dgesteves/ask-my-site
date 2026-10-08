/// <reference types="@docusaurus/module-type-aliases" />

import AskMySite from '@theme/AskMySite';
import OriginalRoot from '@theme-init/Root';
import type { ReactNode } from 'react';

/**
 * Wraps the site's `Root` with the ask dialog. If another plugin also wraps `Root`, only one of
 * them is used: swizzle `Root` and render `<AskMySite />` from `@theme/AskMySite` there.
 */
export default function Root({ children }: { children: ReactNode }) {
  return (
    <OriginalRoot>
      {children}
      <AskMySite />
    </OriginalRoot>
  );
}
