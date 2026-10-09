# ask-my-site

## 0.5.1

### Patch Changes

- [#20](https://github.com/dgesteves/ask-my-site/pull/20) [`fb222d9`](https://github.com/dgesteves/ask-my-site/commit/fb222d98600bf358b1b710c49fa13c29ecdd10ee) Thanks [@dgesteves](https://github.com/dgesteves)! - Code blocks in an answer now take keyboard focus, so a long line that scrolls sideways can be scrolled without a mouse, and they show a focus ring in the dialog's accent color. axe flagged them as scrollable regions that the keyboard could not reach.

- [#19](https://github.com/dgesteves/ask-my-site/pull/19) [`162cb14`](https://github.com/dgesteves/ask-my-site/commit/162cb14554ea83191f1bf590a693a47e722aaa40) Thanks [@dgesteves](https://github.com/dgesteves)! - `mockLanguageModel` answers better from the same sources. It weighs the question's rarer words over words every source shares, counts each source's title and heading, and leads with the best sentence, so "How do I deploy to Netlify?" quotes the Netlify section instead of a passing mention. A sentence that introduces a code block, a list or a table now quotes it too, so a "how do I" question gets the snippet. List items and table rows are no longer run together into one sentence, sentences are not split inside quotes, and what is left of a link ("See Deploying.") is skipped. It still quotes only the sources, and cites each.

## 0.5.0

### Minor Changes

- [#10](https://github.com/dgesteves/ask-my-site/pull/10) [`e8f6c08`](https://github.com/dgesteves/ask-my-site/commit/e8f6c082afac6441a4b96cc5037779407494e169) Thanks [@dgesteves](https://github.com/dgesteves)! - The Docusaurus, Astro and Starlight plugins post to `ASK_ENDPOINT` when it is set as the site builds or starts and no `endpoint` is given, so `ASK_ENDPOINT=http://localhost:8787/api/ask npm start` points the dialog at `ask-my-site dev` without editing the config. In `docusaurus start` and `astro dev`, when the dialog posts to a path on the site that the dev server does not serve, the plugins say once how to get answers with `ask-my-site dev`; the dialog's 404 warning in development says it too.

- [#10](https://github.com/dgesteves/ask-my-site/pull/10) [`487bd14`](https://github.com/dgesteves/ask-my-site/commit/487bd140c06957b9dbf09aa936f9e045713f2641) Thanks [@dgesteves](https://github.com/dgesteves)! - Add `ask-my-site dev`, the ask endpoint on your machine: `npx ask-my-site dev` serves `POST /api/ask` on port 8787 (`--port`), with CORS for any origin (`--origin` to list some), answering from `ask-index.json`, `build/ask-index.json` or `dist/ask-index.json` (`--index`), and picking up a rebuilt index on the next question. Questions are embedded as the index was: with the mock model for an index built with `-e mock`, with OpenAI or AI Gateway when the index was and the key is set, and not at all for a keyword-only index; an index it cannot match is refused with what would fix it. Answers come from OpenAI when `OPENAI_API_KEY` is set (`--model`, default `gpt-5.4-mini`), else from the mock model. On start it prints the endpoint and what to set to point the dialog at it.

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`d23dbe6`](https://github.com/dgesteves/ask-my-site/commit/d23dbe6a3b669e7526189f8b2e80f81af9c6c0ce) Thanks [@dgesteves](https://github.com/dgesteves)! - Add `launcher` to `AskDialog`: `<AskDialog launcher />` shows the floating "Ask AI" button with its shortcut that the Docusaurus, Astro and Starlight plugins and the script embed show, so a React site has something to click without writing a trigger (`launcher="Ask the docs"` sets its label). Style it with `ask-my-site/embed/launcher.css`, which now follows the system's color scheme when the dialog's theme is not pinned. It renders on the server without touching `navigator`.

### Patch Changes

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`d4326a3`](https://github.com/dgesteves/ask-my-site/commit/d4326a38d287a0bcfb34e6e37f596ac530564a29) Thanks [@dgesteves](https://github.com/dgesteves)! - `ask-my-site index` without an embedding model or an API key now suggests `--embedding mock` for trying it without a key.

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`392fc60`](https://github.com/dgesteves/ask-my-site/commit/392fc60045e23dd8829602eebb62209e3a7de1a7) Thanks [@dgesteves](https://github.com/dgesteves)! - Fix two accessibility failures axe found in the dialog. Once an answer showed, the input's `aria-controls` pointed at a list that was no longer rendered; the list now stays mounted, hidden and empty, while the answer shows. The `--ask-subtle` color (the sources heading, source URLs and the footer) had a 3.74:1 contrast in the light theme and 4.45:1 in the dark one; it is now `[#687280](https://github.com/dgesteves/ask-my-site/issues/687280)` and `#7c8796`, above 4.5:1 on both the dialog and its raised surfaces. Sources the answer does not cite are de-emphasized with color instead of `opacity: 0.55`, which took their text below 4.5:1 too.

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`661e00f`](https://github.com/dgesteves/ask-my-site/commit/661e00f0049342df768e75ec6e71e1ca582ab1a5) Thanks [@dgesteves](https://github.com/dgesteves)! - The Docusaurus, Astro and Starlight plugins warn when a package the dialog renders with (`react`, `react-dom`, `@radix-ui/react-dialog` or `cmdk`, optional peers of ask-my-site) is not installed, naming the `npm i` that fixes it, before the site's bundler fails with a bare "Cannot find package".

- [#8](https://github.com/dgesteves/ask-my-site/pull/8) [`7ab403d`](https://github.com/dgesteves/ask-my-site/commit/7ab403dd89e83294c959f16d30cb8ff2645d7f5e) Thanks [@dgesteves](https://github.com/dgesteves)! - Fix the Docusaurus plugin building a keyword-only index when `OPENAI_API_KEY` is set and `@ai-sdk/openai` is installed. Docusaurus loads plugins through jiti, which broke loading `@ai-sdk/openai` (`Cannot read properties of undefined (reading 'object')`), and the plugin reported that as "not installed". Provider packages now load with Node's own `require`, which works under jiti, Astro and plain Node.
  
  A missing provider package is reported as missing only when it is; any other failure is printed as it is. When `OPENAI_API_KEY` is set and the provider cannot load, the Docusaurus, Astro and Starlight plugins now fail the build instead of quietly building a keyword-only index (`embedding: 'none'` builds one on purpose). The CLI's `--embedding openai:…` reports the real error too.
  
  The plugins take the model as a string, as the CLI's `--embedding` does, so a config file never imports a provider: `embedding: 'openai:text-embedding-3-small'` with `dimensions: 512`, `'<provider>/<model>'` through AI Gateway, `'mock'` or `'none'`.

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`f95ca68`](https://github.com/dgesteves/ask-my-site/commit/f95ca687898d322d0a92ec9381bade56f3c8ceca) Thanks [@dgesteves](https://github.com/dgesteves)! - Explain a missing endpoint. When the ask endpoint answers 404, the dialog now says "Answers aren’t available here right now." instead of "The request failed (404).", and other errors without a message read "Something went wrong (502). Please try again." In development (a dev build, or a page on localhost) a 404 also logs a console warning with the full URL the dialog posted to and a pointer to the setup docs.

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`064898b`](https://github.com/dgesteves/ask-my-site/commit/064898b5988b0def87a0d96b81ebc4731882f92f) Thanks [@dgesteves](https://github.com/dgesteves)! - Fix citations into built HTML that led nowhere. An HTML file now keeps `.html` in its URL (`docs/install.html` is cited as `/docs/install.html`, not `/docs/install`, which 404s on a server without clean URLs); `index.html` still stands for its folder, the framework rules still drop the extension, and `--clean-urls` (or `cleanUrls` in `loadDirectory` and a config module) drops it for hosts that serve clean URLs. A heading in HTML now gets an anchor only from its own `id`: one without an `id` links to the nearest heading above it that has one, or to the page, instead of to a slug the page does not have. `fromHtml` marks its documents with the new `anchors: 'explicit'`; Markdown keeps its slug anchors.
  
  Indexes built from HTML change, so `--check` reports them as stale until they are rebuilt.

- [#9](https://github.com/dgesteves/ask-my-site/pull/9) [`286d796`](https://github.com/dgesteves/ask-my-site/commit/286d796dd323132c5fa57f8759afc86c56bebebd) Thanks [@dgesteves](https://github.com/dgesteves)! - Fix mock mode answering off-topic questions on small sites. The mock embedder hashes words into buckets, and a short question could collide with a short chunk ("France" and "npm" share one at 512 dimensions), clearing `MOCK_MIN_SIMILARITY` without a word in common: "What is the capital of France?" got a cited answer. Retrieval over an index built with `mockEmbeddingModel` now counts similarity only from chunks that share a word with the question. The new `retrieval.similarityNeedsKeyword` option sets this either way; it is off for real embeddings, which match meaning without shared words.

## 0.4.0

### Minor Changes

- [#6](https://github.com/dgesteves/ask-my-site/pull/6) [`5c2bb57`](https://github.com/dgesteves/ask-my-site/commit/5c2bb57600e4afac8f9da976e21a7700de29e8c7) Thanks [@dgesteves](https://github.com/dgesteves)! - Add `ask-my-site/starlight`, a Starlight plugin, and `ask-my-site/astro`, the Astro integration under it. After `astro build` they index the site into `dist/ask-index.json` (one per locale) at the URLs Astro serves, following `base`, `trailingSlash` and `build.format`. The Starlight plugin reads what Starlight's search reads, the `data-pagefind-body` region of each page: the title and Markdown, notes and tips included, without the sidebar, table of contents, heading anchors, edit link or pagination, and without pages that have `pagefind: false`. The Astro integration reads each page's `<main>`, or the part `content` selects. Both reuse the previous build's vectors from `node_modules/.cache`, embed with OpenAI or AI Gateway when their keys are set at build time, and add the dialog to every page: a floating "Ask AI" button and ⌘/Ctrl+I, in Starlight's colors and theme, bundled by Vite so it shares the site's React. They work with Astro 5, 6 and 7 and Starlight 0.32 and later, and `examples/starlight` is a working site.
  
  Add `ask-my-site/embed` and a script embed for sites that do not build with React (Hugo, Jekyll, Eleventy, MkDocs, plain HTML): `<script src="https://cdn.jsdelivr.net/npm/ask-my-site@0.4/dist/embed.global.js" data-endpoint="/api/ask" defer></script>` adds the dialog and its button, with React and the styles bundled in (91 KB gzipped), configured by `data-*` attributes. `window.AskMySite.mount()` and `mountAskDialog()` mount it by hand and return `{ open, close, unmount }`. Its theme follows `data-theme` on `<html>`, or the system setting.
  
  Also: `fromHtml` takes a selector as `root` (such as `[data-pagefind-body]`) and an `ignore` selector, reads code blocks that write each line as a `<div>` (Expressive Code, which Starlight and many Astro sites use) line by line instead of as one line, and no longer leaks the rest of a tag as text when an attribute value holds a `>` (such as a copy button's `data-code`).

## 0.3.0

0.3.0 was never published to npm: its changes first shipped in 0.4.0.

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
