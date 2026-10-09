import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import 'ask-my-site/react/styles.css';
import './globals.css';

import { mode } from '../lib/ai';
import { getSections } from '../lib/docs';
import { Ask } from './ask';
import { Sidebar } from './sidebar';

export const metadata: Metadata = {
  title: { default: 'ask-my-site example', template: '%s · ask-my-site example' },
  description:
    'A docs site that indexes itself at build time and answers questions with citations.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sections = await getSections();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="brand">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
                fill="currentColor"
              />
            </svg>
            ask-my-site
            <span className="brand-tag">example</span>
          </Link>
          <div className="header-actions">
            <a className="header-link" href="https://github.com/dgesteves/ask-my-site">
              GitHub
            </a>
            <Ask mode={mode} />
          </div>
        </header>
        <div className="shell">
          <Sidebar sections={sections} />
          <main id="content" className="content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
