import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import 'ask-my-site/react/styles.css';
import './globals.css';

import { Ask } from '../components/ask';
import { CopyButtons } from '../components/copy-buttons';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { mode } from '../lib/ai';
import { SITE_URL } from '../lib/site';

const description =
  'A self-hosted Ask AI box for docs sites: a build-time index, in-memory hybrid search and streamed answers with citations, from your own model key. No vector database, no hosted service.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ask-my-site: a self-hosted Ask AI box for docs',
    template: '%s · ask-my-site',
  },
  description,
  applicationName: 'ask-my-site',
  authors: [{ name: 'Diogo Esteves', url: 'https://github.com/dgesteves' }],
};

export const viewport: Viewport = {
  themeColor: '#0d0f12',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#content" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Ask mode={mode} />
        <CopyButtons />
      </body>
    </html>
  );
}
