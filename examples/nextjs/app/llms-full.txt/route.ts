import { getDocs, getDocSource } from '../../lib/docs';
import { SITE_URL } from '../../lib/site';

export const dynamic = 'force-static';

/** Every docs page as Markdown, in sidebar order, for a model to read in one request. */
export async function GET() {
  const docs = await getDocs();
  const pages = await Promise.all(
    docs.map(async (doc) => {
      const body = (await getDocSource(doc.slug)) ?? '';
      return `# ${doc.title}\n\nSource: ${SITE_URL}/docs/${doc.slug}\n\n${doc.description}\n\n${body.trim()}\n`;
    }),
  );
  return new Response(pages.join('\n---\n\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
