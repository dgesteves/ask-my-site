---
# Generated from examples/nextjs/content/docs/deployment.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Deploying'
description: 'Deploy the endpoint to Vercel, Netlify or Cloudflare, where the index lives, cold starts and cost.'
sidebar:
  order: 22
---

The endpoint deploys wherever your site's server code runs, as one function. There is no database to provision and nothing to keep in sync: the index is a file built with the site.

## Runtimes

The handler uses Web APIs only, so it runs on Node.js, Bun, Deno, Cloudflare Workers, Vercel Functions and Netlify Functions. File-system helpers live in `ask-my-site/node` and are only needed at build time.

## Where the index lives

There are three ways for the endpoint to read the index:

- **Import it.** `import index from './ask-index.json'` bundles the index with the function. This is the simplest, and what a Next.js app does.
- **Read it from the build output.** A static site's function reads `build/ask-index.json` (Docusaurus) or `dist/ask-index.json` (Astro; `dist/client/ask-index.json` with an adapter) with `readFile`, and the host bundles the file with the function.
- **Fetch it.** For large indexes on platforms that limit function size, serve the file as a static asset and pass a loader: `index: () => fetch(url).then((r) => r.text())`.

A loader runs once per server instance, on the first question, and a failed load is retried on the next request.

## Deploy to Vercel

In a Next.js app on Vercel there is nothing to configure: the route handler is a Vercel Function, and the imported index is bundled with it.

To deploy the endpoint of a static site, such as a Docusaurus or Astro site, to Vercel, add `api/ask.ts`:

```ts
// api/ask.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';

export const POST = createAskHandler({
  index: () => readFile(join(process.cwd(), 'build/ask-index.json'), 'utf8'),
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  siteName: 'Acme Docs',
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
```

Then include the index in the function's bundle with `vercel.json`: `{ "functions": { "api/ask.ts": { "includeFiles": "build/ask-index.json" } } }`. Use `dist/ask-index.json` for Astro, or `dist/client/ask-index.json` with an adapter. On Vercel, rate limits need no extra setting, because Vercel overwrites `X-Forwarded-For` with the client's IP.

## Deploy to Netlify

To deploy to Netlify, add a function at `netlify/functions/ask.mts`, and rate-limit on the client IP header Netlify sets:

```ts
// netlify/functions/ask.mts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';

export default createAskHandler({
  index: () => readFile(join(process.cwd(), 'build/ask-index.json'), 'utf8'),
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  rateLimit: memoryRateLimit({
    limit: 10,
    windowMs: 60_000,
    trustedHeader: 'x-nf-client-connection-ip',
  }),
});

export const config = { path: '/api/ask' };
```

Include the index in the function's bundle with `netlify.toml`:

```toml
[functions.ask]
  included_files = ["build/ask-index.json"]
```

## Deploy to Cloudflare

To deploy to Cloudflare Pages, add a Pages Function at `functions/api/ask.ts`. It fetches the index from the site's own static assets, and reads the key from the function's environment:

```ts
// functions/api/ask.ts
import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';

const INDEX = '/ask-index.json';

let handler: ((request: Request) => Promise<Response>) | undefined;

export const onRequest: PagesFunction<{ OPENAI_API_KEY: string; ASSETS: Fetcher }> = ({
  request,
  env,
}) => {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  handler ??= createAskHandler({
    index: async () => {
      const response = await env.ASSETS.fetch(new URL(INDEX, request.url));
      if (!response.ok) throw new Error(`${INDEX}: HTTP ${String(response.status)}`);
      return response.text();
    },
    model: openai('gpt-5.4-mini'),
    embeddingModel: openai.embedding('text-embedding-3-small'),
    rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000, trustedHeader: 'cf-connecting-ip' }),
  });
  return handler(request);
};
```

In a Cloudflare Worker, `export default { fetch: handler }` serves it. On Cloudflare, always rate-limit with `trustedHeader: 'cf-connecting-ip'`, as above: the default limiter reads `X-Forwarded-For`, which is not the header Cloudflare vouches for.

## Environment variables

Set your provider's key, such as `OPENAI_API_KEY`, in two places: in the build, if the build embeds the index, and in the function's runtime environment, which embeds questions and calls the model. The key never reaches the browser: the dialog only talks to your endpoint.

## Cold starts

Loading the index is a one-time cost per server instance: about 32 ms for 1,000 chunks and 339 ms for 10,000, measured on an Apple M1 Max. After that, a query takes 0.7 ms of CPU at 1,000 chunks and about 7 ms at 10,000, so nearly all of a request's time is the embedding call and the model's answer.

## Cost

ask-my-site itself is free and MIT-licensed; you pay your model provider. Each answered question costs one embedding call for the question and one model call for the answer, with at most 8,000 characters of sources in (`maxContextChars`) and at most 800 tokens out (`generation.maxOutputTokens`). A refused question costs the embedding call only: the model is never called. Indexing costs one embedding call per changed chunk, since unchanged chunks reuse their vectors.
