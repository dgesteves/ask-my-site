import { getSections } from '../../lib/docs';
import { GITHUB_URL, MCP_URL, SITE_URL } from '../../lib/site';

export const dynamic = 'force-static';

/**
 * The docs as an llms.txt index (llmstxt.org): one link per page, to its Markdown copy, grouped
 * as in the sidebar. The copies and llms-full.txt are written into public/ by `pnpm index`
 * (ask-my-site index --llms-txt public); this file is curated here, in the sidebar's order.
 */
export async function GET() {
  const sections = await getSections();
  const lines = [
    '# ask-my-site',
    '',
    '> A self-hosted "Ask AI" box for documentation sites: a build-time index, in-memory hybrid search (BM25 and vectors, fused with reciprocal rank fusion) and streamed answers with citations, from your own model key. No vector database, no hosted service. Plugins for Docusaurus, Astro and Starlight, React components for Next.js, and a script tag for any other site.',
    '',
    `Install with \`npm i ask-my-site\`. Source: ${GITHUB_URL}.`,
    '',
    'Each page links to its Markdown copy: its URL plus `.md`.',
    '',
    `Every page in one file: ${SITE_URL}/llms-full.txt`,
    '',
    `Agents can search these docs over MCP, with search, fetch and list_pages tools: ${MCP_URL}`,
    '',
    ...sections.flatMap((section) => [
      `## ${section.title}`,
      '',
      ...section.docs.map(
        (doc) => `- [${doc.title}](${SITE_URL}/docs/${doc.slug}.md): ${doc.description}`,
      ),
      '',
    ]),
  ];
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
