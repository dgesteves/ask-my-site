import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  embed,
  generateId,
  streamText,
  toUIMessageStream,
  type EmbeddingModel,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import { z } from 'zod';

import { embeddingModelId, sameEmbeddingModel, type EmbeddingProviderOptions } from '../build';
import { sha256 } from '../hash';
import {
  SOURCE_METADATA_KEY,
  type AskErrorBody,
  type AskMetadata,
  type AskSource,
} from '../protocol';
import {
  loadIndex,
  retrieve,
  type LoadedIndex,
  type RetrievalOptions,
  type RetrievalResult,
} from '../search/retrieve';
import { createBudget, type BudgetOptions } from './budget';
import {
  memoryAnswerCache,
  normalizeQuestion,
  parseCachedAnswer,
  type AnswerCacheOptions,
  type CachedAnswer,
} from './cache';
import { buildSources, defaultInstructions, formatPrompt } from './prompt';
import type { RateLimiter, RateLimitResult } from './rate-limit';

type StreamTextOptions = Parameters<typeof streamText>[0];

/** Model settings passed through to `streamText`. */
export type GenerationOptions = Pick<
  StreamTextOptions,
  | 'maxOutputTokens'
  | 'temperature'
  | 'topP'
  | 'seed'
  | 'providerOptions'
  | 'maxRetries'
  | 'timeout'
  | 'headers'
  | 'telemetry'
>;

/**
 * The index in any form `loadIndex` accepts: the parsed JSON (`import index from
 * './ask-index.json'`), its text, or an already loaded index.
 */
export type IndexSource = object | string;

export interface AskHandlerOptions {
  /**
   * The index: `import index from './ask-index.json'`, its JSON text, the result of `loadIndex`,
   * or a (possibly async) function returning any of those, called once on the first request.
   */
  index: IndexSource | (() => IndexSource | Promise<IndexSource>);
  /** Any AI SDK language model, e.g. `openai('gpt-5.4-mini')`, or a gateway model id. */
  model: LanguageModel;
  /**
   * The model the index was embedded with. Without it, retrieval is keyword-only. If embedding a
   * query fails at runtime, that request falls back to keywords instead of failing.
   */
  embeddingModel?: EmbeddingModel;
  /** Must match what the index was built with, e.g. `{ openai: { dimensions: 512 } }`. */
  embeddingProviderOptions?: EmbeddingProviderOptions;
  /** Used in the default instructions and the "I don't know" message. Default `"this site"`. */
  siteName?: string;
  /** Replace the system instructions, or extend the defaults: `(defaults) => defaults + '…'`. */
  instructions?: string | ((defaults: string) => string);
  retrieval?: RetrievalOptions;
  /** Upper bound on source text sent to the model, in characters. Default 8000. */
  maxContextChars?: number;
  /** Longest accepted question, in characters. Default 500. */
  maxQuestionLength?: number;
  /**
   * Largest accepted request body, in bytes, enforced while reading. Default 64 KiB, which fits
   * the conversation history `useChat` sends for many turns.
   */
  maxBodyBytes?: number;
  /** Answer used when retrieval finds nothing relevant. The model is not called. */
  noAnswerMessage?: string;
  rateLimit?: RateLimiter;
  /**
   * What to do when `rateLimit` throws or rejects, e.g. because Redis is unreachable. `"closed"`
   * (the default) answers 503 without calling the model; `"open"` answers as if the request were
   * allowed. Either way the error goes to `onError`. The `budget` store's failures are handled
   * the same way.
   */
  rateLimitFailure?: 'closed' | 'open';
  generation?: GenerationOptions;
  /**
   * A daily cap on spend: `{ requestsPerDay, tokensPerDay }`, counted in `store` (memory, per
   * instance, by default). Once it is spent, questions get a 429 with code `budget_exceeded`
   * until the next UTC day, without a model call.
   */
  budget?: BudgetOptions;
  /**
   * Answers a question asked again from a cache, without embedding it or calling the model:
   * `true` for the memory store, or `{ store, ttlSeconds }`. Keyed by the index's content hash
   * and the normalized question, so a rebuilt index starts fresh.
   */
  answerCache?: boolean | AnswerCacheOptions;
  /** Extra headers on every response, e.g. for CORS. */
  headers?: Record<string, string>;
  /** Called once per answered request, after the answer is complete. */
  onFinish?: (event: AskFinishEvent) => void | Promise<void>;
  /** Called with errors that were handled (embedding fallback, model errors). Default `console.error`. */
  onError?: (error: unknown) => void;
}

