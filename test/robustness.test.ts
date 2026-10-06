import { describe, expect, it } from 'vitest';

import { chunkDocument, fromHtml, fromMarkdown, slugify } from '../src';
import type { SourceDocument } from '../src';

const doc = (content: string, title = 'Page'): SourceDocument => ({
  id: 'page.md',
  url: '/page',
  title,
  content,
});

/** Runs `fn` and returns how long it took, in milliseconds. */
function timed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('linear-time parsing of hostile input', () => {
  it('parses headings with long whitespace runs quickly', () => {
    const line = `# a${' \t'.repeat(20_000)}b`;
    expect(timed(() => chunkDocument(doc(line)))).toBeLessThan(250);
    expect(timed(() => fromMarkdown(line, { id: 'x', url: '/x' }))).toBeLessThan(250);
  });

  it('handles long backtick runs and unclosed tags quickly', () => {
    const backticks = 'a'.concat('`'.repeat(20_000), ' b');
    expect(timed(() => fromMarkdown(backticks, { id: 'x', url: '/x' }))).toBeLessThan(250);
    const metas = '<meta name=robots '.repeat(5_000);
    expect(timed(() => fromHtml(metas, { id: 'x', url: '/x' }))).toBeLessThan(250);
  });
});

describe('headings', () => {
  it('keeps a trailing # that is part of the text, and strips real closing sequences', () => {
    const chunks = chunkDocument(doc('## C#\n\nA.\n\n## F# and C# ##\n\nB.\n\n## Done ###\n\nC.'));
    expect(chunks.map((c) => c.heading)).toEqual(['C#', 'F# and C#', 'Done']);
    expect(fromMarkdown('# C#\n\nBody', { id: 'x', url: '/x' })?.title).toBe('C#');
  });

  it('slugs underscores like GitHub: kept inside words and code, dropped as emphasis', () => {
    expect(slugify('`max_tokens`')).toBe('max_tokens');
    expect(slugify('snake_case_name')).toBe('snake_case_name');
    expect(slugify('`__init__` method')).toBe('__init__-method');
    expect(slugify('_emphasis_ and __strong__')).toBe('emphasis-and-strong');
    const [chunk] = chunkDocument(doc('## `max_tokens`\n\nBody.'));
    expect(chunk).toMatchObject({ heading: 'max_tokens', anchor: 'max_tokens' });
  });

  it('accepts explicit ids with dots, colons and non-ASCII letters', () => {
    const chunks = chunkDocument(
      doc('## new {#method.new}\n\nA.\n\n## Über uns {#über:uns}\n\nB.'),
    );
    expect(chunks.map((c) => [c.heading, c.anchor])).toEqual([
      ['new', 'method.new'],
      ['Über uns', 'über:uns'],
    ]);
  });

  it('does not treat #hashtags or empty headings as structure', () => {
    const chunks = chunkDocument(doc('#hashtag line\n\n##\n\nText.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe('');
  });
});

describe('fenced code', () => {
  it('does not open a fence on a line of inline triple-backtick code', () => {
    const chunks = chunkDocument(doc('```npm i foo```\n\n## Next\n\nStill a section.'));
    expect(chunks.map((c) => c.heading)).toEqual(['', 'Next']);
  });

  it('closes a fence indented differently from its opener, in the loader and the chunker', () => {
    const source = '```js\nconst a = 1;\n  ```\n\n<!-- private note -->\n\n## After\n\nText.';
    const document = fromMarkdown(source, { id: 'x', url: '/x' });
    expect(document?.content).not.toContain('private note');
    expect(chunkDocument(document!).map((c) => c.heading)).toEqual(['', 'After']);
  });

  it('re-fences split code and never carries a fence line through overlap', () => {
    const code = [
      '```ts',
      ...Array.from({ length: 30 }, (_, i) => `const value${String(i)} = compute(${String(i)});`),
      '```',
    ].join('\n');
    const chunks = chunkDocument(
      doc(`Intro prose that ends here.\n\n${code}\n\nAfter the code, a sentence of prose follows.`),
      { maxChars: 400, overlap: 150 },
    );
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(400);
      // Every chunk's fences pair up: an opener with a language, then a bare closer.
      const fences = chunk.text.split('\n').filter((line) => line.startsWith('```'));
      expect(fences.length % 2).toBe(0);
      for (let i = 0; i < fences.length; i += 2)
        expect([fences[i], fences[i + 1]]).toEqual(['```ts', '```']);
    }
    const all = chunks.map((c) => c.text).join('\n');
    for (let i = 0; i < 30; i += 1)
      expect(all).toContain(`const value${String(i)} = compute(${String(i)});`);
  });
});

describe('HTML loader', () => {
  it('does not mistake custom elements for the built-in tags it drops', () => {
    const page =
      '<main><p>Intro.</p><nav-link>Docs</nav-link><h2 id="install">Install</h2><p>Run npm i.</p>' +
      '<button-group><span>Kept</span></button-group><nav>menu</nav><p>End.</p></main>';
    const content = fromHtml(page, { id: 'x', url: '/x' })?.content ?? '';
    expect(content).toContain('## Install {#install}');
    expect(content).toContain('Run npm i.');
    expect(content).toContain('Kept');
    expect(content).not.toContain('menu');
  });

  it('reads every <article> when there is no <main>', () => {
    const page =
      '<body><article><h1>One</h1><p>First.</p></article><article><p>Second.</p></article></body>';
    const content = fromHtml(page, { id: 'x', url: '/x' })?.content ?? '';
    expect(content).toContain('First.');
    expect(content).toContain('Second.');
  });

  it('drops permalink anchors from headings and decodes Latin-1 entities', () => {
    const page =
      '<main><h2 id="getting-started">Getting Started <a class="header-anchor" href="#getting-started">&ZeroWidthSpace;</a></h2><p>Start.</p>' +
      '<h2 id="api">API <a href="#api">#</a></h2><p>Caf&eacute; &Eacute;t&eacute; &AMP; co.</p></main>';
    const document = fromHtml(page, { id: 'x', url: '/x' })!;
    expect(chunkDocument(document).map((c) => c.heading)).toEqual(['Getting Started', 'API']);
    expect(document.content).toContain('Café Été & co.');
  });

  it('fences <pre> blocks so code containing ``` cannot close them', () => {
    const page =
      '<main><h2>Example</h2><pre><code>```\n# not a heading\n```</code></pre><p>After.</p></main>';
    const chunks = chunkDocument(fromHtml(page, { id: 'x', url: '/x' })!);
    expect(chunks.map((c) => c.heading)).toEqual(['Example']);
    expect(chunks[0]?.text).toContain('# not a heading');
  });
});
