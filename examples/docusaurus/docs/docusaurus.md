---
# Generated from examples/nextjs/content/docs/docusaurus.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Docusaurus'
description: 'The Docusaurus 3 plugin, which indexes the built site and adds the dialog.'
---

The `ask-my-site/docusaurus` plugin adds ask-my-site to a Docusaurus 3 site with one line of config. After every `docusaurus build` it indexes the pages the site serves, and in the browser it adds the dialog with a floating "Ask AI" button.

## Install the plugin

Install the package with the AI SDK, the OpenAI provider (the default embedding model) and the dialog's two dependencies:

```sh
npm i ask-my-site ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

## Add it to docusaurus.config.ts

To add ask-my-site to Docusaurus, put the plugin in the `plugins` array of `docusaurus.config.ts`:

```ts
// docusaurus.config.ts
export default {
  // …
  plugins: ['ask-my-site/docusaurus'],
};
```

The dialog posts questions to `/api/ask` on your site. Set `endpoint` for another path or host, as in `['ask-my-site/docusaurus', { endpoint: 'https://ask.example.com/api/ask' }]`. The `ASK_ENDPOINT` environment variable, when it is set as the site builds or starts, overrides both, which is how [local development](./local-development.md) points the dialog at `ask-my-site dev`.

## What the plugin indexes

After `docusaurus build`, the plugin indexes the docs, blog posts and MDX pages into `build/ask-index.json`, at the exact URLs Docusaurus generated, so citations never guess at a URL. It reads each page's Markdown content without the navbar, breadcrumbs, table of contents, doc cards or pagination. Pages that only list other pages are left out: blog lists, tag and author pages, and generated category indexes.

There is nothing to commit. The index is rebuilt with the site, and unchanged pages reuse their vectors from the previous build, cached in `node_modules/.cache/ask-my-site`, which Netlify and Vercel keep between builds. Leave sections out with `exclude`, for example `exclude: ['/changelog']`.

## The dialog and the shortcut

In the browser the plugin adds a floating "Ask AI" button beside the back-to-top button, and opens the dialog with ⌘I or Ctrl+I. ⌘K stays with your search, and text fields keep ⌘I for italic. The dialog follows the site's light or dark mode, and citations route through Docusaurus without a page reload.

DocSearch's own Ask AI panel also opens with ⌘I. Pick another key with `dialog: { shortcut: 'j' }`, turn the shortcut off with `shortcut: false`, or hide the button with `buttonLabel: false`.

## Embeddings in Docusaurus

The plugin embeds with OpenAI's `text-embedding-3-small` at 512 dimensions when `OPENAI_API_KEY` is set at build time, or with the same model through AI Gateway when only `AI_GATEWAY_API_KEY` is. Without either key it builds a keyword-only index and prints a warning. If a key is set but the provider cannot load, the build fails with the reason instead of quietly going keyword-only.

Choose the model with `embedding`, named the way the CLI names it, so the config imports no provider: `'openai:text-embedding-3-large'`, `'cohere/embed-v4.0'` through AI Gateway, `'mock'` for offline builds, or `'none'` for keyword-only. `dimensions` sets the vector size for models that support it, and the endpoint reads it from the index.

```ts
plugins: [['ask-my-site/docusaurus', { embedding: 'openai:text-embedding-3-small', dimensions: 512 }]],
```

## Deploy the endpoint for Docusaurus

A Docusaurus site is static, so the endpoint runs as a function on your host and reads the index the build wrote. It must embed questions with the same model as the build. On Vercel, add `api/ask.ts`:

```ts
// api/ask.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createAskHandler } from 'ask-my-site/server';

export const POST = createAskHandler({
  index: () => readFile(join(process.cwd(), 'build/ask-index.json'), 'utf8'),
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  siteName: 'Acme Docs',
});
```

Include the index in the function's bundle with `vercel.json`: `{ "functions": { "api/ask.ts": { "includeFiles": "build/ask-index.json" } } }`. [Deploying](./deployment.md) has the Netlify and Cloudflare Pages versions.

## Try the Docusaurus plugin locally

Build the site once, run `npx ask-my-site dev` in its folder, which answers from `build/ask-index.json`, and start the site with `ASK_ENDPOINT=http://localhost:8787/api/ask npm start`. Without a key, the build makes a keyword-only index unless you set `embedding: 'mock'`, and `ask-my-site dev` answers with the mock model either way. `docusaurus start` reminds you when the dialog posts to a path it does not serve.

## Docusaurus plugin options

| Option                     | Default                            | What it does                                                        |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `endpoint`                 | `ASK_ENDPOINT`, else `/api/ask`    | Where the dialog posts questions; `ASK_ENDPOINT` overrides it.      |
| `embedding`                | OpenAI when a key is set           | Model spec: `openai:<model>`, `<provider>/<model>`, `mock`, `none`. |
| `dimensions`               | the model's                        | Vector size, for models that support it.                            |
| `embeddingModel`           | none                               | An AI SDK embedding model object, instead of `embedding`.           |
| `embeddingProviderOptions` | none                               | Passed to the embedding model.                                      |
| `chunking`                 | `{ maxChars: 1200, overlap: 150 }` | Chunk size and overlap, in characters.                              |
| `indexFile`                | `ask-index.json`                   | Where the index is written in `build/` and served from.             |
| `exclude`                  | `[]`                               | Path prefixes to leave out, relative to `baseUrl`.                  |
| `dialog`                   |                                    | `title`, `placeholder`, `suggestions`, `shortcut`, `buttonLabel`.   |

## Locales and versions

Docusaurus builds each locale on its own, and each gets its own index under its locale path: `build/fr/ask-index.json`, served at `/fr/ask-index.json`. Versioned docs index every version, so an answer can cite an old one; leave versions out with `exclude`, as in `exclude: ['/docs/next', '/docs/1.0']`.

## When another plugin wraps Root

When two plugins wrap `Root`, Docusaurus uses only the last one's wrapper, so the dialog can go missing. Render it from your own `Root` instead; it shows once even if the plugin's `Root` renders it too:

```tsx
// src/theme/Root.tsx
import AskMySite from '@theme/AskMySite';
import Root from '@theme-original/Root';
import type { ReactNode } from 'react';

export default function RootWithAsk({ children }: { children: ReactNode }) {
  return (
    <Root>
      {children}
      <AskMySite />
    </Root>
  );
}
```
