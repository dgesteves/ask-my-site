import { describe, expect, it } from 'vitest';

import { buildIndex, loadIndex, retrieve, serializeIndexFile } from '../src';
import { MOCK_MIN_SIMILARITY, hashEmbedding, mockEmbeddingModel } from '../src/mock';
import { corpus } from './helpers';

const DIMS = 512;

async function setup() {
  const { index } = await buildIndex({
    documents: corpus,
    embeddingModel: mockEmbeddingModel({ dimensions: DIMS }),
  });
  return loadIndex(index);
}

const ask = async (text: string, options = {}) => {
  const index = await setup();
  return retrieve(
    index,
    { text, vector: hashEmbedding(text, DIMS) },
    {
      minSimilarity: MOCK_MIN_SIMILARITY,
      ...options,
    },
  );
};

describe('retrieve', () => {
  it('finds the right page and links each hit to its section anchor', async () => {
    const result = await ask('How is the int8 vector scaled?');
    expect(result.answerable).toBe(true);
    expect(result.mode).toBe('hybrid');
    // Keyword and vector rankings disagree on the order of the page's two chunks, so they tie on
    // RRF score; both must lead.
    expect(
      result.hits
        .slice(0, 2)
        .map((h) => h.chunk.url)
        .sort(),
    ).toEqual(['/docs/quantization', '/docs/quantization#why-int8']);
    const section = result.hits.find((h) => h.chunk.heading === 'Why int8');
    expect(section?.chunk.title).toBe('Vector quantization');
    expect(section?.keywordCoverage).toBe(1);
  });

  it('fuses keyword and vector rankings', async () => {
    const result = await ask('Upstash ratelimit shared across regions');
    const top = result.hits[0]!;
    expect(top.chunk.url).toBe('/docs/rate-limits#upstash');
    expect(top.keywordScore).toBeGreaterThan(0);
    expect(top.similarity).toBeGreaterThan(MOCK_MIN_SIMILARITY);
    // Fused scores are descending.
    const scores = result.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('refuses when nothing clears either threshold', async () => {
    const result = await ask('What is the capital of Mongolia?');
    expect(result.answerable).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.best.keywordCoverage).toBe(0);
    expect(result.best.similarity).toBeLessThan(MOCK_MIN_SIMILARITY);
  });

  it('lets either signal alone make a chunk relevant', async () => {
    const index = await setup();
    const text = 'memoryRateLimit';
    // Vector-only gate: impossible similarity, but the identifier is fully covered.
    const keywordOnly = retrieve(
      index,
      { text, vector: hashEmbedding(text, DIMS) },
      {
        minSimilarity: 2,
      },
    );
    expect(keywordOnly.answerable).toBe(true);
    expect(keywordOnly.hits[0]?.chunk.url).toBe('/docs/rate-limits#in-memory');
    // Keyword gate impossible, similarity gate open.
    const vectorOnly = retrieve(
      index,
      { text, vector: hashEmbedding(text, DIMS) },
      {
        minKeywordCoverage: 2,
        minSimilarity: 0,
      },
    );
    expect(vectorOnly.answerable).toBe(true);
    // Both impossible.
    const neither = retrieve(
      index,
      { text, vector: hashEmbedding(text, DIMS) },
      {
        minKeywordCoverage: 2,
        minSimilarity: 2,
      },
    );
    expect(neither.answerable).toBe(false);
  });

  it('falls back to keywords without a query vector, and respects topK', async () => {
    const index = await setup();
    const result = retrieve(
      index,
      { text: 'rate limit token bucket upstash', vector: null },
      { topK: 2 },
    );
    expect(result.mode).toBe('keyword');
    expect(result.hits).toHaveLength(2);
    expect(result.hits.every((h) => h.similarity === null)).toBe(true);
    expect(result.hits.every((h) => h.chunk.url.startsWith('/docs/rate-limits'))).toBe(true);
  });

  it('works on a keyword-only index', async () => {
    const { index: file } = await buildIndex({ documents: corpus });
    expect(file.embedding).toBeNull();
    const index = loadIndex(serializeIndexFile(file));
    expect(index.vectors).toBeNull();
    const result = retrieve(index, { text: 'pnpm add', vector: [1, 2, 3] });
    expect(result.mode).toBe('keyword');
    expect(result.hits[0]?.chunk.url).toBe('/docs/install#with-pnpm');
  });

  it('rejects a query vector of the wrong size', async () => {
    const index = await setup();
    expect(() => retrieve(index, { text: 'x', vector: [0.1, 0.2] })).toThrow(/2 dimensions/);
  });
});
