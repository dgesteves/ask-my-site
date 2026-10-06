import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getDoc, getDocs } from '../../../lib/docs';

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getDocs()).map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata(props: PageProps<'/docs/[slug]'>): Promise<Metadata> {
  const doc = await getDoc((await props.params).slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage(props: PageProps<'/docs/[slug]'>) {
  const doc = await getDoc((await props.params).slug);
  if (!doc) notFound();
  const toc = doc.headings.filter((heading) => heading.depth === 2);
  return (
    <div className="doc-layout">
      <article className="doc">
        <h1>{doc.title}</h1>
        {doc.description ? <p className="lead">{doc.description}</p> : null}
        <div className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
      </article>
      {toc.length > 0 ? (
        <nav aria-label="On this page" className="toc">
          <p className="sidebar-heading">On this page</p>
          <ul>
            {toc.map((heading) => (
              <li key={heading.id}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