export interface AskFinishEvent {
  question: string;
  answer: string;
  sources: AskSource[];
  refused: boolean;
  /**
   * For an answer from `answerCache`, `hits` is empty (nothing was retrieved) and `best` is what
   * the original answer saw.
   */
  retrieval: RetrievalResult;
  usage?: LanguageModelUsage;
  /** True when the answer came from `answerCache`, so no model was called. */
  cached: boolean;
}

/** Status for a request the client abandoned (nginx's convention); nobody reads the body. */
const CLIENT_CLOSED = 499;

/**
 * Reads the body as UTF-8, giving up as soon as it exceeds `limit` bytes. `Content-Length` is
 * advisory (chunked requests have none), so the bytes are counted as they arrive.
 */
async function readBody(request: Request, limit: number): Promise<string | null> {
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
const isJson = (contentType: string | null): boolean =>
  contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';

const MODEL_ERROR_MESSAGE = 'The answer could not be generated. Please try again.';

const requestSchema = z.union([
  z.object({ question: z.string() }),
  // `useChat` from @ai-sdk/react posts the conversation; the latest user message is the question.
  z.object({
    messages: z
      .array(
        z.object({
          role: z.string(),
          content: z.string().optional(),
          parts: z
            .array(z.looseObject({ type: z.string(), text: z.unknown().optional() }))
            .optional(),
        }),
      )
      .min(1),
  }),
]);

function questionFrom(body: z.infer<typeof requestSchema>): string {
  if ('question' in body) return body.question.trim();
  const last = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  const fromParts = (last.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n');
  return (fromParts || last.content || '').trim();
}

/**
 * Creates the ask endpoint: a Web-standard `(request: Request) => Promise<Response>`.
 *
 * Mount it anywhere that speaks `Request`/`Response`: a Next.js route handler
 * (`export const POST = createAskHandler(…)`), Hono, an edge function, `Bun.serve`, Deno.
 *
 * Per request: validate → rate-limit → embed the question → hybrid retrieval → if nothing is
 * relevant, stream the "I don't know" message without calling the model; otherwise stream a
 * grounded, cited answer as an AI SDK UI message stream.
 */
export function createAskHandler(
  options: AskHandlerOptions,
): (request: Request) => Promise<Response> {
  const siteName = options.siteName ?? 'this site';
  const maxQuestionLength = options.maxQuestionLength ?? 500;
  const maxContextChars = options.maxContextChars ?? 8000;
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const noAnswerMessage =
    options.noAnswerMessage ?? `I don't know. I couldn't find anything about that on ${siteName}.`;
  const instructions =
    typeof options.instructions === 'function'
      ? options.instructions(defaultInstructions(siteName))
      : (options.instructions ?? defaultInstructions(siteName));
  const reportError =
    options.onError ??
    ((error: unknown) => {
      console.error('[ask-my-site]', error);
    });
  const baseHeaders = { 'cache-control': 'no-store', ...options.headers };
  // The answer has already streamed when `onFinish` runs, so its failure (an analytics write,
  // say) is reported, never turned into an error part the visitor sees.
  const finish = async (event: AskFinishEvent): Promise<void> => {
    try {
      await options.onFinish?.(event);
    } catch (error) {
      reportError(error);
    }
  };

  let indexPromise: Promise<LoadedIndex> | null = null;
  const getIndex = (): Promise<LoadedIndex> => {
    indexPromise ??= resolveIndex(options).catch((error: unknown) => {
      // A failed load (a network blip fetching the file) should not poison every later request.
      indexPromise = null;
      throw error;
    });
    return indexPromise;
  };

  const json = (status: number, body: AskErrorBody, headers?: Record<string, string>): Response =>
    Response.json(body, { status, headers: { ...baseHeaders, ...headers } });

  const maxOutputTokens = options.generation?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const budget = options.budget ? createBudget(options.budget) : null;
  const cache = options.answerCache
    ? answerCache(options.answerCache, options, instructions)
    : null;
  const unavailable = (): Response =>
    json(503, {
      error: {
        code: 'service_unavailable',
        message: 'The service is unavailable. Try again shortly.',
      },
    });
  /**
   * Runs a budget check: `{ response }` turns the request away, with a 429 once the day's budget
   * is spent or a 503 when the store fails; `{ result }` lets it through (`result` is `null` when
   * the store failed and `rateLimitFailure` is `"open"`).
   */
  const overBudget = async <T extends { allowed: boolean; resetAt?: number }>(
    check: () => Promise<T>,
  ): Promise<{ response: Response } | { result: T | null }> => {
    let result: T;
    try {
      result = await check();
    } catch (error) {
      reportError(error);
      return options.rateLimitFailure === 'open' ? { result: null } : { response: unavailable() };
    }
    if (result.allowed || !budget) return { result };
    const now = options.budget?.now ?? Date.now;
    const seconds = Math.max(1, Math.ceil(((result.resetAt ?? 0) - now()) / 1000));
    return {
      response: json(
        429,
        { error: { code: 'budget_exceeded', message: budget.message } },
        { 'retry-after': String(seconds) },
      ),
    };
  };

  return async function handleAsk(request: Request): Promise<Response> {
    // CORS preflight: `useAsk` posts JSON, so cross-origin requests are always preflighted.
    // Answer with the configured headers (put the access-control-* ones in `headers`).
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...baseHeaders, allow: 'POST, OPTIONS' },
      });
    }
    if (request.method !== 'POST') {
      return json(
        405,
        { error: { code: 'method_not_allowed', message: 'Use POST.' } },
        { allow: 'POST, OPTIONS' },
      );
    }

    // Browsers send a cross-origin POST without a CORS preflight only if its content type is
    // text/plain, a form encoding or absent. Requiring JSON forces the preflight, which fails
    // unless `headers` allows the origin, so other sites cannot spend your model budget through
    // their visitors' browsers.
    if (!isJson(request.headers.get('content-type'))) {
      return json(415, {
        error: { code: 'unsupported_media_type', message: 'Send the body as application/json.' },
      });
    }

    if (options.rateLimit) {
      let limit: RateLimitResult;
      try {
        limit = await options.rateLimit(request);
      } catch (error) {
        // Failing closed by default: the limiter is what stands between the endpoint and an
        // unbounded model bill, and its outage can be provoked (a flood can exhaust a Redis
        // plan's request quota), so an error should not quietly switch it off.
        reportError(error);
        if (options.rateLimitFailure !== 'open') {
          return json(503, {
            error: {
              code: 'service_unavailable',
              message: 'The service is unavailable. Try again shortly.',
            },
          });
        }
        limit = { success: true };
      }
      if (!limit.success) {
        const headers: Record<string, string> = {};
        if (limit.reset !== undefined) {
          const seconds = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
          headers['retry-after'] = String(seconds);
          headers['ratelimit-reset'] = String(seconds);
        }
        if (limit.limit !== undefined) headers['ratelimit-limit'] = String(limit.limit);
        if (limit.remaining !== undefined) headers['ratelimit-remaining'] = String(limit.remaining);
        return json(
          429,
          { error: { code: 'rate_limited', message: 'Too many questions. Try again shortly.' } },
          headers,
        );
      }
    }

    const tooLarge = (): Response =>
      json(413, { error: { code: 'payload_too_large', message: 'Request body too large.' } });
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return tooLarge();
    let raw: string | null;
    try {
      raw = await readBody(request, maxBodyBytes);
    } catch {
      return json(400, { error: { code: 'invalid_json', message: 'Could not read the body.' } });
    }
    if (raw === null) return tooLarge();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: { code: 'invalid_json', message: 'Body must be JSON.' } });
    }
    const parsed = requestSchema.safeParse(body);
    const question = parsed.success ? questionFrom(parsed.data) : '';
    if (!question) {
      return json(400, {
        error: { code: 'invalid_request', message: 'Send { "question": string }.' },
      });
    }
    if (question.length > maxQuestionLength) {
      return json(400, {
        error: {
          code: 'invalid_request',
          message: `Questions are limited to ${String(maxQuestionLength)} characters.`,
        },
      });
    }

    // A client that hung up while the index loaded or the question was embedded is not an error
    // worth reporting.
    const misconfigured = (error: unknown): Response => {
      if (request.signal.aborted) return new Response(null, { status: CLIENT_CLOSED });
      reportError(error);
      return json(500, {
        error: { code: 'internal_error', message: 'The ask endpoint is misconfigured.' },
      });
    };

    let index: LoadedIndex;
    try {
      index = await getIndex();
    } catch (error) {
      return misconfigured(error);
    }

    const cacheKey = cache ? await cache.key(index, question) : null;
    if (cache && cacheKey) {
      const hit = await cache.get(cacheKey, reportError);
      if (hit) {
        return respond(hit, null, () =>
          finish({
            question,
            answer: hit.answer,
            sources: hit.sources,
            refused: hit.refused,
            retrieval: { hits: [], answerable: !hit.refused, mode: hit.retrieval, best: hit.best },
            cached: true,
          }),
        );
      }
    }

    if (budget) {
      const admitted = await overBudget(() => budget.admit());
      if ('response' in admitted) return admitted.response;
    }

    let queryVector: number[] | null;
    try {
      queryVector = await embedQuery(question, index, options, request.signal, reportError);
    } catch (error) {
      return misconfigured(error);
    }

    const retrieval = retrieve(index, { text: question, vector: queryVector }, options.retrieval);
    const promptSources = buildSources(retrieval.hits, maxContextChars);
    const sources: AskSource[] = promptSources.map(({ id, url, title, heading }) => ({
      id,
      url,
      title,
      heading,
    }));
    const answer: CachedAnswer = {
      answer: retrieval.answerable ? '' : noAnswerMessage,
      sources,
      refused: !retrieval.answerable,
      retrieval: retrieval.mode,
      best: retrieval.best,
    };
    // An answer made while the embedding provider was down (keyword fallback) is not kept, so the
    // cache never serves a worse answer than the next request would get.
    const remember = (text: string): void => {
      if (!cache || !cacheKey || retrieval.mode !== expectedMode(index, options)) return;
      cache.set(cacheKey, { ...answer, answer: text }, reportError);
    };

    if (!retrieval.answerable) {
      remember(noAnswerMessage);
      return respond(answer, null, () =>
        finish({
          question,
          answer: noAnswerMessage,
          sources,
          refused: true,
          retrieval,
          cached: false,
        }),
      );
    }

    const prompt = formatPrompt(question, promptSources);
    let settle: ((actual: number | undefined) => Promise<void>) | null = null;
    if (budget) {
      // The worst case: the prompt at a pessimistic three characters a token, plus every output
      // token allowed. Settled to the real usage when the answer ends.
      const estimate = Math.ceil((instructions.length + prompt.length) / 3) + maxOutputTokens;
      const reserved = await overBudget(() => budget.reserve(estimate));
      if ('response' in reserved) return reserved.response;
      if (reserved.result?.allowed) settle = reserved.result.settle;
    }

    return respond(answer, () => {
      let failed = false;
      return streamText({
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        ...options.generation,
        model: options.model,
        instructions,
        prompt,
        abortSignal: request.signal,
        onError: ({ error }) => {
          failed = true;
          reportError(error);
        },
        onEnd: async (event) => {
          if (settle) {
            const { totalTokens, inputTokens, outputTokens } = event.usage;
            const used =
              totalTokens ??
              (inputTokens === undefined && outputTokens === undefined
                ? undefined
                : (inputTokens ?? 0) + (outputTokens ?? 0));
            await settle(used).catch(reportError);
          }
          if (!failed && event.finishReason === 'stop') remember(event.text);
          await finish({
            question,
            answer: event.text,
            sources,
            refused: false,
            retrieval,
            usage: event.usage,
            cached: false,
          });
        },
        // A client that hung up is not an error; `generation.timeout` firing is.
        onAbort: ({ reason }) => {
          if (request.signal.aborted) return;
          reportError(new Error('The answer was aborted before it finished.', { cause: reason }));
        },
      });
    });
  };

  /**
   * Streams an answer: metadata, the numbered sources, then the text, either `answer.answer` as
   * it is (a refusal or a cached answer, followed by `done`) or the model's stream from `generate`.
   */
  function respond(
    answer: CachedAnswer,
    generate: (() => ReturnType<typeof streamText>) | null,
    done?: () => Promise<void>,
  ): Response {
    const metadata: AskMetadata = { refused: answer.refused, retrieval: answer.retrieval };
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageMetadata: metadata });
        for (const source of answer.sources) {
          writer.write({
            type: 'source-url',
            sourceId: String(source.id),
            url: source.url,
            title: source.heading ? `${source.title} › ${source.heading}` : source.title,
            providerMetadata: {
              [SOURCE_METADATA_KEY]: { title: source.title, heading: source.heading },
            },
          });
        }

        if (!generate) {
          const id = generateId();
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: answer.answer });
          writer.write({ type: 'text-end', id });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return done?.();
        }

        writer.merge(
          toUIMessageStream({
            stream: generate().stream,
            sendStart: false,
            onError: () => MODEL_ERROR_MESSAGE,
          }),
        );
        return undefined;
      },
      onError: (error) => {
        reportError(error);
        return MODEL_ERROR_MESSAGE;
      },
    });

    return createUIMessageStreamResponse({
      stream,
      headers: { ...baseHeaders, 'x-accel-buffering': 'no' },
    });
  }
}

