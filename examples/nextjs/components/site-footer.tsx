import Link from 'next/link';

import { GITHUB_URL, NPM_URL, VERSION } from '../lib/site';
import { Spark } from './icons';

const MORE = [
  {
    name: 'agent-ui-kit',
    href: 'https://agent-ui-kit-demo.vercel.app',
    description: 'React components for watching, approving and reviewing what an agent does.',
  },
  {
    name: 'design-system-mcp',
    href: 'https://design-system-mcp-demo.vercel.app',
    description: 'Your React design system as ground truth for coding agents.',
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-about">
          <p className="footer-brand">
            <span className="brand-mark">
              <Spark size={14} />
            </span>
            ask-my-site
          </p>
          <p>
            A self-hosted Ask AI box for docs sites. Version {VERSION}, MIT licensed, built by{' '}
            <a href="https://github.com/dgesteves">Diogo Esteves</a>.
          </p>
        </div>
        <nav aria-label="Project" className="footer-column">
          <p className="footer-heading">Project</p>
          <ul>
            <li>
              <Link href="/docs">Documentation</Link>
            </li>
            <li>
              <a href={GITHUB_URL}>GitHub</a>
            </li>
            <li>
              <a href={NPM_URL}>npm</a>
            </li>
            <li>
              <a href={`${GITHUB_URL}/releases`}>Releases</a>
            </li>
            <li>
              <a href={`${GITHUB_URL}/issues`}>Issues</a>
            </li>
          </ul>
        </nav>
        <nav aria-label="More by Diogo Esteves" className="footer-column footer-more">
          <p className="footer-heading">More by Diogo Esteves</p>
          <ul>
            {MORE.map((project) => (
              <li key={project.name}>
                <a href={project.href}>{project.name}</a>
                <span>{project.description}</span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
