// The Worker in workerd, offline: a stand-in site serves its index, and a stand-in AI binding
// embeds questions and answers them. `npm test` runs it; `wrangler dev` runs the real Workers AI
// instead, which needs a login and counts against your allowance.
import { buildIndex, serializeIndexFile, type SourceDocument } from 'ask-my-site';
import { hashEmbedding } from 'ask-my-site/mock';
import { env } from 'cloudflare:test';
import { beforeAll, expect, it, vi } from 'vitest';

import worker from '../src/index';

const EMBEDDING = '@cf/baai/bge-small-en-v1.5';
const ANSWER = 'Deploy it with the GitHub Pages workflow [1].';

const documents: SourceDocument[] = [
  {
    id: 'deploy.md',
    url: '/docs/deploy',
    title: 'Deploying',
    content: '## GitHub Pages\n\nDeploy the site to GitHub Pages with the deploy workflow.',
  },
  {
    id: 'search.md',
    url: '/docs/search',
    title: 'Search',
    content: '## Algolia\n\nAdd Algolia search with the DocSearch plugin.',
  },
];

/** What Workers AI's embedding model returns, stood in for by a deterministic hash of the words. */
const vectors = (texts: string[]) => texts.map((text) => hashEmbedding(text, 384));

let run: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  const { index } = await buildIndex({
    documents,
    embeddingModel: {
      specificationVersion: 'v4',
      provider: 'workers-ai',
      modelId: EMBEDDING,
      maxEmbeddingsPerCall: 100,
      supportsParallelCalls: true,
      doEmbed: ({ values }) => Promise.resolve({ embeddings: vectors(values), warnings: [] }),
    },
  });
  const text = serializeIndexFile(index);
  // The site, as GitHub Pages serves it.
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = new Request(input, init);
    return Promise.resolve(
      request.url === `${env.SITE_URL}/ask-index.json`
        ? new Response(text, { headers: { etag: '"1"' } })
        : new Response(null, { status: 404 }),
    );
  });
  run = vi.spyOn(env.AI, 'run').mockImplementation(((model: string, inputs: { text?: string[] }) =>
    Promise.resolve(
      model === EMBEDDING
        ? { shape: [inputs.text?.length ?? 0, 384], data: vectors(inputs.text ?? []) }
        : {
            response: ANSWER,
            usage: { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 },
          },
    )) as never);
});

const origin = new URL(env.SITE_URL).origin;
const ask = (question: string) =>
  worker.fetch(
    new Request('https://ask.example.workers.dev/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': '203.0.113.1' },
      body: JSON.stringify({ question }),
    }),
    env,
  );
const calls = (model: string) =>
  run.mock.calls.filter((call: unknown[]) => call[0] === model).length;

it('answers a docs question with its sources, from Workers AI, for the site’s origin', async () => {
  const response = await ask('How do I deploy to GitHub Pages?');
  const text = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(text).toContain('"url":"/docs/deploy#github-pages"');
  expect(text).toContain('"retrieval":"hybrid"');
  expect([...text.matchAll(/"delta":"([^"]*)"/g)].map((match) => match[1]).join('')).toBe(ANSWER);
  // The question, embedded with the index's model, then the answer, from CHAT_MODEL.
  expect(run).toHaveBeenCalledWith(
    EMBEDDING,
    { text: ['How do I deploy to GitHub Pages?'] },
    expect.anything(),
  );
  expect(calls(env.CHAT_MODEL)).toBe(1);
});

it('says it does not know, without asking the model, when the docs do not cover it', async () => {
  const before = calls(env.CHAT_MODEL);
  const text = await (await ask('What is the capital of France?')).text();
  expect(text).toContain("I don't know");
  expect(calls(env.CHAT_MODEL)).toBe(before);
});

it('answers the preflight of the site’s pages', async () => {
  const response = await worker.fetch(
    new Request('https://ask.example.workers.dev/api/ask', {
      method: 'OPTIONS',
      headers: { origin },
    }),
    env,
  );
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
});

it('serves the index to agents over MCP, with links to the site, calling no model', async () => {
  const before = run.mock.calls.length;
  const response = await worker.fetch(
    new Request('https://ask.example.workers.dev/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'Algolia search' } },
      }),
    }),
    env,
  );
  expect(await response.text()).toContain(`"url":"${origin}/docs/search#algolia"`);
  expect(run.mock.calls.length).toBe(before);
});

it('answers nothing else', async () => {
  const response = await worker.fetch(new Request('https://ask.example.workers.dev/'), env);
  expect(response.status).toBe(404);
});
