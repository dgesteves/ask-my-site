import { describe, expect, it } from 'vitest';

import { chunkDocument, decodeEntities, fromDocuments, fromHtml, fromMarkdown } from '../src';

const meta = { id: 'docs/page.md', url: '/docs/page', fallbackTitle: 'Page' };

describe('fromMarkdown', () => {
  it('reads title and url from frontmatter', () => {
    const doc = fromMarkdown(
      '---\ntitle: "Install"\nurl: /start/install\ntags: [a, b]\n---\n\n# Ignored H1\n\nBody.',
      meta,
    );
    expect(doc).toMatchObject({ id: 'docs/page.md', title: 'Install', url: '/start/install' });
    expect(doc?.content).toBe('# Ignored H1\n\nBody.');
  });

  it('falls back to the first H1, then to the fallback title', () => {
    expect(fromMarkdown('Intro\n\n# The *Title*\n\nBody', meta)?.title).toBe('The Title');
    expect(fromMarkdown('```\n# not a title\n```\n\nBody', meta)?.title).toBe('Page');
    expect(fromMarkdown('---\npermalink: /p\n---\nx', meta)?.url).toBe('/p');
  });

  it('skips drafts and opted-out pages', () => {
    expect(fromMarkdown('---\ndraft: true\n---\nx', meta)).toBeNull();
    expect(fromMarkdown('---\nask: false\n---\nx', meta)).toBeNull();
    expect(fromMarkdown('---\nnoindex: true\n---\nx', meta)).toBeNull();
  });

  it('keeps link labels, image alt text and code, and drops HTML noise', () => {
    const doc = fromMarkdown(
      [
        'See [the guide](https://example.com/a_(b)) and ![a diagram](./d.png).',
        '<!-- hidden -->',
        '<details><summary>More</summary>Inside</details>',
        'Types like `Promise<string>` stay intact.',
        '',
        '```html',
        '<div class="kept">literal</div>',
        '```',
        '',
        '[ref]: https://example.com',
      ].join('\n'),
      meta,
    );
    expect(doc?.content).toContain('See the guide and a diagram.');
    expect(doc?.content).not.toContain('hidden');
    expect(doc?.content).toContain('MoreInside');
    expect(doc?.content).toContain('`Promise<string>`');
    expect(doc?.content).toContain('<div class="kept">literal</div>');
    expect(doc?.content).not.toContain('[ref]');
  });

  it.each([
    ['[a](x(y)z) b', 'a b'],
    ['[a](x(y) and [b](c) later', '[a](x(y) and b later'],
    ['[a](x(y', '[a](x(y'],
    ['[a]((b)', '[a]((b)'],
    ['![alt](i.png) [![badge](b.svg)](link)', 'alt badge'],
    ['[a[b](c)', 'a[b'],
    ['[x][ref] and [y][]', 'x and y'],
    ['[ref]: https://x\n  [r2]: /y "t"\n    [code]: z\nText.', '[code]: z\nText.'],
    ['See <!-- note --> this <!-- unclosed', 'See  this <!-- unclosed'],
  ])(
    'reads links, definitions and comments in %j as before the linear rewrite',
    (source, content) => {
      expect(fromMarkdown(source, meta)?.content).toBe(content);
    },
  );

  it('extracts text from MDX without evaluating it', () => {
    const doc = fromMarkdown(
      [
        "import { Callout } from '../components';",
        "export const meta = { section: 'x' };",
        '',
        '# Usage',
        '',
        '{/* editor note */}',
        '<Callout type="warn" icon={<Icon />}>Back up first.</Callout>',
        '<Diagram src="/a.svg" />',
        '',
        '```jsx',
        "import React from 'react';",
        '<Callout>kept in code</Callout>',
        '```',
      ].join('\n'),
      { ...meta, mdx: true },
    );
    expect(doc?.title).toBe('Usage');
    expect(doc?.content).not.toContain('import { Callout }');
    expect(doc?.content).not.toContain('editor note');
    expect(doc?.content).toContain('Back up first.');
    expect(doc?.content).not.toContain('<Diagram');
    expect(doc?.content).toContain("import React from 'react';");
    expect(doc?.content).toContain('<Callout>kept in code</Callout>');
  });
});

describe('fromHtml', () => {
  const page = `<!doctype html>
<html><head>
  <title>Install | Acme Docs</title>
  <style>.x { color: red }</style>
</head>
<body>
  <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
  <main>
    <h1>Install</h1>
    <p>Run the <code>acme</code> installer &mdash; it takes a minute.</p>
    <h2 id="requirements">Requirements &amp; limits</h2>
    <ul><li>Node 22+</li><li>2&nbsp;GB of RAM</li></ul>
    <pre><code>npm install acme
  --save</code></pre>
    <script>window.tracking = true;</script>
    <h2>Next steps</h2>
    <p>Read the <a href="/guide">guide</a>.</p>
  </main>
  <footer>© Acme</footer>
</body></html>`;

  it('extracts main content as Markdown-shaped text', () => {
    const doc = fromHtml(page, { id: 'install.html', url: '/install' });
    expect(doc?.title).toBe('Install');
    expect(doc?.content).toContain('Run the `acme` installer — it takes a minute.');
    expect(doc?.content).toContain('## Requirements & limits {#requirements}');
    expect(doc?.content).toContain('- Node 22+');
    expect(doc?.content).toContain('- 2 GB of RAM');
    expect(doc?.content).toContain('```\nnpm install acme\n  --save\n```');
    expect(doc?.content).not.toMatch(/tracking|color: red|Home|© Acme/);
  });

  it('feeds the chunker headings with the page’s own ids', () => {
    const doc = fromHtml(page, { id: 'install.html', url: '/install' });
    const chunks = chunkDocument(doc!);
    expect(chunks.map((c) => [c.heading, c.anchor])).toEqual([
      ['', undefined],
      ['Requirements & limits', 'requirements'],
      ['Next steps', 'next-steps'],
    ]);
  });

  it('falls back to <title>, honours robots noindex, decodes entities', () => {
    expect(fromHtml('<title>Only &amp; title</title><p>x</p>', { id: 'a', url: '/a' })?.title).toBe(
      'Only & title',
    );
    expect(
      fromHtml('<meta name="robots" content="noindex, nofollow"><p>x</p>', { id: 'a', url: '/a' }),
    ).toBeNull();
    expect(decodeEntities('&#x2192; &#8594; &rarr; &bogus;')).toBe('→ → → &bogus;');
  });
});

