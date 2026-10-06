import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';

import { createSlugger, decodeEntities, parseFrontmatter } from 'ask-my-site';
import { Marked } from 'marked';

const DOCS_DIR = path.join(process.cwd(), 'content/docs');

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
}

export interface Doc extends DocMeta {
  html: string;
  headings: { depth: number; text: string; id: string }[];
}

async function readDoc(slug: string): Promise<{ meta: DocMeta; body: string } | null> {
  let source: string;
  try {
    source = await readFile(path.join(DOCS_DIR, `${slug}.md`), 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(source);
  return {
    meta: {
      slug,
      title: typeof data.title === 'string' ? data.title : slug,
      description: typeof data.description === 'string' ? data.description : '',
      order: typeof data.order === 'number' ? data.order : 99,
    },
    body,
  };
}

export const getDocs = cache(async (): Promise<DocMeta[]> => {
  const files = (await readdir(DOCS_DIR)).filter((file) => file.endsWith('.md'));
  const docs = await Promise.all(files.map((file) => readDoc(file.replace(/\.md$/, ''))));
  return docs
    .flatMap((doc) => (doc ? [doc.meta] : []))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
});

/**
 * Renders a page with heading ids from ask-my-site's own slugger, the one the chunker uses, so
 * every citation anchor in an answer lands on a heading that exists.
 */
export const getDoc = cache(async (slug: string): Promise<Doc | null> => {
  const doc = await readDoc(slug);
  if (!doc) return null;
  const slugify = createSlugger();
  const headings: Doc['headings'] = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth, text }) {
        const id = slugify(text);
        const label = decodeEntities(this.parser.parseInline(tokens).replace(/<[^>]+>/g, ''));
        headings.push({ depth, text: label, id });
        return `<h${String(depth)} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${this.parser.parseInline(tokens)}</h${String(depth)}>\n`;
      },
    },
  });
  const html = await marked.parse(doc.body);
  return { ...doc.meta, html, headings };
});
