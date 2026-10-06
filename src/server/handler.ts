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
import { buildSources, defaultInstructions, formatPrompt } from './prompt';
import type { RateLimiter } from './rate-limit';

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
  /** Answer used when retrieval finds nothing relevant. The model is not called. */
  noAnswerMessage?: string;
  rateLimit?: RateLimiter;
  generation?: GenerationOptions;
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
  retrieval: RetrievalResult;
  usage?: LanguageModelUsage;
}

const MAX_BODY_BYTES = 32 * 1024;
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

  return async function handleAsk(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(
        405,
        { error: { code: 'method_not_allowed', message: 'Use POST.' } },
        { allow: 'POST' },
      );
    }

    if (options.rateLimit) {
      const limit = await options.rateLimit(request);
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

    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json(413, {
        error: { code: 'payload_too_large', message: 'Request body too large.' },
      });
    }
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return json(400, { error: { code: 'invalid_json', message: 'Could not read the body.' } });
    }
    if (raw.length > MAX_BODY_BYTES) {
      return json(413, {
        error: { code: 'payload_too_large', message: 'Request body too large.' },
      });
    }
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

    let index: LoadedIndex;
    let queryVector: number[] | null;
    try {
      index = await getIndex();
      queryVector = await embedQuery(question, index, options, request.signal, reportError);
    } catch (error) {
      reportError(error);
      return json(500, {
        error: { code: 'internal_error', message: 'The ask endpoint is misconfigured.' },
      });
    }

    const retrieval = retrieve(index, { text: question, vector: queryVector }, options.retrieval);
    const promptSources = buildSources(retrieval.hits, maxContextChars);
    const sources: AskSource[] = promptSources.map(({ id, url, title, heading }) => ({
      id,
      url,
      title,
      heading,
    }));
    const metadata: AskMetadata = { refused: !retrieval.answerable, retrieval: retrieval.mode };

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageMetadata: metadata });
        for (const source of sources) {
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

        if (!retrieval.answerable) {
          const id = generateId();
          writer.write({ type: 'text-start', id });
          writer.write({ type: 'text-delta', id, delta: noAnswerMessage });
          writer.write({ type: 'text-end', id });
          writer.write({ type: 'finish', finishReason: 'stop' });
          return options.onFinish?.({
            question,
            answer: noAnswerMessage,
            sources,
            refused: true,
            retrieval,
          });
        }

        const result = streamText({
          maxOutputTokens: 800,
          ...options.generation,
          model: options.model,
          instructions,
          prompt: formatPrompt(question, promptSources),
          abortSignal: request.signal,
          onError: ({ error }) => {
            reportError(error);
          },
          onEnd: async (event) => {
            await options.onFinish?.({
              question,
              answer: event.text,
              sources,
              refused: false,
              retrieval,
              usage: event.usage,
            });
          },
        });
        writer.merge(
          toUIMessageStream({
            stream: result.stream,
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
