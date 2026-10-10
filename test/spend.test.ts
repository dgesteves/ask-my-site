import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import {
  createAskHandler,
  memoryAnswerCache,
  memoryBudgetStore,
  normalizeQuestion,
  upstashAnswerCache,
  upstashBudgetStore,
  type AskHandlerOptions,
  type BudgetStore,
} from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

type Part = Record<string, unknown> & { type: string };

async function readParts(response: Response): Promise<Part[]> {
  return (await response.text())
    .split('\n\n')
    .map((event) => event.replace(/^data: /, '').trim())
    .filter((event) => event && event !== '[DONE]')
    .map((event) => JSON.parse(event) as Part);
}

const answerOf = (parts: Part[]): string =>
  parts
    .filter((p) => p.type === 'text-delta')
    .map((p) => String(p.delta))
    .join('');

/** A model that answers with `words`, reporting 120 input and 9 output tokens. */
function scriptedModel(words = ['Vectors are ', 'stored as ', 'int8 ', '[1].'], finish = 'stop') {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            ...words.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end' as const, id: 't' },
            {
              type: 'finish' as const,
              finishReason: { unified: finish as 'stop', raw: finish },
              usage: {
                inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 9, text: 9, reasoning: 0 },
              },
            },
          ],
        }),
      }),
  });
}

function setup(
  overrides: Partial<Omit<AskHandlerOptions, 'model'>> & { model?: MockLanguageModelV4 } = {},
) {
  const model = overrides.model ?? scriptedModel();
  const onFinish = vi.fn();
  const onError = vi.fn();
  const handler = createAskHandler({
    index,
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    onFinish,
    onError,
    ...overrides,
    model,
  });
  return { handler, model, onFinish, onError };
}

/** Posts a question and reads the whole answer, as a browser would. */
async function ask(
  handler: (request: Request) => Promise<Response>,
  question: string,
  ip?: string,
): Promise<Response> {
  const response = await handler(post(question, ip));
  const text = await response.text();
  return new Response(text, { status: response.status, headers: response.headers });
}

const post = (question: string, ip = '203.0.113.7'): Request =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ question }),
  });

const QUESTION = 'How are int8 vectors stored?';
/** 2026-10-10T18:00:00Z: six hours before the budget's day ends. */
const EVENING = Date.UTC(2026, 9, 10, 18);

/** A store that records every counter it holds, for checking what was counted. */
function countingStore(): BudgetStore & { counters: Map<string, number> } {
  const counters = new Map<string, number>();
  return {
    counters,
    increment(key, amount) {
      const value = (counters.get(key) ?? 0) + amount;
      counters.set(key, value);
      return value;
    },
  };
}

