import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildIndex } from '../src';
import { startDevServer } from '../src/cli/dev';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { writeIndexFile } from '../src/node';
import { createAskHandler, type AskHandlerOptions } from '../src/server';
import { corpus } from './helpers';

const embeddingModel = mockEmbeddingModel();
const { index } = await buildIndex({ documents: corpus, embeddingModel });

/** Answered without a model call, so a test can ask many times quickly. */
const OFF_TOPIC = 'Who won the 1998 World Cup final?';

function setup(overrides: Partial<AskHandlerOptions> = {}) {
  const onError = vi.fn();
  const handler = createAskHandler({
    index,
    model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
    embeddingModel,
    retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
    onError,
    ...overrides,
  });
  return { handler, onError };
}

const post = (headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ question: OFF_TOPIC }),
  });

/** The statuses of `count` requests made one after another. */
async function statuses(
  handler: (request: Request) => Promise<Response>,
  count: number,
  headers: Record<string, string> = {},
): Promise<number[]> {
  const result: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const response = await handler(post(headers));
    await response.text();
    result.push(response.status);
  }
  return result;
}

const allowed = (list: number[]) => list.filter((status) => status === 200).length;

describe('the default rate limit', () => {
  it('allows 10 questions a minute per client IP when no rateLimit is given', async () => {
    const { handler, onError } = setup();
    const first = await statuses(handler, 12, { 'x-forwarded-for': '198.51.100.1' });
    expect(first).toEqual([...Array<number>(10).fill(200), 429, 429]);
    const response = await handler(post({ 'x-forwarded-for': '198.51.100.1' }));
    expect(response.headers.get('ratelimit-limit')).toBe('10');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ error: { code: 'rate_limited' } });

    // Another client has its own bucket, and nothing was reported.
    expect(await statuses(handler, 1, { 'x-forwarded-for': '198.51.100.2' })).toEqual([200]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('puts requests without a client IP in one shared bucket, and says so once', async () => {
    const { handler, onError } = setup();
    // A client cannot escape it with headers the platform does not set.
    const spoofed = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        handler(post({ 'cf-connecting-ip': `203.0.113.${String(i)}` })),
      ),
    );
    expect(allowed(spoofed.map((response) => response.status))).toBe(10);
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]?.[0])).toMatch(
      /no X-Forwarded-For header[\s\S]*trustedHeader[\s\S]*rateLimit: false/,
    );
  });

  it('is off with rateLimit: false, and replaced by a limiter you pass', async () => {
    const off = setup({ rateLimit: false });
    expect(allowed(await statuses(off.handler, 15, { 'x-forwarded-for': '198.51.100.1' }))).toBe(
      15,
    );

    const custom = vi.fn(() => ({ success: true }));
    const own = setup({ rateLimit: custom });
    expect(allowed(await statuses(own.handler, 15))).toBe(15);
    expect(custom).toHaveBeenCalledTimes(15);
    expect(own.onError).not.toHaveBeenCalled();
  });
});

describe('ondocs dev', () => {
  it('answers up to 30 questions a minute from this machine, without warning about IPs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ondocs-limit-'));
    const file = join(root, 'ask-index.json');
    await writeIndexFile(file, index);
    const logs: string[] = [];
    const server = await startDevServer({
      file,
      port: 0,
      env: {},
      log: (line) => logs.push(line),
      error: (line) => logs.push(line),
    });
    try {
      const result: number[] = [];
      for (let i = 0; i < 32; i += 1) {
        const response = await fetch(server.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: OFF_TOPIC }),
        });
        await response.text();
        result.push(response.status);
      }
      expect(result).toEqual([...Array<number>(30).fill(200), 429, 429]);
      expect(logs.join('\n')).not.toContain('X-Forwarded-For');
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
