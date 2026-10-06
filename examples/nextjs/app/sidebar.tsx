'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { DocMeta } from '../lib/docs';

export function Sidebar({ docs }: { docs: DocMeta[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="sidebar">
      <p className="sidebar-heading">Documentation</p>
      <ul>
        {docs.map((doc) => {
          const href = `/docs/${doc.slug}`;
          const current = pathname === href;
          return (
            <li key={doc.slug}>
              <Link href={href} aria-current={current ? 'page' : undefined}>
                {doc.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
