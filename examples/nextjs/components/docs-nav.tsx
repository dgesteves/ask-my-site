'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import type { DocSection } from '../lib/docs';

function DocsLinks({ sections, pathname }: { sections: DocSection[]; pathname: string }) {
  return sections.map((section) => (
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
  ));
}

/** The docs sidebar, from 800px up. */
export function Sidebar({ sections }: { sections: DocSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="sidebar">
      <DocsLinks sections={sections} pathname={pathname} />
    </nav>
  );
}

/** Below 800px: the same links behind a button that names the current page. */
export function DocsMenu({ sections }: { sections: DocSection[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const current = sections.flatMap((s) => s.docs).find((doc) => `/docs/${doc.slug}` === pathname);

  // Following a link closes the menu.
  if (open && openedAt !== pathname) {
    setOpen(false);
    setOpenedAt(pathname);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav aria-label="Documentation" className="docs-menu">
      <button
        ref={button}
        type="button"
        className="docs-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
          setOpenedAt(pathname);
        }}
      >
        <span className="docs-menu-label">
          <span className="docs-menu-kicker">Docs</span>
          <span>{current?.title ?? 'All pages'}</span>
        </span>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="chevron">
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div id={panelId} className="docs-menu-panel" hidden={!open}>
        <DocsLinks sections={sections} pathname={pathname} />
      </div>
    </nav>
  );
}
