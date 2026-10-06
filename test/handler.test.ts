import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { buildIndex, serializeIndexFile } from '../src';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel } from '../src/mock';
import { createAskHandler, type AskHandlerOptions } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

type Part = Record<string, unknown> & { type: string };

/** Reads a UI message stream response into its JSON parts. */
async function readParts(response: Response): Promise<{ parts: Part[]; done: boolean }> {
  const text = await response.text();
  const events = text
    .split('\n\n')
    .map((event) => event.replace(/^data: /, '').trim())
    .filter(Boolean);
  return {
    parts: events.filter((e) => e !== '[DONE]').map((e) => JSON.parse(e) as Part),
    done: events.at(-1) === '[DONE]',
  };
}

const answerOf = (parts: Part[]): string =>
  parts
    .filter((p) => p.type === 'text-delta')
    .map((p) => String(p.delta))
    .join('');

function scriptedModel(words: string[]) {
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
              finishReason: { unified: 'stop' as const, raw: 'stop' },
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

function setup(overrides: Partial<AskHandlerOptions> = {}) {
  const model = scriptedModel(['Vectors are ', 'stored as ', 'int8 ', '[1].']);
  const onFinish = vi.fn();
  const onError = vi.fn();
  const handler = createAskHandler({
    index,
    model,
    embeddingModel,
    siteName: 'Acme Docs',
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    onFinish,
    onError,
    ...overrides,
  });
  return { handler, model, onFinish, onError };
}

const post = (body: unknown, init: RequestInit = {}): Request =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

describe('createAskHandler', () => {
  it('streams metadata, numbered sources, then the grounded answer', async () => {
    const { handler, model, onFinish } = setup();
    const response = await handler(post({ question: 'How are int8 vectors stored?' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const { parts, done } = await readParts(response);
    expect(done).toBe(true);
    expect(parts[0]).toMatchObject({
      type: 'start',
      messageMetadata: { refused: false, retrieval: 'hybrid' },
    });
    const sources = parts.filter((p) => p.type === 'source-url');
    expect(sources[0]?.sourceId).toBe('1');
    expect(String(sources[0]?.title)).toContain('Vector quantization');
    expect(sources.map((s) => s.url)).toContain('/docs/quantization#why-int8');
    // Sources precede the text, so citations resolve as soon as they stream.
    const firstText = parts.findIndex((p) => p.type === 'text-delta');
    expect(parts.findLastIndex((p) => p.type === 'source-url')).toBeLessThan(firstText);
    expect(answerOf(parts)).toBe('Vectors are stored as int8 [1].');
    expect(parts.at(-1)).toMatchObject({ type: 'finish' });

    // The model saw the grounding rules and numbered, delimited sources.
    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === 'system');
    expect(system?.content).toContain('You are the assistant for Acme Docs');
    expect(system?.content).toContain("say that you don't know");
    const user = JSON.stringify(call.prompt.find((m) => m.role === 'user'));
    expect(user).toContain('<source id=\\"1\\"');
    expect(user).toContain('<question>\\nHow are int8 vectors stored?\\n</question>');
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);

    expect(onFinish).toHaveBeenCalledOnce();
    expect(onFinish.mock.calls[0]![0]).toMatchObject({
      question: 'How are int8 vectors stored?',
      answer: 'Vectors are stored as int8 [1].',
      refused: false,
      usage: { outputTokens: 9 },
    });
  });

  it('answers "I don\'t know" without calling the model when nothing is relevant', async () => {
    const { handler, model, onFinish } = setup();
    const response = await handler(post({ question: 'Who won the 1998 World Cup final?' }));
    const { parts } = await readParts(response);

    expect(model.doStreamCalls).toHaveLength(0);
    expect(parts[0]).toMatchObject({
      type: 'start',
      messageMetadata: { refused: true, retrieval: 'hybrid' },
    });
    expect(parts.some((p) => p.type === 'source-url')).toBe(false);
    expect(answerOf(parts)).toBe("I don't know. I couldn't find anything about that on Acme Docs.");
    expect(onFinish.mock.calls[0]![0]).toMatchObject({ refused: true, sources: [] });
  });

  it('accepts the useChat request shape', async () => {
    const { handler } = setup();
    const response = await handler(
      post({
        id: 'chat-1',
        messages: [
          { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Unrelated first turn' }] },
          { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '…' }] },
          {
            id: 'm3',
            role: 'user',
            parts: [{ type: 'text', text: 'How do I install with pnpm?' }],
          },
        ],
      }),
    );
    const { parts } = await readParts(response);
    expect(parts.filter((p) => p.type === 'source-url').map((p) => p.url)).toContain(
      '/docs/install#with-pnpm',
    );
  });

  it.each([
    ['a non-POST method', new Request('http://localhost/api/ask'), 405, 'method_not_allowed'],
    ['malformed JSON', post('{"question":'), 400, 'invalid_json'],
    ['a missing question', post({ q: 'hi' }), 400, 'invalid_request'],
    ['a blank question', post({ question: '   ' }), 400, 'invalid_request'],
    ['a question over the limit', post({ question: 'x'.repeat(501) }), 400, 'invalid_request'],
    ['an oversized body', post({ question: 'y'.repeat(40_000) }), 413, 'payload_too_large'],
  ])('rejects %s', async (_, request, status, code) => {
    const { handler, model } = setup();
    const response = await handler(request);
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(model.doStreamCalls).toHaveLength(0);
    if (status === 405) expect(response.headers.get('allow')).toBe('POST');
  });

  it('enforces the rate limit before doing any work', async () => {
    const rateLimit = vi.fn(() => ({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 30_000,
    }));
    const { handler, model } = setup({ rateLimit });
    const response = await handler(post({ question: 'How are int8 vectors stored?' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(response.headers.get('ratelimit-limit')).toBe('10');
    expect(response.headers.get('ratelimit-remaining')).toBe('0');
    expect(rateLimit).toHaveBeenCalledOnce();
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it('falls back to keyword retrieval when the embedding call fails', async () => {
    const failing = new MockEmbeddingModelV4({
      modelId: embeddingModel.modelId,
      doEmbed: () => Promise.reject(new Error('provider down')),
    });
    const { handler, onError } = setup({ embeddingModel: failing });
    const { parts } = await readParts(await handler(post({ question: 'upstash ratelimit' })));

    expect(parts[0]).toMatchObject({ messageMetadata: { retrieval: 'keyword', refused: false } });
    expect(parts.find((p) => p.type === 'source-url')).toMatchObject({
      url: '/docs/rate-limits#upstash',
    });
    expect(String(onError.mock.calls[0]?.[0])).toContain('provider down');
  });

  it('masks model errors in the stream and reports them', async () => {
    const broken = new MockLanguageModelV4({
      doStream: () => Promise.reject(new Error('upstream 500 with secret details')),
    });
    const { handler, onError } = setup({ model: broken });
    const text = await (await handler(post({ question: 'How are int8 vectors stored?' }))).text();

    expect(text).toContain('"type":"error"');
    expect(text).toContain('The answer could not be generated. Please try again.');
    expect(text).not.toContain('secret details');
    expect(onError).toHaveBeenCalled();
  });

  it('refuses to serve an index embedded with a different model', async () => {
    const other = mockEmbeddingModel({ dimensions: 64 });
    const { handler, onError } = setup({ embeddingModel: other });
    const response = await handler(post({ question: 'How are int8 vectors stored?' }));

    expect(response.status).toBe(500);
    expect(String(onError.mock.calls[0]![0])).toMatch(/mock-hash-512.*mock-hash-64/);
  });

  it('reports query embeddings of the wrong size', async () => {
    const wrongSize = new MockEmbeddingModelV4({
      modelId: embeddingModel.modelId,
      doEmbed: () => Promise.resolve({ embeddings: [[0.1, 0.2, 0.3]], warnings: [] }),
    });
    const { handler, onError } = setup({ embeddingModel: wrongSize });
    expect((await handler(post({ question: 'int8' }))).status).toBe(500);
    expect(String(onError.mock.calls[0]![0])).toContain('embeddingProviderOptions');
  });

  it('loads a lazy index once, from JSON text, and retries after a failed load', async () => {
    let calls = 0;
    const lazy = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('CDN timeout'));
      return Promise.resolve(serializeIndexFile(index));
    });
    const { handler } = setup({ index: lazy });

    expect((await handler(post({ question: 'pnpm' }))).status).toBe(500);
    expect((await handler(post({ question: 'pnpm' }))).status).toBe(200);
    expect((await handler(post({ question: 'pnpm' }))).status).toBe(200);
    expect(lazy).toHaveBeenCalledTimes(2);
  });

  it('supports custom instructions, a custom refusal and extra headers', async () => {
    const { handler, model } = setup({
      instructions: (defaults) => `${defaults}\n6. Answer in French.`,
      noAnswerMessage: 'Aucune idée.',
      headers: { 'access-control-allow-origin': '*' },
    });
    const refused = await handler(post({ question: 'Who won the 1998 World Cup final?' }));
    expect(refused.headers.get('access-control-allow-origin')).toBe('*');
    expect(answerOf((await readParts(refused)).parts)).toBe('Aucune idée.');

    await (await handler(post({ question: 'How are int8 vectors stored?' }))).text();
    const system = model.doStreamCalls[0]!.prompt.find((m) => m.role === 'system');
    expect(system?.content).toMatch(/Use only the sources[\s\S]*6\. Answer in French\.$/);
  });
});
