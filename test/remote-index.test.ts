import { describe, expect, it } from 'vitest';

import { buildIndex, serializeIndexFile } from '../src';
import { mockEmbeddingModel, mockLanguageModel } from '../src/mock';
import { createAskHandler, createMcpHandler, remoteIndex } from '../src/server';
import { corpus } from './helpers';

const URL_ = 'https://acme.github.io/docs/ask-index.json';

async function indexText(documents = corpus, embeddingModel = mockEmbeddingModel()) {
  const { index } = await buildIndex({ documents, embeddingModel });
  return serializeIndexFile(index);
}

/** A site serving `current()` with an ETag, answering conditional requests with 304. */
function site(current: () => string) {
  const requests: Request[] = [];
  let failing = false;
  const fetch = (request: Request): Promise<Response> => {
    requests.push(request);
    if (failing) return Promise.resolve(new Response('down', { status: 503 }));
    const body = current();
    const etag = `"${String(body.length)}-${body.slice(-40).replace(/\W/g, '')}"`;
    if (request.headers.get('if-none-match') === etag) {
      return Promise.resolve(new Response(null, { status: 304 }));
    }
    return Promise.resolve(new Response(body, { headers: { etag } }));
  };
  return {
    fetch,
    requests,
    fail: (value: boolean) => {
      failing = value;
    },
  };
}

describe('remoteIndex', () => {
  it('fetches the index once, then keeps it until it is time to check again', async () => {
    const text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now, revalidateSeconds: 60 });
    const first = await index();
    expect(first.documents.length).toBe(corpus.length);
    expect(await index()).toBe(first);
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]?.url).toBe(URL_);

    // A minute later it asks again, conditionally, and keeps its copy on a 304.
    now = 61_000;
    expect(await index()).toBe(first);
    expect(host.requests).toHaveLength(2);
    expect(host.requests[1]?.headers.get('if-none-match')).toMatch(/^"/);
  });

  it('loads the new index once the site is redeployed', async () => {
    let text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now });
    const before = await index();
    text = await indexText(corpus.slice(0, 2));
    now = 301_000;
    const after = await index();
    expect(after).not.toBe(before);
    expect(after.documents.length).toBe(2);
  });

  it('keeps the index it has while the site is down, and fails only the first fetch', async () => {
    const text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now, revalidateSeconds: 1 });
    host.fail(true);
    await expect(index()).rejects.toThrow(`Could not fetch the index at ${URL_}: HTTP 503.`);
    host.fail(false);
    const loaded = await index();
    host.fail(true);
    now = 5_000;
    expect(await index()).toBe(loaded);
  });

  it('keeps the index it has when the new file does not parse', async () => {
    let text = await indexText();
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now });
    const loaded = await index();
    text = '{ "format": "half-deployed"';
    now = 400_000;
    expect(await index()).toBe(loaded);
  });

  it('shares one fetch between concurrent requests', async () => {
    const text = await indexText();
    const host = site(() => text);
    const index = remoteIndex(URL_, { fetch: host.fetch });
    const [a, b] = await Promise.all([index(), index()]);
    expect(a).toBe(b);
    expect(host.requests).toHaveLength(1);
  });

  it('sends the headers it is given', async () => {
    const text = await indexText();
    const host = site(() => text);
    await remoteIndex(URL_, { fetch: host.fetch, headers: { 'x-token': 'abc' } })();
    expect(host.requests[0]?.headers.get('x-token')).toBe('abc');
  });

  it('rejects a negative revalidateSeconds', () => {
    expect(() => remoteIndex(URL_, { revalidateSeconds: -1 })).toThrow(RangeError);
  });

  it('feeds both handlers, which follow the site as it changes', async () => {
    let text = await indexText(corpus.slice(0, 1));
    const host = site(() => text);
    let now = 0;
    const index = remoteIndex(URL_, { fetch: host.fetch, now: () => now });
    const ask = createAskHandler({
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      embeddingModel: mockEmbeddingModel(),
      rateLimit: false,
    });
    const mcp = createMcpHandler({ index, rateLimit: false });
    const question = (q: string) =>
      ask(
        new Request('https://ask.example.com/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: q }),
        }),
      ).then((response) => response.text());
    expect(await question('How do I rate limit with Upstash?')).toContain("I don't know");

    // The site adds the rate limiting page and redeploys.
    text = await indexText();
    now = 301_000;
    expect(await question('How do I rate limit with Upstash?')).toContain('/docs/rate-limits');
    const listed = await mcp(
      new Request('https://ask.example.com/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_pages', arguments: {} },
        }),
      }),
    );
    expect(
      ((await listed.json()) as { result: { structuredContent: { total: number } } }).result
        .structuredContent.total,
    ).toBe(corpus.length);
    // One fetch, then one revalidation that downloaded the new file: both handlers shared them.
    expect(host.requests).toHaveLength(2);
  });

  it('is checked against the handler’s embedding model', async () => {
    const text = await indexText(corpus, mockEmbeddingModel({ dimensions: 64 }));
    const host = site(() => text);
    const ask = createAskHandler({
      index: remoteIndex(URL_, { fetch: host.fetch }),
      model: mockLanguageModel(),
      embeddingModel: mockEmbeddingModel({ dimensions: 128 }),
      rateLimit: false,
      onError: () => undefined,
    });
    const response = await ask(
      new Request('https://ask.example.com/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'How do I install it?' }),
      }),
    );
    expect(response.status).toBe(500);
  });
});
