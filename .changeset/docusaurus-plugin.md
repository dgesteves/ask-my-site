---
'ask-my-site': minor
---

Add `ask-my-site/docusaurus`, a Docusaurus 3 plugin. After `docusaurus build` it indexes every route's `<article>` into `build/ask-index.json` at the URLs Docusaurus generated, reusing the previous build's vectors for unchanged pages, with OpenAI or AI Gateway embeddings when their keys are set at build time and a keyword-only index (with a warning) otherwise. In the browser it wraps the site's `Root` with the ask dialog: a floating "Ask AI" button and ⌘/Ctrl+I, the site's light or dark mode, and citations routed without a reload. The README has endpoint recipes for Vercel, Netlify and Cloudflare Pages, and `examples/docusaurus` is a working site.

Also: `fromHtml` takes `root: 'article'` to read a page's `<article>` before `<main>`, and heading permalinks made of a literal zero-width space (as Docusaurus writes them) are no longer kept in heading text.
