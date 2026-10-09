'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { DocSection } from '../lib/docs';

export function Sidebar({ sections }: { sections: DocSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="sidebar">
      {sections.map((section) => (
        <div key={section.title} className="sidebar-section">
          <p className="sidebar-heading">{section.title}</p>
          <ul>
            {section.docs.map((doc) => {
              const href = `/docs/${doc.slug}`;
              return (
                <li key={doc.slug}>
                  <Link href={href} aria-current={pathname === href ? 'page' : undefined}>
                    {doc.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