const DEFAULT_MAX_OUTPUT_TOKENS = 800;

/** How retrieval runs when nothing fails: hybrid with an embedding model and vectors. */
function expectedMode(index: LoadedIndex, options: AskHandlerOptions): 'hybrid' | 'keyword' {
  return options.embeddingModel && index.vectors && index.embedding ? 'hybrid' : 'keyword';
}

const modelName = (model: LanguageModel): string =>
  typeof model === 'string' ? model : `${model.provider}:${model.modelId}`;

/**
 * The answer cache behind `answerCache`. A key covers the index's content hash and the normalized
 * question, and what else shapes the answer (the model, the instructions, the retrieval and
 * generation settings), so a rebuilt index or a new prompt starts fresh even in a shared store.
 * The store failing never fails a request: it is reported, and the question is answered anew.
 */
function answerCache(
  cacheOptions: true | AnswerCacheOptions,
  options: AskHandlerOptions,
  instructions: string,
) {
  const {
    store = memoryAnswerCache(),
    ttlSeconds = 86_400,
    prefix = 'ask-my-site:answer:',
  } = cacheOptions === true ? {} : cacheOptions;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError(
      `answerCache.ttlSeconds must be a positive integer (got ${String(ttlSeconds)}).`,
    );
  }
  let settings: Promise<string> | null = null;
  return {
    key: async (index: LoadedIndex, question: string): Promise<string> => {
      settings ??= sha256(
        JSON.stringify([
          modelName(options.model),
          instructions,
          options.noAnswerMessage ?? null,
          options.retrieval ?? null,
          options.maxContextChars ?? null,
          options.generation?.maxOutputTokens ?? null,
        ]),
      );
      const digest = await sha256(
        JSON.stringify([index.contentHash, await settings, normalizeQuestion(question)]),
      );
      return `${prefix}${digest}`;
    },
    get: async (key: string, report: (error: unknown) => void): Promise<CachedAnswer | null> => {
      try {
        return parseCachedAnswer(await store.get(key));
      } catch (error) {
        report(error);
        return null;
      }
    },
    set: (key: string, value: CachedAnswer, report: (error: unknown) => void): void => {
      try {
        void Promise.resolve(store.set(key, value, ttlSeconds)).catch(report);
      } catch (error) {
        report(error);
      }
    },
  };
}

async function resolveIndex(options: AskHandlerOptions): Promise<LoadedIndex> {
  const source: unknown =
    typeof options.index === 'function' ? await options.index() : options.index;
  const index = isLoadedIndex(source) ? source : loadIndex(unwrapModule(source));

  const model = options.embeddingModel;
  if (
    index.embedding &&
    model &&
    !sameEmbeddingModel(index.embedding.model, embeddingModelId(model))
  ) {
    throw new Error(
      `The index was embedded with "${index.embedding.model}" but the handler embeds queries with ` +
        `"${embeddingModelId(model)}". Rebuild the index or pass the same embeddingModel.`,
    );
  }
  return index;
}

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

async function embedQuery(
  question: string,
  index: LoadedIndex,
  options: AskHandlerOptions,
  abortSignal: AbortSignal,
  reportError: (error: unknown) => void,
): Promise<number[] | null> {
  if (!options.embeddingModel || !index.vectors || !index.embedding) return null;
  let embedding: number[];
  try {
    ({ embedding } = await embed({
      model: options.embeddingModel,
      value: question,
      maxRetries: 1,
      abortSignal,
      ...(options.embeddingProviderOptions
        ? { providerOptions: options.embeddingProviderOptions }
        : {}),
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
