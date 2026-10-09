import Link from 'next/link';

import { GITHUB_URL } from '../lib/site';
import { AskButton } from './ask';
import { GitHubIcon, Spark } from './icons';
import { NavLink } from './nav-link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="ask-my-site home">
          <span className="brand-mark">
            <Spark size={16} />
          </span>
          ask-my-site
        </Link>
        <nav aria-label="Site" className="header-nav">
          <NavLink href="/docs" className="header-link">
            Docs
          </NavLink>
          <a className="header-link header-github" href={GITHUB_URL} aria-label="GitHub">
            <GitHubIcon />
            <span>GitHub</span>
          </a>
          <AskButton className="header-ask" shortLabel="Ask">
            Ask the docs
          </AskButton>
        </nav>
      </div>
    </header>
  );
}
