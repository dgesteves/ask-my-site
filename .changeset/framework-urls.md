---
'ask-my-site': minor
---

Derive page URLs the way docs frameworks do, so citations land on real pages. The CLI detects the framework from its config in or above the content folder (following links) and says which it picked; `--framework`, or `framework` in a config module, overrides it. The `loadDirectory` option defaults to `'none'`, so library callers keep today's URLs unless they ask (`'auto'` detects as the CLI does).

- Docusaurus: `slug` frontmatter (absolute, or resolved against the page's folder, `../` included) and `id`; number prefixes dropped as Docusaurus's own parser does (not on dates or versions such as `2024-12-recap` or `1.0-release`), unless `parse_number_prefixes: false`; `index`, `README` or a file named like its folder as the folder's page; `_` partials skipped. All 92 pages of docusaurus.io's docs now get the URL Docusaurus serves; before, pages with a `slug`, most of them, got URLs that 404.
- Starlight: `slug` frontmatter, slugified path segments, `index` as the folder's page, `_` files skipped.
- Next.js-style content (Fumadocs, Nextra): `(group)` route folders left out of URLs, and `page.mdx` as its folder's page.
- Everywhere: Hugo's `_index.md` stands for its folder, like `index.md`.

Indexes built from such sites change URLs, so `--check` reports them as stale until they are rebuilt.
