# ask-my-site

## 0.3.0

### Minor Changes

- [#4](https://github.com/dgesteves/ask-my-site/pull/4) [`20a74bc`](https://github.com/dgesteves/ask-my-site/commit/20a74bc596e624ff82ddd71c3175b74ecb1f5d57) Thanks [@dgesteves](https://github.com/dgesteves)! - Add `ask-my-site/docusaurus`, a Docusaurus 3 plugin. After `docusaurus build` it indexes the docs, blog posts and MDX pages into `build/ask-index.json` (one per locale) at the URLs Docusaurus generated: each page's Markdown, without breadcrumbs, doc cards or a post's byline, and without the pages that only list others (blog lists, tag and author pages, generated category indexes). It reuses the previous build's vectors for unchanged pages from `node_modules/.cache`, embeds with OpenAI or AI Gateway when their keys are set at build time, and builds a keyword-only index (with a warning) otherwise. In the browser it renders the ask dialog from `@theme/AskMySite`: a floating "Ask AI" button beside the back-to-top button and ⌘/Ctrl+I, the site's light or dark mode, and citations routed without a reload. The README has endpoint recipes for Vercel, Netlify and Cloudflare Pages, and `examples/docusaurus` is a working site.
  
  Also: `fromHtml` takes `root: 'article'` to read a page's outermost `<article>`s before `<main>`, without the articles nested in them; it reads an element up to its own closing tag rather than a nested one's; and heading permalinks made of a literal zero-width space (as Docusaurus writes them) are no longer kept in heading text. `AskDialog`'s shortcut no longer opens the dialog while a text field or editor has focus.

## 0.2.0

### Minor Changes

- [#2](https://github.com/dgesteves/ask-my-site/pull/2) [`7bf831b`](https://github.com/dgesteves/ask-my-site/commit/7bf831b4d907e809257c09ad8c07acc40292aa1e) Thanks [@dgesteves](https://github.com/dgesteves)! - Derive page URLs the way docs frameworks do, so citations land on real pages. The CLI detects the framework from its config in or above the content folder (following links) and says which it picked; `--framework`, or `framework` in a config module, overrides it. The `loadDirectory` option defaults to `'none'`, so library callers keep today's URLs unless they ask (`'auto'` detects as the CLI does).
  
  - Docusaurus: `slug` frontmatter (absolute, or resolved against the page's folder, `../` included) and `id`; number prefixes dropped as Docusaurus's own parser does (not on dates or versions such as `2024-12-recap` or `1.0-release`), unless `parse_number_prefixes: false`; `index`, `README` or a file named like its folder as the folder's page; `_` partials skipped. All 92 pages of docusaurus.io's docs now get the URL Docusaurus serves; before, pages with a `slug`, most of them, got URLs that 404.
  - Starlight: `slug` frontmatter, slugified path segments, `index` as the folder's page, `_` files skipped.
  - Next.js-style content (Fumadocs, Nextra): `(group)` route folders left out of URLs, and `page.mdx` as its folder's page.
  - Everywhere: Hugo's `_index.md` stands for its folder, like `index.md`.
  
  Indexes built from such sites change URLs, so `--check` reports them as stale until they are rebuilt.

## 0.1.0

### Minor Changes

- [`64c3c5b`](https://github.com/dgesteves/ask-my-site/commit/64c3c5b1c167234b0853c8160d5509ce0a486827) Thanks [@dgesteves](https://github.com/dgesteves)! - Initial release: build-time indexing CLI with an offline `--check` mode, int8 static index, hybrid BM25 + vector retrieval with reciprocal rank fusion and a relevance gate, a Web-standard streaming `createAskHandler`, the `AskDialog` command palette and `useAsk` hook, and deterministic mock models for keyless runs.

### Patch Changes

- [`0791182`](https://github.com/dgesteves/ask-my-site/commit/07911827d4949574507ee687bb28dc96eb039d0f) Thanks [@dgesteves](https://github.com/dgesteves)! - Security and robustness fixes before the first release:
  
  - Rate limits key on one client IP header: the last `X-Forwarded-For` entry by default, or the header your platform sets via the new `trustedHeader` option. A client can no longer pick its own key by sending another platform's header. See "Rate limits and client IPs" in the README.
  - Prompts wrap sources and the question in tags with a random per-request suffix, and pass content through verbatim (`<source>` elements in docs are no longer rewritten).
  - The handler answers 415 to bodies that are not `application/json`, so other sites cannot post to it without a CORS preflight.
  - A throwing `rateLimit` gets a JSON 503 by default (`rateLimitFailure: 'open'` answers anyway), a throwing `onFinish` no longer turns into a stream error, and generation timeouts are reported to `onError`.
  - `useAsk` exposes `truncated` for answers cut off at the output limit, and `AskDialog` says so and cancels the request when it closes.
  - `safeHref` allows bare relative URLs such as `docs/a`.
  - The CLI never ignores `--dimensions`; file names are NFC-normalized, symlinks are followed, and `--ignore` no longer relies on the experimental `path.matchesGlob` on Node 22.
  - Loaders run in linear time on unclosed tags, labels and comments, and heading anchors match github-slugger exactly.
  - `@radix-ui/react-dialog` and `cmdk` are optional peer dependencies: install them to use `ask-my-site/react`.
