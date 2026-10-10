---
# Generated from examples/nextjs/content/docs/ask-endpoint.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'The ask endpoint'
description: 'createAskHandler options, the request and response, errors and the streaming protocol.'
sidebar:
  order: 31
---

`createAskHandler(options)` from `ask-my-site/server` returns the endpoint: a function that takes a Web `Request` and returns a `Promise<Response>`. It runs in Next.js route handlers, Hono, Bun, Deno, Cloudflare Workers and Vercel or Netlify Functions.

## What happens per request

1. The body must be JSON (`content-type: application/json`); anything else gets a 415.
2. The rate limiter runs: 10 questions a minute per client IP unless you pass your own, or `false`.
3. The body is validated: `{ "question": string }` of up to 500 characters, in at most 64 KiB.
4. With `answerCache`, a question asked before is answered from the cache, and nothing else runs.
5. With `budget`, the question counts against the day's questions.
6. The question is embedded, and hybrid retrieval runs over the in-memory index.
7. If nothing clears the relevance gate, the "I don't know" message streams back and the model is never called.
8. Otherwise the top sources are numbered and, if the answer's worst case fits in the day's token `budget`, sent to the model with grounding instructions, and the answer streams back with its citations.

## Handler options

| Option                     | Default                     | Notes                                                                                                            |
| -------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `index`                    | required                    | Parsed JSON, its text, a `loadIndex` result, or a function returning one. Loaded once; a failed load is retried. |
| `model`                    | required                    | Any AI SDK language model, or an AI Gateway model id.                                                            |
| `embeddingModel`           | none                        | Must match the index, which is checked. Without it, retrieval is keyword-only.                                   |
| `embeddingProviderOptions` | none                        | Must match the build, such as `{ openai: { dimensions: 512 } }`.                                                 |
| `siteName`                 | `"this site"`               | Used in the instructions and the "I don't know" message.                                                         |
| `instructions`             | grounded defaults           | A string, or `(defaults) => string` to extend them.                                                              |
| `retrieval`                | tuned                       | `{ topK, candidates, rrfK, minSimilarity, minKeywordCoverage, similarityNeedsKeyword }`.                         |
| `maxContextChars`          | `8000`                      | Characters of source text sent to the model.                                                                     |
| `maxQuestionLength`        | `500`                       | Longer questions get a 400.                                                                                      |
| `maxBodyBytes`             | 64 KiB                      | Counted while reading the body.                                                                                  |
| `noAnswerMessage`          | "I don't know. I couldn't…" | Streamed when nothing is relevant.                                                                               |
| `rateLimit`                | 10 a minute per IP          | `memoryRateLimit()`; any `(request) => { success, … }` replaces it, and `false` turns it off.                    |
| `rateLimitFailure`         | `"closed"`                  | When `rateLimit` throws: `"closed"` answers 503, `"open"` answers anyway.                                        |
| `generation`               | `{ maxOutputTokens: 800 }`  | Passed to `streamText`: `temperature`, `providerOptions`, `timeout`, `telemetry`…                                |
| `budget`                   | none                        | `{ requestsPerDay, tokensPerDay, store }`: a daily cap, then a 429 with code `budget_exceeded`.                  |
| `answerCache`              | off                         | `true`, or `{ store, ttlSeconds }`: repeated questions are answered from the cache.                              |
| `headers`                  | none                        | Added to every response, such as CORS headers.                                                                   |
| `onFinish`                 | none                        | Called after each answer with `{ question, answer, sources, refused, retrieval, usage }`.                        |
| `onError`                  | `console.error`             | Handled errors: embedding fallbacks, model failures, a failing limiter, misconfiguration.                        |

## Logging questions and answers

`onFinish` runs once per answered request, after the answer has streamed, with the question, the answer, its sources, whether it was refused and the token usage. Use it to log questions your docs don't answer, or to send analytics. If it throws, the error goes to `onError`, and the answer the visitor got is unaffected.

## Request body

Send `{ "question": "…" }` as `application/json`. The `{ messages }` body that the AI SDK's `useChat` sends is accepted too, and its last user message is the question. Answers are single-turn: earlier messages are not used.

## Errors

Errors are JSON, `{ "error": { "code", "message" } }`, with status 400 (invalid body or question), 405 (not a POST), 413 (body too large), 415 (not JSON), 429 (rate limited, or the daily `budget` spent, with `Retry-After`), 500 (misconfigured, such as an embedding model that does not match the index) or 503 (the rate limiter or the budget store failed). A client that disconnects before the answer starts gets a bare 499 and is not reported as an error. Model errors during an answer are masked in the stream, so provider details never reach the browser.

## Streaming protocol

The response is an AI SDK UI message stream over Server-Sent Events. It starts with metadata, then one `source-url` part per numbered source, then the answer text:

```
data: {"type":"start","messageMetadata":{"refused":false,"retrieval":"hybrid"}}
data: {"type":"source-url","sourceId":"1","url":"/docs/retrieval#saying-i-dont-know","title":"How retrieval works › Saying \"I don't know\""}
data: {"type":"text-delta","id":"…","delta":"When no chunk clears the gate, "}
data: {"type":"finish"}
data: [DONE]
```

Because sources arrive before the text, citations are clickable as soon as they appear. The same stream works with `useChat` from `@ai-sdk/react`, and `readAskStream` from `ask-my-site/react` parses it without the AI SDK.

## Using it outside Next.js

The handler is the whole integration in any runtime: `app.post('/api/ask', (c) => handler(c.req.raw))` in Hono, `Bun.serve({ fetch: handler })` in Bun, `Deno.serve(handler)` in Deno, or `export default { fetch: handler }` in a Cloudflare Worker. It answers `OPTIONS` with a 204 and your `headers`, for CORS preflights.