describe('fromHtml on unclosed elements', () => {
  it.each([
    [
      '<main><h2 id="x"><a href="#x"> ¶ </a>Title</h2><nav>menu</nav><p>Body <code>x</code></p><h3>open',
      '## Title {#x}\n\nBody `x`\n\nopen',
    ],
    ['<article>A</article><article>B', 'A'],
    ['<main>x<main>y</main>', 'xy'],
  ])('reads %j as before the linear rewrite', (source, content) => {
    expect(fromHtml(source, { id: 'a', url: '/a' })?.content).toBe(content);
  });
});

describe('fromHtml on nested elements', () => {
  it('reads an element up to its own closing tag, not a nested one’s', () => {
    const page =
      '<body><article><h1>Post</h1><p>Intro.</p><article><p>A comment.</p></article>' +
      '<p>Outro.</p></article></body>';
    const doc = fromHtml(page, { id: 'a', url: '/a' });
    expect(doc?.content).toBe('# Post\n\nIntro.\n\nA comment.\n\nOutro.');
    expect(
      fromHtml('<main><div><main><p>x</p></main><p>y</p></div></main>', { id: 'a', url: '/a' })
        ?.content,
    ).toBe('x\n\ny');
  });

  it('drops the articles nested in the root with root: article, and keeps what follows them', () => {
    // Docusaurus's <DocCardList>: a card per page, each an <article>.
    const card = (title: string) =>
      `<article class="col col--6"><a class=card href=/${title.toLowerCase()}><h2 title=${title}>📄️<!-- -->${title}</h2><p>About ${title}.</p></a></article>`;
    const page = `<main><article><h1>Reference</h1><p>Every option.</p><section class=row>${card('Alpha')}${card('Beta')}</section>
<h2 id=after>After the cards</h2><p>Still indexed.</p></article><nav>Next</nav></main>`;
    const doc = fromHtml(page, { id: 'a', url: '/a', root: 'article' })!;
    expect(doc.title).toBe('Reference');
    expect(doc.content).toBe(
      '# Reference\n\nEvery option.\n\n## After the cards {#after}\n\nStill indexed.',
    );
  });

  it('reads Docusaurus’s Markdown container with root: article, and the title from the page', () => {
    const doc = `<html><head><title>Setup | Acme</title></head><body><main><article>
<nav class=theme-doc-breadcrumbs>Home Guides</nav><span class="theme-doc-version-badge badge">Version: 1.0</span>
<div class="theme-doc-markdown markdown"><header><h1>Setup</h1></header><div><p>Install it.</p></div><div class=row><p>Then run it.</p></div></div>
<footer>Edit this page</footer></article></main></body></html>`;
    expect(fromHtml(doc, { id: 'a', url: '/a', root: 'article' })).toMatchObject({
      title: 'Setup',
      content: '# Setup\n\nInstall it.\n\nThen run it.',
    });

    // A blog post's <h1>, date and authors sit in a header outside its container.
    const post = `<html><head><title>Hello | Acme</title></head><body><main><article class="">
<header><h1 class=title_x>Hello</h1><div class=container><time>May 1, 2026</time> · <!-- -->One min read</div><div class=row><span>Jane Doe</span></div></header>
<div id=__blog-post-container class=markdown><p>First post.</div><footer>Tags: news</footer></article></main></body></html>`;
    expect(fromHtml(post, { id: 'b', url: '/b', root: 'article' })).toMatchObject({
      title: 'Hello',
      content: 'First post.',
    });
  });

  it('leaves other sites’ pages as they were', () => {
    // A `markdown` class alone is not Docusaurus's container, and the default root ignores it.
    const page =
      '<main><article><header><p>By Jane</p></header><div class=markdown><h1>Post</h1><p>Body.</p></div></article></main>';
    expect(fromHtml(page, { id: 'a', url: '/a', root: 'article' })?.content).toBe(
      'By Jane\n\n# Post\n\nBody.',
    );
    const docusaurus =
      '<main><article><nav>Home</nav><span>Version: 1.0</span><div class=theme-doc-markdown><p>Body.</p></div></article></main>';
    expect(fromHtml(docusaurus, { id: 'a', url: '/a' })?.content).toBe('Version: 1.0\n\nBody.');
  });
});

describe('fromDocuments', () => {
  it('validates records and rejects duplicates', () => {
    const docs = fromDocuments([{ id: 'a', url: '/a', title: 'A', content: 'x\r\ny' }]);
    expect(docs[0]?.content).toBe('x\ny');
    expect(() => fromDocuments([{ id: 'a', url: '/a', title: 'A' }])).toThrow(/content/);
    expect(() =>
      fromDocuments([
        { id: 'a', url: '/a', title: 'A', content: '' },
        { id: 'a', url: '/b', title: 'B', content: '' },
      ]),
    ).toThrow(/Duplicate/);
  });
});
