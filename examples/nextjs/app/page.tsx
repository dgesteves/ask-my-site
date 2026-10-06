import Link from 'next/link';

import { mode } from '../lib/ai';
import { getDocs } from '../lib/docs';

export default async function Home() {
  const docs = await getDocs();
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
      <ul className="cards">
        {docs.map((doc) => (
          <li key={doc.slug}>
            <Link href={`/docs/${doc.slug}`} className="card">
              <span className="card-title">{doc.title}</span>
              <span className="card-description">{doc.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