describe('budget', () => {
  it('turns questions away for the rest of the UTC day once requestsPerDay is spent', async () => {
    let now = EVENING;
    const { handler, model } = setup({ budget: { requestsPerDay: 2, now: () => now } });

    expect((await ask(handler, QUESTION, '198.51.100.1')).status).toBe(200);
    expect((await ask(handler, QUESTION, '198.51.100.2')).status).toBe(200);
    // A new visitor does not get a new budget: it is the site's, not the client's.
    const spent = await ask(handler, QUESTION, '198.51.100.3');
    expect(spent.status).toBe(429);
    expect(spent.headers.get('retry-after')).toBe(String(6 * 3600));
    expect(await spent.json()).toEqual({
      error: {
        code: 'budget_exceeded',
        message: 'The assistant has reached its daily limit. Please try again later.',
      },
    });
    expect(model.doStreamCalls).toHaveLength(2);

    now += 6 * 3600 * 1000; // midnight UTC: a new day, a new budget
    expect((await ask(handler, QUESTION)).status).toBe(200);
  });

  it('reserves an answer’s worst case, then counts the tokens it really used', async () => {
    const store = countingStore();
    const { handler, model } = setup({
      budget: { tokensPerDay: 100_000, store, now: () => EVENING },
    });
    await ask(handler, QUESTION);
    await ask(handler, QUESTION);

    // Two answers of 120 input + 9 output tokens each.
    expect(store.counters.get('ask-my-site:budget:tokens:2026-10-10')).toBe(258);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('lets an answer through only if its worst case fits, so concurrent answers cannot overshoot', async () => {
    // What one answer reserves: its prompt, pessimistically, plus 800 output tokens.
    const amounts: number[] = [];
    const probe = setup({
      budget: {
        tokensPerDay: 1_000_000,
        store: { increment: (_, amount) => (amounts.push(amount), amount) },
      },
    });
    await ask(probe.handler, QUESTION);
    const estimate = amounts[0] ?? 0;
    expect(estimate).toBeGreaterThan(800);

    // Room for one reservation, not two, though both answers would really fit.
    const store = countingStore();
    const { handler, model } = setup({
      budget: { tokensPerDay: Math.floor(estimate * 1.5), store, now: () => EVENING },
    });
    const [first, second] = await Promise.all([
      handler(post(QUESTION, '198.51.100.1')),
      handler(post(QUESTION, '198.51.100.2')),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 429]);
    const [answered, rejected] = first.status === 200 ? [first, second] : [second, first];
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
      'budget_exceeded',
    );
    await answered.text();

    expect(model.doStreamCalls).toHaveLength(1);
    // The rejected reservation was given back; only the real usage is left.
    expect(store.counters.get('ask-my-site:budget:tokens:2026-10-10')).toBe(129);
  });

  it('turns an answer away without calling the model when even one does not fit', async () => {
    const store = countingStore();
    const { handler, model } = setup({ budget: { tokensPerDay: 500, store } });
    const response = await ask(handler, QUESTION);

    expect(response.status).toBe(429);
    expect(model.doStreamCalls).toHaveLength(0);
    expect([...store.counters.values()]).toEqual([0]);
  });

  it('keeps the reservation of an answer the visitor abandoned', async () => {
    const store = countingStore();
    const slow = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: simulateReadableStream({
            initialDelayInMs: 0,
            chunkDelayInMs: 50,
            chunks: [
              { type: 'text-start' as const, id: 't' },
              ...Array.from({ length: 20 }, () => ({
                type: 'text-delta' as const,
                id: 't',
                delta: 'word ',
              })),
            ],
          }),
        }),
    });
    const { handler } = setup({ model: slow, budget: { tokensPerDay: 100_000, store } });
    const controller = new AbortController();
    const response = await handler(
      new Request('http://localhost/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
        body: JSON.stringify({ question: QUESTION }),
        signal: controller.signal,
      }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // No usage arrived, so the worst case stays counted.
    expect([...store.counters.values()][0]).toBeGreaterThan(800);
  });

  it('fails closed when its store fails, or open when told to', async () => {
    const outage = new Error('Redis unreachable');
    const store: BudgetStore = { increment: () => Promise.reject(outage) };

    const closed = setup({ budget: { requestsPerDay: 100, store } });
    const response = await ask(closed.handler, QUESTION);
    expect(response.status).toBe(503);
    expect(closed.model.doStreamCalls).toHaveLength(0);
    expect(closed.onError).toHaveBeenCalledWith(outage);

    const open = setup({
      budget: { requestsPerDay: 100, tokensPerDay: 100_000, store },
      rateLimitFailure: 'open',
    });
    expect((await ask(open.handler, QUESTION)).status).toBe(200);
  });

  it('rejects limits that are not positive integers', () => {
    expect(() => setup({ budget: { requestsPerDay: 0 } })).toThrow(/requestsPerDay/);
    expect(() => setup({ budget: { tokensPerDay: 1.5 } })).toThrow(/tokensPerDay/);
  });

  it('memoryBudgetStore counts per key and forgets a counter once it expires', () => {
    let now = 0;
    const store = memoryBudgetStore({ now: () => now });
    expect(store.increment('a', 5, 10)).toBe(5);
    expect(store.increment('a', -2, 10)).toBe(3);
    expect(store.increment('b', 1, 10)).toBe(1);
    now = 10_000;
    expect(store.increment('a', 1, 10)).toBe(1);
  });

  it('upstashBudgetStore increments atomically and sets the lifetime on a new counter', async () => {
    const values = new Map<string, number>();
    const redis = {
      incrby: vi.fn((key: string, by: number) => {
        values.set(key, (values.get(key) ?? 0) + by);
        return Promise.resolve(values.get(key) ?? 0);
      }),
      expire: vi.fn(() => Promise.resolve(1)),
    };
    const store = upstashBudgetStore(redis);
    expect(await store.increment('k', 4, 60)).toBe(4);
    expect(await store.increment('k', 4, 60)).toBe(8);
    expect(redis.expire.mock.calls).toEqual([['k', 60]]);
  });
});

