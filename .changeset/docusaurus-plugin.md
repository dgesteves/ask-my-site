---
'ask-my-site': minor
---

Add `ask-my-site/docusaurus`, a Docusaurus 3 plugin. After `docusaurus build` it indexes the docs, blog posts and MDX pages into `build/ask-index.json` (one per locale) at the URLs Docusaurus generated: each page's Markdown, without breadcrumbs, doc cards or a post's byline, and without the pages that only list others (blog lists, tag and author pages, generated category indexes). It reuses the previous build's vectors for unchanged pages from `node_modules/.cache`, embeds with OpenAI or AI Gateway when their keys are set at build time, and builds a keyword-only index (with a warning) otherwise. In the browser it renders the ask dialog from `@theme/AskMySite`: a floating "Ask AI" button beside the back-to-top button and ⌘/Ctrl+I, the site's light or dark mode, and citations routed without a reload. The README has endpoint recipes for Vercel, Netlify and Cloudflare Pages, and `examples/docusaurus` is a working site.

Also: `fromHtml` takes `root: 'article'` to read a page's outermost `<article>`s before `<main>`, without the articles nested in them; it reads an element up to its own closing tag rather than a nested one's; and heading permalinks made of a literal zero-width space (as Docusaurus writes them) are no longer kept in heading text. `AskDialog`'s shortcut no longer opens the dialog while a text field or editor has focus.
