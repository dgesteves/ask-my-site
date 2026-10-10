---
'ask-my-site': patch
---

Read heading ids written as MDX comments, `## Title {/* #custom-id */}`, which is how Docusaurus spells `{#custom-id}` in MDX. The MDX loader used to drop the comment and slug the heading text instead, so the CLI's citations missed the page's anchor for every such heading whose id is not its slug: 141 of the 702 indexed sections in docusaurus.io's own docs. And refuse to index a page whose URL is not a path or an http(s) URL: a frontmatter `url: "javascript:…"` (or `data:`, another scheme, `//host`) now fails the build, naming the page, instead of reaching the index. The dialog already refused to render such links.
