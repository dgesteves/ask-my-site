# ask-my-site

**A drop-in ⌘K "ask" box for any website: build-time index, in-memory hybrid search, streaming answers with citations. No vector database.**

[![CI](https://img.shields.io/github/actions/workflow/status/dgesteves/ask-my-site/ci.yml?branch=main&label=CI&style=flat-square&labelColor=181c22)](https://github.com/dgesteves/ask-my-site/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ask-my-site?style=flat-square&labelColor=181c22&color=22d3ee)](https://www.npmjs.com/package/ask-my-site)
[![License: MIT](https://img.shields.io/badge/license-MIT-22d3ee?style=flat-square&labelColor=181c22)](./LICENSE)
[![Types](https://img.shields.io/badge/types-included-22d3ee?style=flat-square&labelColor=181c22)](#api)

<p align="center">
  <img src=".github/assets/hero.png" alt="The ask dialog over a docs page: a streamed answer with numbered citation chips, and a list of three sources linking to the exact sections it came from." width="900">
</p>

## Why

Documentation sites, product sites and portfolios change when you deploy, not between requests. Yet the usual way to put an assistant on one is a hosted vector database, an ingestion pipeline that keeps it in sync, and a bill and a failure mode for each.

ask-my-site indexes your pages at build time into one static JSON file that you commit next to them. At request time the same function that streams the answer loads that file, searches it in memory with keyword and vector retrieval, and refuses to answer when nothing relevant comes back. A 1,000-chunk site is a 1.6 MB index searched in under a millisecond.

## Quickstart

Install, then index your content into `ask-index.json`:

```sh
npm i ask-my-site ai @ai-sdk/openai
npx ask-my-site index ./content -e openai:text-embedding-3-small
```

Mount the endpoint in `app/api/ask/route.ts` (any `Request → Response` runtime works):

```ts
const embeddingModel = openai.embedding('text-embedding-3-small');
export const POST = createAskHandler({ index, model: openai('gpt-5.4-mini'), embeddingModel });
```

Render the dialog in your layout, with `import 'ask-my-site/react/styles.css'`:

```tsx
<AskDialog />
```

That is the whole integration: five lines, imports aside. [Full setup](#full-setup) is below, and no API key is needed to [try the example](#try-it-without-an-api-key).

## Features

- **Static, committed index.** Markdown, MDX and HTML in; one deterministic JSON file out, one chunk per line so content edits are small diffs. Rebuilds re-embed only the chunks whose text changed.
- **`--check` for CI.** Fails the build when the committed index no longer matches the content. Offline: no model call, no API key.
- **Hybrid retrieval in memory.** BM25 and cosine similarity over int8 vectors, merged with reciprocal rank fusion. No vector database, no network hop.
- **Says "I don't know".** A relevance gate refuses before the model is called when nothing relevant is found; the grounded prompt is the second line of defense.
- **Citations that land.** Every chunk belongs to exactly one heading, so `[1]` links to the section, not the page. Anchors match GitHub-style slugs, or your own `{#id}` and HTML `id`s.
- **Any AI SDK model.** Embeddings through `embedMany`/`embed` and answers through `streamText`, from any provider package or an AI Gateway model string.
- **Web-standard handler.** `(Request) => Promise<Response>` built on Web APIs only, so it mounts in Next.js route handlers, Hono, Bun, Deno or Cloudflare Workers. It streams the AI SDK UI message protocol, so `useChat` can consume it too.
- **Accessible ⌘K dialog.** Radix Dialog and cmdk; focus management, `aria-live` answer, reduced motion, light and dark themes, unstyled-friendly.
- **Production hygiene.** zod-validated input, body-size cap, pluggable rate limiting (in-memory or Upstash) keyed on a header you choose to trust, masked model errors, keyword fallback when the embedding provider is down.
- **Offline mock mode.** A deterministic embedder and a scripted extractive model run the whole pipeline with no key, for demos and tests.

## How it works

<p align="center">
  <img src=".github/assets/architecture.svg" alt="Architecture. Build time: pages are chunked per heading, embedded, quantized to int8 and written to a static ask-index.json. Request time: the dialog posts a question, the handler embeds it, runs BM25 and cosine search over the in-memory index, fuses the rankings with reciprocal rank fusion behind a relevance gate, then either answers I don't know without calling the model or streams a cited answer back over Server-Sent Events." width="900">
</p>

**Build time** (`ask-my-site index`, once per deploy)

1. **Load.** Markdown and MDX (YAML frontmatter for `title`/`url`, MDX reduced to text without evaluating it, code fences untouched), HTML (`<main>` content, chrome stripped, heading `id`s kept), or plain `{ id, url, title, content }` records from a CMS.
2. **Chunk.** Split at every heading, pack paragraphs up to 1,200 characters, split oversized blocks by line, then sentence, then word, and overlap consecutive chunks of a section by up to 150 characters. Each chunk carries its heading path and anchor.
3. **Embed.** `embedMany` over `Page title › Heading path` plus the chunk text, so short sections keep their context. Unchanged chunks reuse their previous vectors, matched by a hash of exactly what was embedded.
4. **Quantize and write.** Each vector is scaled to ±127 and stored as int8 in base64. The file records a content hash over the chunker version, options and every chunk, which is what `--check` compares.

**Request time** (`createAskHandler`, per question)

1. Require a JSON body, apply the rate limit, validate the body (zod), embed the question.
2. Search the index, loaded into memory once per server instance: BM25 over an inverted index and an exact cosine scan over the int8 matrix.
3. Gate: keep only chunks with cosine ≥ 0.25 **or** keyword coverage ≥ 0.5, then fuse both rankings with reciprocal rank fusion. If nothing passes, stream the "I don't know" message and stop. The model is never called.
4. Number the top sources (merging chunks of the same section), send them with grounding instructions to `streamText`, and stream back metadata, then the numbered sources, then the answer, which cites them as `[n]`.

## Full setup

**1. Index your content** and commit the result.

```sh
npx ask-my-site index ./content --base-url /docs \
  --embedding openai:text-embedding-3-small --dimensions 512
```

**2. Mount the handler.** A Next.js route handler here; it is a plain `Request → Response` function.

```ts
// app/api/ask/route.ts
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';
import index from '../../../ask-index.json';

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('text-embedding-3-small'),
  embeddingProviderOptions: { openai: { dimensions: 512 } }, // same as the CLI
  siteName: 'Acme Docs',
  // Keyed by client IP; on platforms other than Vercel, set `trustedHeader` (see below).
  rateLimit: memoryRateLimit({ limit: 10, windowMs: 60_000 }),
});
```

**3. Render the dialog** once, near the root.

```tsx
'use client';
import { AskDialog } from 'ask-my-site/react';
import 'ask-my-site/react/styles.css';
import { useRouter } from 'next/navigation';

export function Ask() {
  const router = useRouter();
  return (
    <AskDialog
      suggestions={['How do I install it?', 'Which runtimes are supported?']}
      onNavigate={(url, event) => {
        event.preventDefault();
        router.push(url);
      }}
    />
  );
}
```

**4. Keep the index fresh in CI.**

```sh
npx ask-my-site index ./content --base-url /docs --check   # exit 1 if stale
```

Other runtimes take the handler as-is: `app.post('/api/ask', (c) => handler(c.req.raw))` in Hono, `Bun.serve({ fetch: handler })`, or `export default { fetch: handler }` in a Cloudflare Worker.

## Try it without an API key

The [Next.js example](./examples/nextjs) is a docs site about ask-my-site that indexes itself.

```sh
pnpm install && pnpm example:dev   # http://localhost:3000, then press ⌘K
```

Without `OPENAI_API_KEY` it runs in mock mode: `mockEmbeddingModel()` hashes words and word pairs into vectors, and `mockLanguageModel()` answers by quoting the sentences that best match the question, with citations. Everything else is the production code path. With a key in `examples/nextjs/.env.local` it uses OpenAI.

<p align="center">
  <img src=".github/assets/refusal.png" alt="The dialog answering an off-topic question with: I don't know. I couldn't find anything about that on the ask-my-site docs." width="900">
</p>

## API

Five imports and a CLI. Each import is tree-shakeable, and only `ask-my-site/node` and the CLI touch Node built-ins.

| Import               | For                                                                    |
| -------------------- | ---------------------------------------------------------------------- |
| `ask-my-site`        | Loaders, chunking, `buildIndex`, `checkIndex`, `loadIndex`, `retrieve` |
| `ask-my-site/node`   | `loadDirectory`, `readIndexFile`, `writeIndexFile`, config types       |
| `ask-my-site/server` | `createAskHandler`, rate limiters, prompt helpers                      |
| `ask-my-site/react`  | `AskDialog`, `useAsk`, `AskAnswer`                                     |
| `ask-my-site/mock`   | `mockEmbeddingModel`, `mockLanguageModel`                              |
| `ask-my-site` (bin)  | `ask-my-site index`                                                    |

### CLI

```
ask-my-site index [dir] [options]

  -o, --out <file>             Index file (default: ask-index.json)
      --check                  Exit 1 if the index is stale. Never calls a model.
      --base-url <url>         URL prefix for pages (default: /)
  -e, --embedding <spec>       openai:<model> | <provider>/<model> (AI Gateway) | mock[:<dims>] | none
      --dimensions <n>         Vector size, for models that support it
      --chunk-size <chars>     Max characters per chunk (default: 1200)
      --chunk-overlap <chars>  Characters shared by consecutive chunks (default: 150)
      --ignore <glob>          Skip matching files; repeatable
  -c, --config <file>          Module whose default export is an AskConfig
```

Without `--embedding`, it uses `openai:text-embedding-3-small` when `OPENAI_API_KEY` is set (or `openai/text-embedding-3-small` through AI Gateway when only `AI_GATEWAY_API_KEY` is), and fails otherwise rather than silently building a keyword-only index. `.env` and `.env.local` are read without overriding the environment. `index.md`, `index.html` and `README.md` stand for their folder; frontmatter `url` or `permalink` overrides the derived URL, and `draft: true`, `ask: false` or `noindex: true` excludes a page.

For any other embedding provider, or for content that is not on disk, use a config module:

```js
// ask-my-site.config.mjs
import { cohere } from '@ai-sdk/cohere';
import { getPosts } from './lib/cms.mjs';

/** @type {import('ask-my-site/node').AskConfig} */
export default {
  embeddingModel: cohere.embedding('embed-multilingual-v3.0'),
  baseUrl: '/docs',
  documents: async () =>
    (await getPosts()).map((p) => ({
      id: p.slug,
      url: `/blog/${p.slug}`,
      title: p.title,
      content: p.markdown,
    })),
};
```

### `createAskHandler(options)` from `ask-my-site/server`

| Option                     | Default                     | Notes                                                                                                                                                                                                                          |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index`                    | required                    | Parsed JSON, its text, a `loadIndex` result, or a (sync or async) function returning one. Loaded once; a failed load is retried on the next request.                                                                           |
| `model`                    | required                    | Any AI SDK `LanguageModel`.                                                                                                                                                                                                    |
| `embeddingModel`           | none                        | Must match the index (checked). Without it, retrieval is keyword-only.                                                                                                                                                         |
| `embeddingProviderOptions` | none                        | Must match the build, e.g. `{ openai: { dimensions: 512 } }` (dimension mismatches are reported).                                                                                                                              |
| `siteName`                 | `"this site"`               | Used in the instructions and the refusal.                                                                                                                                                                                      |
| `instructions`             | grounded defaults           | A string, or `(defaults) => string` to extend them.                                                                                                                                                                            |
| `retrieval`                | tuned                       | `{ topK: 6, candidates: 40, rrfK: 60, minSimilarity: 0.25, minKeywordCoverage: 0.5 }`                                                                                                                                          |
| `maxContextChars`          | `8000`                      | Source text sent to the model.                                                                                                                                                                                                 |
| `maxQuestionLength`        | `500`                       | Longer questions get a 400.                                                                                                                                                                                                    |
| `maxBodyBytes`             | 64 KiB                      | Counted while reading, so a chunked upload cannot exhaust memory.                                                                                                                                                              |
| `noAnswerMessage`          | "I don't know. I couldn't…" | Streamed when nothing is relevant.                                                                                                                                                                                             |
| `rateLimit`                | none                        | `(request) => { success, limit?, remaining?, reset? }`, sync or async. See [rate limits and client IPs](#rate-limits-and-client-ips).                                                                                          |
| `rateLimitFailure`         | `"closed"`                  | When `rateLimit` throws (e.g. Redis is down): `"closed"` answers 503 without calling the model, `"open"` answers anyway. Reported to `onError` either way.                                                                     |
| `generation`               | `{ maxOutputTokens: 800 }`  | Passed to `streamText`: `temperature`, `providerOptions`, `timeout`, `telemetry`, …                                                                                                                                            |
| `headers`                  | none                        | Added to every response, including the 204 that answers a CORS preflight. Cross-origin: set `access-control-allow-origin` and `access-control-allow-headers: content-type`, and in Next.js also `export const OPTIONS = POST`. |
| `onFinish`                 | none                        | `{ question, answer, sources, refused, retrieval, usage }` after each answer. If it throws or rejects, the error goes to `onError` and the answer the visitor got is unaffected.                                               |
| `onError`                  | `console.error`             | Handled errors: embedding fallbacks, model failures, generations aborted by `generation.timeout` (not client disconnects), a failing `rateLimit` or `onFinish`, misconfiguration.                                              |

The body is `{ "question": string }` sent as `application/json`; the `{ messages }` body that `useChat` sends is accepted too, using the last user message. Any other content type gets a 415: browsers only send a cross-origin POST without a CORS preflight when its type is `text/plain`, a form encoding or missing, so requiring JSON means another site's page cannot make its visitors' browsers spend your model budget unless your `headers` allow its origin. Errors are JSON `{ error: { code, message } }` with 400, 405, 413, 415, 429 (with `Retry-After` and `RateLimit-*` headers), 500 or 503 (the rate limiter failed). A client that disconnects before the answer starts gets a bare 499 and is not reported as an error.

The response is an [AI SDK UI message stream](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) (SSE):

```
data: {"type":"start","messageMetadata":{"refused":false,"retrieval":"hybrid"}}
data: {"type":"source-url","sourceId":"1","url":"/docs/retrieval#saying-i-dont-know","title":"How retrieval works › Saying \"I don't know\""}
data: {"type":"text-delta","id":"…","delta":"When no chunk clears the gate, "}
…
data: {"type":"finish"}
data: [DONE]
```

Rate limiters: `memoryRateLimit({ limit, windowMs })` is a per-instance token bucket keyed by client IP; `upstashRateLimit(new Ratelimit({ … }))` adapts `@upstash/ratelimit` for a shared limit without ask-my-site depending on it. Both take `trustedHeader` and `key`, below.

#### Rate limits and client IPs

A rate limit is only as strong as its key. Both limiters key each request by the client IP read from **one** header, and a header can only be trusted if your platform sets it on every request, replacing whatever the client sent. Any other header passes through from the client unchanged, so trusting it lets a client pick a new key for every request and never be limited. ask-my-site cannot know which headers your platform controls, so it never guesses from a list: it reads the last entry of `X-Forwarded-For` unless you name the header with `trustedHeader`.

| Where the handler runs                                     | Configure                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel                                                     | Nothing: Vercel overwrites `X-Forwarded-For` with the client IP.                                                                                                    |
| Netlify                                                    | `trustedHeader: 'x-nf-client-connection-ip'`                                                                                                                        |
| Cloudflare Workers, or an origin only Cloudflare can reach | `trustedHeader: 'cf-connecting-ip'`                                                                                                                                 |
| Fly.io                                                     | `trustedHeader: 'fly-client-ip'`                                                                                                                                    |
| Behind one reverse proxy you run                           | Nothing if it appends the peer address to `X-Forwarded-For` (nginx: `$proxy_add_x_forwarded_for`); otherwise the header it sets, e.g. `trustedHeader: 'x-real-ip'`. |
| Exposed directly, with no proxy in front                   | Every header, `X-Forwarded-For` included, comes from the client. Put a proxy in front, or pass a `key` the client cannot forge, such as a signed-in user id.        |

Use your platform's header even when others are present: on Vercel, for example, a client can send its own `cf-connecting-ip`. When the header holds a list, the last entry (added by the nearest proxy) is used, so with several proxies in a chain, name a header the outermost one sets. Requests that lack the header share one `"anonymous"` bucket rather than falling back to a header the client controls. `key: (request) => string` replaces the lookup entirely, for example to limit per signed-in user; `clientKey(request, { trustedHeader })` is exported for custom limiters.

If the limiter itself fails (Upstash unreachable, a bug in your own), the handler fails closed: it reports the error and answers 503 without calling the model. The limiter is what stands between a public endpoint and an unbounded model bill, and its outage can be provoked, for example by a flood that exhausts a Redis plan's request quota, so its failure should not quietly switch it off. Set `rateLimitFailure: 'open'` if you would rather keep answering during an outage and rely on your provider's spend limits. (`@upstash/ratelimit` already allows requests when Redis is merely slow, after its own `timeout`.)

### `<AskDialog />` and `useAsk()` from `ask-my-site/react`

| Prop                                  | Default            | Notes                                                                                                 |
| ------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `endpoint`                            | `/api/ask`         | Also `headers` and a custom `fetch`.                                                                  |
| `open`, `defaultOpen`, `onOpenChange` | uncontrolled       | Controlled or uncontrolled.                                                                           |
| `shortcut`                            | `"k"`              | With ⌘ or Ctrl; `false` disables it.                                                                  |
| `trigger`                             | none               | An element that opens the dialog, e.g. a search button.                                               |
| `suggestions`                         | `[]`               | Offered before typing, filtered as you type.                                                          |
| `onNavigate`                          | browser navigation | `(url, event)` for citations and sources; `preventDefault()` to route yourself.                       |
| `theme`                               | `"system"`         | `"light"` or `"dark"` to pin it.                                                                      |
| `classNames`                          | none               | Extra classes per part: `overlay`, `content`, `input`, `list`, `item`, `answer`, `sources`, `footer`. |
| `title`, `placeholder`, `footer`      | sensible defaults  | `title` is the dialog's accessible name.                                                              |

`useAsk({ endpoint })` returns `{ ask, stop, reset, status, question, answer, sources, refused, truncated, retrieval, error }`. `status` is `idle | loading | streaming | done | error`; `error.kind` is `rate-limited | http | network | stream`, with `retryAfter` for rate limits. `truncated` is `true` when the model stopped at its output limit (`generation.maxOutputTokens`, 800 by default), so a `done` answer may be incomplete; the dialog says so under the answer. Sources arrive before the first word, deltas are batched to one render per animation frame, and `stop()` keeps the partial answer. Closing the dialog, by Escape, a click outside or a controlling parent, stops the answer in flight so the model is not left generating for nobody.

Theming is CSS custom properties: `.ask-dialog { --ask-accent: #7c3aed; --ask-radius: 8px; }`. Skip the stylesheet entirely and style the stable `ask-*` classes, or pass Tailwind classes through `classNames`.

### Core, from `ask-my-site`

```ts
import { buildIndex, fromMarkdown, loadIndex, retrieve, serializeIndexFile } from 'ask-my-site';

const doc = fromMarkdown(source, { id: 'guide.md', url: '/guide' });
const { index, stats } = await buildIndex({ documents: [doc], embeddingModel, previous });
const loaded = loadIndex(serializeIndexFile(index));
const { hits, answerable, best } = retrieve(loaded, { text: question, vector });
```

Also exported: `fromHtml`, `fromDocuments`, `chunkDocument`, `checkIndex`, `parseIndexFile`, `validateIndexFile`, `tokenize`, `createSlugger` (use it in your renderer so anchors always match), and the building blocks `Bm25Index`, `VectorIndex`, `reciprocalRankFusion`, `quantizeInt8`, `encodeVector`, `decodeVector`.

## Design decisions and trade-offs

**Static over hosted.** Content that changes on deploy does not need a database that changes at runtime. A committed index removes the vector store, its sync job and its outage modes, and it versions with the pages it cites, so a citation can never point at a section that was deleted in the same release. The cost is freshness: content changes need a rebuild, which is the point of `--check`.

**int8, without a scale.** Each vector is scaled so its largest component is ±127 and rounded: one byte per dimension, a quarter of float32 and about a tenth of float JSON. No per-vector scale is stored because retrieval only needs cosine similarity, and cosine is scale-invariant. Measured recall@10 against exact float32 is 99% at 10,000 chunks, with similarities within 0.005. Binary (1-bit) quantization would shrink the vectors another 8×, but on the same benchmark vectors it keeps only 27% of the exact top 10 (66% even after rescoring a 4× shortlist), and rescoring means shipping full vectors anyway. Product quantization needs trained codebooks. Neither pays off at this scale.

**Hybrid retrieval, fused by rank.** Embeddings are good at paraphrase and bad at exact tokens: function names, flags, error codes. BM25 is the reverse. Docs questions mix both. Reciprocal rank fusion (k = 60) merges the two rankings using ranks alone, so there is no fragile attempt to put BM25 scores and cosines on one scale, and a chunk both retrievers like beats one only a single retriever loves. camelCase identifiers are indexed whole and split, so `createAskHandler` matches "create ask handler".

**A relevance gate before the model.** RRF scores say which chunk is best, not whether any chunk is good, so the gate uses the raw signals: cosine ≥ 0.25 (calibrated for `text-embedding-3-small`), or keyword coverage ≥ 0.5, where coverage is the share of the question's IDF weight a chunk contains. Coverage is bounded and corpus-independent, unlike raw BM25. If nothing passes, the answer is "I don't know" with zero model calls: fast, free and deterministic. The thresholds are model-specific, which is the main tuning cost; `retrieve()` returns the `best` signals to make that easy.

**An exact scan, not an ANN index.** At 10,000 chunks a full int8 cosine scan takes under 5 ms, recall is perfect, and there is nothing to build at cold start. HNSW and friends earn their memory and build time well past the sizes a static site produces.

**One function, one stream.** Retrieval runs inside the request handler instead of a separate service, and the response is the AI SDK's UI message stream rather than a bespoke format: sources first, then text. `useAsk` parses it with a small SSE reader, keeping `ai` and zod out of the client bundle, and the same stream is readable by `useChat`.

**Untrusted output stays text.** The answer is rendered from a small Markdown subset into React nodes, never HTML. Links are allow-listed to http(s), mailto and relative URLs, and `[n]` becomes a link only if the server actually sent source `n`. Sources and the question go to the model verbatim, inside tags that end in a random suffix drawn per request (`<sources-3f9a…>`), so no text on your site or in a question can close the sources block or pose as the question, however it spells a tag; the instructions tell the model to treat both as data. That keeps prompt injection from forging structure, not from being attempted: a page that says "ignore your rules" is still text the model reads, so index only content you trust.

**Where it stops scaling.** Everything is linear in corpus size: roughly 1.6 MB of index, 34 ms of cold load and 0.7 ms per query per 1,000 chunks of ~800 characters at 512 dimensions. That is comfortable to about 10,000 chunks and workable to about 50,000 (79 MB, 1.7 s cold start, 37 ms per query). Beyond that, or for content that changes per request or per user, use a vector database. If your platform limits function bundle size, load the index from a static URL instead of importing it: `index: () => fetch(url).then((r) => r.text())`.

**Other limits.** The keyword side is English-leaning (stopwords, plural stripping); other languages rely on the embedding model. Answers are single-turn. MDX is reduced to text, so components that render content from props are invisible to the index. The HTML loader is a tag stripper that expects static-site-generator output, not arbitrary markup. `memoryRateLimit` is per instance, and either limiter keys on a client IP header that only your platform can vouch for (see [rate limits and client IPs](#rate-limits-and-client-ips)).

## Benchmarks

`pnpm bench` builds the package and measures it on synthetic, documentation-shaped corpora: Zipf-distributed vocabulary, chunks of 600 to 1,000 characters grouped into pages, and 512-dimension embeddings clustered around shared topics, as one site's embeddings are. Query latency covers hybrid retrieval end to end (BM25, cosine scan, fusion) and excludes the embedding API call, which is network-bound and the same for any design.

Apple M1 Max, Node 24.18, 1,000 queries per size after warm-up:

| Chunks |   Index |    gzip | Same index, float JSON | Cold load |   Memory | Query p50 |      p95 |      p99 | Recall@10 |
| -----: | ------: | ------: | ---------------------: | --------: | -------: | --------: | -------: | -------: | --------: |
|  1,000 |  1.6 MB |  0.9 MB |                 7.5 MB |     32 ms |   3.2 MB |   0.71 ms |  0.76 ms |  0.91 ms |     99.9% |
| 10,000 | 15.7 MB |  8.5 MB |                75.4 MB |    339 ms |  25.2 MB |   6.96 ms |  7.32 ms |  7.84 ms |     99.1% |
| 50,000 | 78.7 MB | 42.6 MB |               377.1 MB |    1.72 s | 123.9 MB |  37.11 ms | 39.01 ms | 44.03 ms |     98.5% |

At 10,000 chunks, the BM25 half of a query takes 2.3 ms and the vector scan 4.6 ms (p50). Cold load is a one-time cost per server instance: parse, decode vectors, build the inverted index. "Recall@10" is the overlap between int8 and exact float32 top-10 results. The [benchmark source](./bench/run.mjs) documents the method.

## Roadmap

- **Follow-up questions:** condense the conversation into a standalone question before retrieval.
- **Re-ranking hook:** an optional AI SDK reranking model over the fused candidates.
- **Retrieval evals in CI:** a golden question set scored for hit rate and refusal precision, next to `--check`.
- **Bigger corpora:** sharded indexes loaded per section, and binary quantization with int8 rescoring.
- **Framework adapters:** Astro, Docusaurus and VitePress plugins that index the built site.
- **Language-aware keyword search:** per-language stopwords and stemming.

## Development

```sh
pnpm install
pnpm test        # Vitest, offline: mock models from ai/test, no keys
pnpm validate    # lint, format, typecheck, test, build, package checks, example build + lint
pnpm bench       # benchmarks
pnpm assets      # regenerate the architecture diagram
```

Requires Node 24 and pnpm (via Corepack). Releases are managed with [Changesets](./.changeset/README.md).

## License

[MIT](./LICENSE) © Diogo Esteves
