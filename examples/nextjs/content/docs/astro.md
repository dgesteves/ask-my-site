---
title: Astro and Starlight
description: The Starlight plugin and the Astro integration, which index the built site and add the dialog.
section: Integrations
order: 11
---

`ask-my-site/starlight` is a Starlight plugin, and `ask-my-site/astro` is the Astro integration under it, for any other Astro site. Like the Docusaurus plugin, they build the index with the site and add the dialog to every page. They work with Astro 5, 6 and 7, and Starlight 0.32 and later.

## Install for Astro

The dialog is a React component, so install React and its two dependencies along with the AI SDK:

```sh
npm i ask-my-site ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk
```

## Add it to Starlight

To add ask-my-site to Starlight, put the plugin in Starlight's `plugins` array in `astro.config.mjs`:

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import askMySite from 'ask-my-site/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [starlight({ title: 'Acme Docs', plugins: [askMySite()] })],
});
```

## Add it to any Astro site

Without Starlight, add the integration from `ask-my-site/astro` to `integrations`:

```js
// astro.config.mjs
import askMySite from 'ask-my-site/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({ integrations: [askMySite()] });
```

## What Astro and Starlight index

After `astro build`, the index is written to `dist/ask-index.json`, or to `dist/client/ask-index.json` on a site with an adapter, where Astro puts the static files it serves. It is at the URLs Astro serves: with your `base`, and with or without a trailing slash as `trailingSlash` and `build.format` have it.

The Starlight plugin reads what Starlight's own search reads: the part of each page marked `data-pagefind-body`, which is the title and the Markdown, notes and tips included, without the header, sidebar, table of contents, edit link or pagination. Pages Starlight's search leaves out are left out too, such as the 404 page and pages with `pagefind: false`. Mark anything else with `data-pagefind-ignore`.

The Astro integration reads each page's `<main>`. Choose another part with `content: '.prose'` (a tag, `#id`, `.class` or `[attribute]`, or a comma-separated list) and leave parts out with `ignore: '.toc'`. 404 and 500 pages, redirects and `noindex` pages are skipped. Unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ask-my-site`.

## The dialog in Astro

Both add a floating "Ask AI" button and open the dialog with ⌘I or Ctrl+I, so ⌘K stays with Starlight's search. In Starlight the button sits in the corner of the table of contents column, in Starlight's colors, and the dialog follows its light or dark theme. On other Astro sites the dialog follows `data-theme` on `<html>`, or the system setting. Vite bundles the dialog with your pages, so it shares React with your own islands. With `<ClientRouter />`, the dialog stays across navigations and citations navigate through the router.

Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `buttonLabel: false`. `dialog: { links: 'sources' }` keeps only the answer's links to its source pages.

## Embeddings in Astro

Embeddings work as in the Docusaurus plugin. OpenAI's `text-embedding-3-small` at 512 dimensions is the default when `OPENAI_API_KEY` is set at build time, or the same model through AI Gateway with `AI_GATEWAY_API_KEY`; without either key, the index is keyword-only and the build prints a warning. Choose the model with `embedding` and `dimensions`, for example `askMySite({ embedding: 'openai:text-embedding-3-small', dimensions: 512 })`, or `embedding: 'mock'` to build without a key.

## Deploy the endpoint for Astro

The endpoint is the same as for Docusaurus, reading `dist/ask-index.json` (or `dist/client/ask-index.json` with an adapter) instead of `build/ask-index.json`: see the Vercel, Netlify and Cloudflare Pages recipes in [Deploying](/docs/deployment). Astro writes `base` into URLs, not folders, so with `base: '/docs'` the file is still `dist/ask-index.json` and is served at `/docs/ask-index.json`.

To try it locally, build the site once, run `npx ask-my-site dev`, which answers from `dist/ask-index.json` or `dist/client/ask-index.json`, and start `astro dev` with `ASK_ENDPOINT=http://localhost:8787/api/ask`.

## Astro and Starlight options

| Option                                       | Default                            | What it does                                                                            |
| -------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `endpoint`                                   | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.                          |
| `embedding`, `dimensions`                    | OpenAI when a key is set           | The embedding model, named as the CLI names it.                                         |
| `embeddingModel`, `embeddingProviderOptions` | none                               | An AI SDK model object and its options, instead of `embedding`.                         |
| `chunking`                                   | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                                                  |
| `indexFile`                                  | `ask-index.json`                   | Where the index is written in `dist/` and served from.                                  |
| `exclude`                                    | `[]`                               | Path prefixes to leave out, relative to `base` and the locale.                          |
| `dialog`                                     |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `buttonLabel`, `theme`.              |
| `content`, `ignore`                          | `main`                             | Astro integration only: what to read from each page, and what to skip.                  |
| `mcp`                                        | none                               | The [MCP endpoint](/docs/mcp)'s URL or path, for `McpInstall.astro`.                    |
| `llmsTxt`                                    | on                                 | Write [llms.txt, llms-full.txt and .md copies](/docs/llms-txt); `false` turns them off. |

## Locales in Starlight

Starlight builds every locale at once, so the plugin writes one index per locale: `dist/ask-index.json` for the root locale and `dist/fr/ask-index.json` for French, served at `/fr/ask-index.json`. A page not yet translated is indexed with the fallback content Starlight shows for it, as Starlight's search does. The Astro integration splits the index the same way along Astro's `i18n` locales.
