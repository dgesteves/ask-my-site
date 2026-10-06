import { describe, expect, it } from 'vitest';

import { Bm25Index, reciprocalRankFusion, tokenize } from '../src';

describe('tokenize', () => {
  it('folds case and diacritics, drops stopwords and strips plurals', () => {
    expect(tokenize('How do I configure the Rate Limits?')).toEqual(['configure', 'rate', 'limit']);
    expect(tokenize('Café résumé')).toEqual(['cafe', 'resume']);
    expect(tokenize('class status analysis caches')).toEqual([
      'class',
      'status',
      'analysis',
      'cache',
    ]);
  });

  it('indexes identifiers whole and by camelCase parts', () => {
    expect(tokenize('createAskHandler()')).toEqual([
      'createaskhandler',
      'create',
      'ask',
      'handler',
    ]);
    expect(tokenize('parseHTMLDocument')).toEqual([
      'parsehtmldocument',
      'parse',
      'html',
      'document',
    ]);
  });
});

describe('Bm25Index', () => {
  const docs = [
    'the quick brown fox jumps over the lazy dog',
    'quantization stores int8 vectors in base64',
    'rate limiting with a token bucket',
    'int8 int8 int8 vectors vectors are small',
    'a very long document about many unrelated things such as cooking gardening travel music and also int8 once',
  ].map(tokenize);
  const index = new Bm25Index(docs);

  it('ranks documents with rare query terms first', () => {
    const { ranked, scores } = index.search(tokenize('int8 quantization'));
    expect(ranked[0]).toBe(1);
    expect(ranked).toEqual(expect.arrayContaining([1, 3, 4]));
    expect(scores[0]).toBe(0);
    expect(scores[2]).toBe(0);
  });

  it('saturates term frequency and normalizes for length', () => {
    const { scores } = index.search(tokenize('int8'));
    // Repetition helps, but less than linearly; the long document is penalized.
    expect(scores[3]).toBeGreaterThan(scores[1]!);
    expect(scores[3]).toBeLessThan(3 * scores[1]!);
    expect(scores[1]).toBeGreaterThan(scores[4]!);
  });

  it('reports query coverage as the matched share of IDF mass', () => {
    const { coverage } = index.search(tokenize('token bucket weather'));
    // Doc 2 matches two of three terms; the unseen term carries the largest IDF.
    expect(coverage[2]).toBeGreaterThan(0.5);
    expect(coverage[2]).toBeLessThan(0.75);
    expect(index.search(tokenize('token bucket')).coverage[2]).toBeCloseTo(1, 5);
    expect(index.search(tokenize('weather forecast')).ranked).toEqual([]);
  });

  it('handles an empty query and an empty corpus', () => {
    expect(index.search([]).ranked).toEqual([]);
    expect(new Bm25Index([]).search(['x']).ranked).toEqual([]);
  });
});

describe('reciprocalRankFusion', () => {
  it('scores by 1 / (k + rank) summed across lists', () => {
    const fused = reciprocalRankFusion(
      [
        [10, 20, 30],
        [20, 40],
      ],
      60,
    );
    expect(fused.map((r) => r.item)).toEqual([20, 10, 40, 30]);
    expect(fused[0]?.score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[1]?.score).toBeCloseTo(1 / 61, 10);
  });

  it('is symmetric across lists and breaks ties deterministically', () => {
    const fused = reciprocalRankFusion([
      [1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1],
    ]);
    // 1 and 5 are first once and last once, so they tie; 1/x is convex, so a first place
    // narrowly outweighs two middle places.
    expect(fused).toHaveLength(5);
    const score = Object.fromEntries(fused.map((r) => [r.item, r.score]));
    expect(score[1]).toBeCloseTo(score[5]!, 12);
    // Ties break deterministically: best single rank, then item.
    expect(fused.map((r) => r.item)).toEqual([1, 5, 2, 4, 3]);
  });

  it('handles empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], [7]])).toEqual([{ item: 7, score: 1 / 61 }]);
  });
});
