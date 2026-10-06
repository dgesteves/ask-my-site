---
title: Getting started
description: Install, index your content, add the endpoint and the dialog.
order: 2
---

Setup takes four steps and works with any AI SDK provider.

## Install

Install the package with the AI SDK and a provider:

```sh
pnpm add ask-my-site ai @ai-sdk/openai
```

## Build the index

Point the CLI at the folder that holds your pages. It reads Markdown, MDX and HTML, chunks them, embeds the chunks and writes `ask-index.json`:

```sh
npx ask-my-site index content --base-url /docs --embedding openai:text-embedding-3-small --dimensions 512
```

Commit the file. Rebuilding after an edit only re-embeds the chunks whose text changed.

## Add the endpoint

Create a route handler. The handler is a plain `(request) => Response` function, so in Next.js you export it as `POST`:

```ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler } from 'ask-my-site/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  embeddingProviderOptions: { openai: { dimensions: 512 } },
});
```

## Add the dialog

Render the dialog once, near the root of your app, and import the default theme:

```tsx
import { AskDialog } from 'ask-my-site/react';
import 'ask-my-site/react/styles.css';

<AskDialog endpoint="/api/ask" suggestions={['How do I install it?']} />;
```

Press ⌘K (or Ctrl+K) to open it.

## Try it without an API key

The `ask-my-site/mock` entry provides a deterministic embedding model and a scripted language model. Build the index with `--embedding mock` and pass `mockLanguageModel()` to the handler to run the whole pipeline offline.
