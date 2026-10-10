---
# Generated from examples/nextjs/content/docs/security.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Rate limits and security'
description: 'Rate limiting, client IPs, CORS, prompt injection and what data leaves your servers.'
sidebar:
  order: 23
---

A public ask endpoint spends your model budget on every question, so it needs a rate limit, and it reads untrusted input on both sides: the question and your own pages. This page covers what the handler does about each.

## Add a rate limit

To add rate limiting, pass `rateLimit` to `createAskHandler`. `memoryRateLimit` is a token bucket per client IP, kept in the memory of one server instance:

```ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';
import index from './ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
```

A rejected request gets a 429 with `Retry-After` and `RateLimit-*` headers before any model is called, and the dialog shows "Too many questions. Try again shortly." On serverless platforms each instance counts on its own, so treat the memory limiter as a guard against one noisy client. For a limit shared by every instance and region, wrap an `@upstash/ratelimit` instance with `upstashRateLimit(new Ratelimit({ … }))`; ask-my-site does not depend on Upstash. Any `(request) => { success }` function works too.

## Which client IP header to trust

A rate limit is only as strong as its key. Both limiters key each request by the client IP read from one header, and only a header your platform sets on every request can be trusted: a client can send any other. By default it is the last entry of `X-Forwarded-For`.

| Where the handler runs        | Configure                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Vercel                        | Nothing: Vercel overwrites `X-Forwarded-For` with the client IP.                               |
| Netlify                       | `trustedHeader: 'x-nf-client-connection-ip'`                                                   |
| Cloudflare                    | `trustedHeader: 'cf-connecting-ip'`                                                            |
| Fly.io                        | `trustedHeader: 'fly-client-ip'`                                                               |
| Behind your own reverse proxy | Nothing if it appends to `X-Forwarded-For`; otherwise the header it sets, such as `x-real-ip`. |

Requests without the header share one `"anonymous"` bucket. `key: (request) => string` replaces the lookup, for example to limit per signed-in user.

## When the rate limiter fails

If the limiter throws, for example because Redis is unreachable, the handler fails closed: it reports the error and answers 503 without calling the model. Set `rateLimitFailure: 'open'` to keep answering during an outage and rely on your provider's spend limits instead.

## Cross-origin requests

The endpoint only accepts `application/json` bodies and answers anything else with a 415. Browsers send a cross-origin JSON POST only after a CORS preflight, which fails unless you allow the origin, so another site cannot make its visitors' browsers spend your model budget. To call the endpoint from another origin on purpose, set `access-control-allow-origin` and `access-control-allow-headers: content-type` in the handler's `headers` option, and in Next.js also `export const OPTIONS = POST`.

## Input limits

Questions are limited to 500 characters (`maxQuestionLength`), and request bodies to 64 KiB (`maxBodyBytes`), counted while the body is read so a chunked upload cannot exhaust memory. The body is validated with zod, and malformed requests get a 400 with a JSON error.

## Prompt injection

Sources and the question reach the model verbatim, inside tags that end in a random suffix drawn per request, such as `<sources-3f9a…>`. No text on your site or in a question can close the sources block or pose as the question, however it spells a tag, and the instructions tell the model to treat both as data. That stops injected text from forging structure, not from being read: index only content you trust.

## How answers are rendered

The answer is rendered from a small Markdown subset into React nodes, never as HTML. Links are allow-listed to http(s), mailto and relative URLs, and `[n]` becomes a link only if the server actually sent source `n`. If your pages could carry injected text, set the dialog's `links: 'sources'` (`data-links="sources"` on the script tag): links in an answer then stay links only when they point at one of its source pages, so a model talked into it cannot show visitors another site's login page. Model errors are masked in the stream, so provider details never reach the browser, and reported to `onError`.

## Privacy: what leaves your servers

ask-my-site has no service of its own and sends no telemetry, so no third party sees your docs or your visitors' questions except the model provider you choose. The browser talks only to your endpoint. Your endpoint sends the question to your embedding provider, and the question with the retrieved excerpts to your language model provider, under your own API keys and their terms. Nothing else is sent anywhere. `onFinish` gives you each question and answer if you want to log them; nothing is stored by default.
