import type { ReactNode } from 'react';

import { DocsMenu, Sidebar } from '../../components/docs-nav';
import { getSections } from '../../lib/docs';

import './docs.css';

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const sections = await getSections();
  return (
    <div className="shell">
      <Sidebar sections={sections} />
      <main id="content" className="content">
        <DocsMenu sections={sections} />
        {children}
      </main>
    </div>
  );
}