describe('answer cache', () => {
  it('answers a question asked again without embedding it or calling the model', async () => {
    const embedding = new MockEmbeddingModelV4({
      modelId: embeddingModel.modelId,
      doEmbed: (options) => embeddingModel.doEmbed(options),
    });
    const { handler, model, onFinish } = setup({ embeddingModel: embedding, answerCache: true });

    const first = await readParts(await handler(post(QUESTION)));
    const again = await readParts(await handler(post('  how are INT8 vectors stored  ')));

    expect(model.doStreamCalls).toHaveLength(1);
    expect(embedding.doEmbedCalls).toHaveLength(1);
    expect(answerOf(again)).toBe(answerOf(first));
    expect(again.filter((p) => p.type === 'source-url')).toEqual(
      first.filter((p) => p.type === 'source-url'),
    );
    expect(again[0]).toMatchObject({ messageMetadata: { refused: false, retrieval: 'hybrid' } });
    expect(again.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' });
    expect(onFinish.mock.calls.map(([event]) => (event as { cached: boolean }).cached)).toEqual([
      false,
      true,
    ]);

    await (await handler(post('What is the pricing?'))).text();
    expect(embedding.doEmbedCalls).toHaveLength(2);
  });

  it('serves cached answers without spending the budget', async () => {
    const { handler, model } = setup({ answerCache: true, budget: { requestsPerDay: 1 } });
    for (let i = 0; i < 3; i += 1) expect((await ask(handler, QUESTION)).status).toBe(200);
    expect(model.doStreamCalls).toHaveLength(1);
    expect((await ask(handler, 'Something else entirely about pnpm')).status).toBe(429);
  });

  it('starts fresh for a rebuilt index, sharing one store', async () => {
    const store = memoryAnswerCache();
    const first = setup({ answerCache: { store } });
    await (await first.handler(post(QUESTION))).text();
    const rebuilt = await buildIndex({
      documents: [...corpus, { id: 'new.md', url: '/new', title: 'New', content: 'New page.' }],
      embeddingModel,
    });
    const second = setup({ index: rebuilt.index, answerCache: { store } });
    await (await second.handler(post(QUESTION))).text();
    expect(second.model.doStreamCalls).toHaveLength(1);
  });

  it('keeps neither truncated answers nor keyword-fallback answers', async () => {
    const truncated = setup({ model: scriptedModel(['Vectors are'], 'length'), answerCache: true });
    await (await truncated.handler(post(QUESTION))).text();
    await (await truncated.handler(post(QUESTION))).text();
    expect(truncated.model.doStreamCalls).toHaveLength(2);

    const failing = new MockEmbeddingModelV4({
      modelId: embeddingModel.modelId,
      doEmbed: () => Promise.reject(new Error('provider down')),
    });
    const fallback = setup({ embeddingModel: failing, answerCache: true });
    await (await fallback.handler(post('upstash ratelimit'))).text();
    await (await fallback.handler(post('upstash ratelimit'))).text();
    expect(fallback.model.doStreamCalls).toHaveLength(2);
  });

  it('answers anew when its store fails, reporting the failure', async () => {
    const outage = new Error('cache down');
    const { handler, onError } = setup({
      answerCache: { store: { get: () => Promise.reject(outage), set: () => undefined } },
    });
    expect((await handler(post(QUESTION))).status).toBe(200);
    expect(onError).toHaveBeenCalledWith(outage);
  });

  it('upstashAnswerCache stores JSON with a lifetime and ignores values it did not write', async () => {
    const values = new Map<string, unknown>();
    const redis = {
      get: (key: string) => Promise.resolve(values.get(key) ?? null),
      set: vi.fn((key: string, value: string, _options: { ex: number }) => {
        values.set(key, value);
        return Promise.resolve('OK');
      }),
    };
    const store = upstashAnswerCache(redis);
    const { handler, model } = setup({ answerCache: { store, ttlSeconds: 600 } });
    await (await handler(post(QUESTION))).text();
    await (await handler(post(QUESTION))).text();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(redis.set.mock.calls[0]?.[2]).toEqual({ ex: 600 });

    // `@upstash/redis` hands back parsed JSON; anything that is not an answer is a miss.
    const [key] = [...values.keys()];
    values.set(key!, JSON.parse(String(values.get(key!))));
    await (await handler(post(QUESTION))).text();
    expect(model.doStreamCalls).toHaveLength(1);
    values.set(key!, { answer: 42 });
    await (await handler(post(QUESTION))).text();
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('normalizes case, spacing and trailing punctuation only', () => {
    expect(normalizeQuestion('  How do I   install it?! ')).toBe('how do i install it');
    expect(normalizeQuestion('ｈｏｗ do I install it？')).toBe('how do i install it');
    expect(normalizeQuestion('How do I install it, really?')).toBe('how do i install it, really');
  });
});
