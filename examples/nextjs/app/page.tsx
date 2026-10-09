import Link from 'next/link';

import { mode } from '../lib/ai';
import { getSections } from '../lib/docs';

export default async function Home() {
  const sections = await getSections();
  return (
    <article className="home">
      <p className="eyebrow">Example app</p>
      <h1>These docs answer questions about themselves.</h1>
      <p className="lead">
        At build time, <code>ask-my-site index</code> turns the pages below into a static index. At
        request time, the ask endpoint searches it in memory and streams a cited answer. Press{' '}
        <kbd>⌘K</kbd> to try it.
      </p>
      <p className="mode-note">
        {mode === 'mock'
          ? 'Running in mock mode: deterministic embeddings and a scripted, extractive model. No API key needed.'
          : 'Running with OpenAI: text-embedding-3-small for retrieval and a chat model for answers.'}
      </p>
      {sections.map((section) => (
        <section key={section.title} className="card-section" aria-label={section.title}>
          <h2 className="sidebar-heading">{section.title}</h2>
          <ul className="cards">
            {section.docs.map((doc) => (
              <li key={doc.slug}>
                <Link href={`/docs/${doc.slug}`} className="card">
                  <span className="card-title">{doc.title}</span>
                  <span className="card-description">{doc.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
