// What the ask handler and the MCP handler share: reading a capped body, loading the index once,
// embedding a query as the index was embedded, and the default rate limit. Web APIs only.
import { embed, type EmbeddingModel } from 'ai';

import { embeddingModelId, sameEmbeddingModel, type EmbeddingProviderOptions } from '../build';
import { loadIndex, type LoadedIndex } from '../search/retrieve';
import { memoryRateLimit, type RateLimiter, type RateLimitResult } from './rate-limit';
import { isLiveIndex } from './remote-index';

/**
 * The index in any form `loadIndex` accepts: the parsed JSON (`import index from
 * './ask-index.json'`), its text, or an already loaded index.
 */
export type IndexSource = object | string;

/** Status for a request the client abandoned (nginx's convention); nobody reads the body. */
export const CLIENT_CLOSED = 499;

/**
 * Reads the body as UTF-8, giving up as soon as it exceeds `limit` bytes. `Content-Length` is
 * advisory (chunked requests have none), so the bytes are counted as they arrive.
 */
export async function readBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** `application/json`, with any parameters (`; charset=utf-8`). */
export const isJson = (contentType: string | null): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

/** The rate-limit headers of a 429: `Retry-After` and the `RateLimit-*` fields the limiter gave. */
export function rateLimitHeaders(limit: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {};
  if (limit.reset !== undefined) {
    const seconds = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    headers['retry-after'] = String(seconds);
    headers['ratelimit-reset'] = String(seconds);
  }
  if (limit.limit !== undefined) headers['ratelimit-limit'] = String(limit.limit);
  if (limit.remaining !== undefined) headers['ratelimit-remaining'] = String(limit.remaining);
  return headers;
}

/**
 * Indexes already loaded, by the object they were loaded from, so two handlers given the same
 * imported JSON (an ask endpoint and an MCP endpoint in one app) hold one copy in memory.
 */
const loaded = new WeakMap<object, LoadedIndex>();

/** `import('./ask-index.json')` resolves to a module namespace with the JSON as `default`. */
function unwrapModule(value: unknown): unknown {
  if (value && typeof value === 'object' && !('format' in value) && 'default' in value) {
    return value.default;
  }
  return value;
}

function isLoadedIndex(value: unknown): value is LoadedIndex {
  return typeof value === 'object' && value !== null && 'bm25' in value && 'chunks' in value;
}

/** Loads `source` into memory, or returns the copy already loaded from the same object. */
function load(source: unknown): LoadedIndex {
  if (isLoadedIndex(source)) return source;
  const value = unwrapModule(source);
  if (typeof value !== 'object' || value === null) return loadIndex(value);
  let index = loaded.get(value);
  if (!index) {
    index = loadIndex(value);
    loaded.set(value, index);
  }
  return index;
}

/**
 * The index a handler serves, loaded on first use and then kept: `source` as given, or what a
 * function returns. A failed load (a network blip fetching the file) is retried on the next call
 * instead of poisoning every later request. A `remoteIndex` is asked on every call instead,
 * as it follows the site's deploys. Throws when `embeddingModel` is not the model the index was
 * embedded with.
 */
export function indexLoader(
  source: IndexSource | (() => IndexSource | Promise<IndexSource>),
  embeddingModel: EmbeddingModel | undefined,
): () => Promise<LoadedIndex> {
  const resolve = async (): Promise<LoadedIndex> => {
    const index = load(typeof source === 'function' ? await source() : source);
    checkModel(index);
    return index;
  };
  const checkModel = (index: LoadedIndex): void => {
    if (
      index.embedding &&
      embeddingModel &&
      !sameEmbeddingModel(index.embedding.model, embeddingModelId(embeddingModel))
    ) {
      throw new Error(
        `The index was embedded with "${index.embedding.model}" but the handler embeds queries with ` +
          `"${embeddingModelId(embeddingModel)}". Rebuild the index or pass the same embeddingModel.`,
      );
    }
  };
  // A remote index changes with the site, and keeps its own copy: ask it every time.
  if (isLiveIndex(source)) {
    return async () => {
      const index = await source();
      checkModel(index);
      return index;
    };
  }
  let promise: Promise<LoadedIndex> | null = null;
  return () => {
    promise ??= resolve().catch((error: unknown) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}

/**
 * The provider options a query is embedded with: `given`, plus, for OpenAI's `text-embedding-3`
 * models (whose size is an option), the size the index was built at, unless `given` sets one. So
 * an index built at 512 dimensions, or at the model's full 1,536, is queried at its own size
 * without the endpoint repeating it.
 */
function queryProviderOptions(
  embedding: NonNullable<LoadedIndex['embedding']>,
  given: EmbeddingProviderOptions | undefined,
): EmbeddingProviderOptions | undefined {
  if (!/(?:^|\/)text-embedding-3-/.test(embedding.model)) return given;
  if (given?.openai && 'dimensions' in given.openai) return given;
  return { ...given, openai: { dimensions: embedding.dimensions, ...given?.openai } };
}

/**
 * Embeds `text` for a search of `index`: `null` without a model or vectors (keyword-only), and
 * `null` when the provider fails, which is reported and degrades the search to keywords. Throws
 * when the request was aborted, or when the vector's size does not match the index.
 */
export async function embedQuery(
  text: string,
  index: LoadedIndex,
  options: {
    embeddingModel?: EmbeddingModel | undefined;
    embeddingProviderOptions?: EmbeddingProviderOptions | undefined;
  },
  abortSignal: AbortSignal,
  reportError: (error: unknown) => void,
): Promise<number[] | null> {
  if (!options.embeddingModel || !index.vectors || !index.embedding) return null;
  const providerOptions = queryProviderOptions(index.embedding, options.embeddingProviderOptions);
  let embedding: number[];
  try {
    ({ embedding } = await embed({
      model: options.embeddingModel,
      value: text,
      maxRetries: 1,
      abortSignal,
      ...(providerOptions ? { providerOptions } : {}),
    }));
  } catch (error) {
    if (abortSignal.aborted) throw error;
    // Degrade to keyword retrieval rather than failing the request.
    reportError(error);
    return null;
  }
  if (embedding.length !== index.embedding.dimensions) {
    throw new Error(
      `Query embeddings have ${String(embedding.length)} dimensions but the index has ` +
        `${String(index.embedding.dimensions)}. Pass the same embeddingProviderOptions used to ` +
        'build it, e.g. { openai: { dimensions: 512 } }.',
    );
  }
  return embedding;
}

/**
 * The limiter a handler uses when it is given none: `limit` requests a minute per client IP, per
 * instance. A request without an `X-Forwarded-For` header has no client IP to key on, so all
 * such requests share one bucket: on a platform that does not set the header, that is one limit
 * for every client, which errs on the safe side rather than letting them through unlimited. The
 * first one is reported, with the fix.
 */
export function defaultRateLimit(
  limit: number,
  what: string,
  report: (error: unknown) => void,
): RateLimiter {
  const limiter = memoryRateLimit({ limit, windowMs: 60_000 });
  let reported = false;
  return (request) => {
    if (!reported && !request.headers.get('x-forwarded-for')?.trim()) {
      reported = true;
      report(
        new Error(
          'The default rate limit found no X-Forwarded-For header, so every request without one ' +
            `shares a single bucket of ${String(limit)} ${what} a minute. ` +
            "Pass rateLimit: memoryRateLimit({ trustedHeader: '<the client IP header your " +
            "platform sets>' }), or rateLimit: false if something else limits this endpoint.",
        ),
      );
    }
    return limiter(request);
  };
}
