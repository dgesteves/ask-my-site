---
title: The ask endpoint
description: createAskHandler options, the streaming protocol and rate limiting.
sidebar:
  order: 2
---

`createAskHandler` returns a function that takes a Web `Request` and returns a `Response`. It runs in Next.js route handlers, Hono, Bun, Deno and Cloudflare Workers.

## What happens per request

1. The body must be JSON (`content-type: application/json`), so another site cannot post to the endpoint from its visitors' browsers without a CORS preflight.
2. The rate limiter runs, if one is configured.
3. The body is validated: `{ "question": string }`, up to 500 characters.
4. The question is embedded and retrieval runs over the in-memory index.
5. If nothing is relevant, the "I don't know" message is streamed without calling the model.
6. Otherwise the top sources are numbered and sent to the model with grounding instructions, and the answer streams back.

If embedding the question fails, the request falls back to keyword retrieval instead of failing.

## Streaming protocol

The response is an AI SDK UI message stream over Server-Sent Events. It starts with metadata, then one `source-url` part per numbered source, then the answer text. Because sources arrive before the text, citations are clickable as soon as they appear. The same stream works with `useChat` from `@ai-sdk/react`.

## Rate limiting

Pass `rateLimit` to limit requests per client. `memoryRateLimit({ limit: 10, windowMs: 60_000 })` keeps a token bucket per IP inside one server instance. For a limit shared across instances and regions, wrap an `@upstash/ratelimit` instance with `upstashRateLimit`. Rejected requests get a 429 with a `Retry-After` header.

The client IP comes from one header, and only a header your platform sets on every request can be trusted: a client can send any other. The default is the last `X-Forwarded-For` entry, which is right on Vercel and behind a proxy that appends to it. On Netlify, Cloudflare or Fly.io, name the platform's header, for example `memoryRateLimit({ trustedHeader: 'cf-connecting-ip' })`, or pass `key` to choose the bucket yourself.

## Errors

Model errors are masked in the stream so provider details never reach the browser, and reported through `onError`. A misconfigured embedding model, one that does not match the index, fails loudly with a 500 rather than returning poor answers.
