import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  AskIndexError,
  INDEX_FORMAT,
  buildIndex,
  checkIndex,
  loadIndex,
  parseIndexFile,
  serializeIndexFile,
  validateIndexFile,
} from '../src';
import { hashEmbedding } from '../src/mock';
import { corpus } from './helpers';

/** An embedding model that records how many texts it was asked to embed. */
function countingModel(modelId = 'counting', dims = 64) {
  const calls: string[][] = [];
  const model = new MockEmbeddingModelV4({
    modelId,
    maxEmbeddingsPerCall: 100,
    doEmbed: ({ values }) => {
      calls.push(values);
      return Promise.resolve({
        embeddings: values.map((v) => hashEmbedding(v, dims)),
        warnings: [],
      });
    },
  });
  return { model, calls, embedded: () => calls.flat().length };
}

describe('buildIndex', () => {
  it('produces a valid, deterministic index', async () => {
    const { model } = countingModel();
    const a = await buildIndex({ documents: corpus, embeddingModel: model });
    const b = await buildIndex({ documents: [...corpus].reverse(), embeddingModel: model });

    expect(a.index.format).toBe(INDEX_FORMAT);
    expect(a.index.embedding).toEqual({ model: 'counting', dimensions: 64 });
    expect(a.stats).toMatchObject({ documents: 4, embedded: a.stats.chunks, reused: 0 });
    expect(serializeIndexFile(a.index)).toBe(serializeIndexFile(b.index));
    expect(validateIndexFile(JSON.parse(serializeIndexFile(a.index)))).toEqual(a.index);
  });

  it('serializes one chunk per line so diffs stay small', async () => {
    const { model } = countingModel();
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    const lines = serializeIndexFile(index).split('\n');
    const chunkLines = lines.filter(
      (line) => line.trimStart().startsWith('{"id":"') && line.includes('"vector"'),
    );
    expect(chunkLines).toHaveLength(index.chunks.length);
  });

  it('re-embeds only chunks whose text changed', async () => {
    const first = countingModel();
    const { index: previous } = await buildIndex({
      documents: corpus,
      embeddingModel: first.model,
    });

    const edited = corpus.map((d) =>
      d.id === 'pricing.md' ? { ...d, content: `${d.content} Self-hosting is free too.` } : d,
    );
    const second = countingModel();
    const { index, stats } = await buildIndex({
      documents: edited,
      embeddingModel: second.model,
      previous,
    });
    expect(second.embedded()).toBe(1);
    expect(stats).toMatchObject({ embedded: 1, reused: previous.chunks.length - 1 });
    expect(index.contentHash).not.toBe(previous.contentHash);

    // A different model shares nothing.
    const third = countingModel('other-model');
    await buildIndex({ documents: edited, embeddingModel: third.model, previous: index });
    expect(third.embedded()).toBe(index.chunks.length);
  });

  it('embeds the heading path with the text, so context reaches the vector', async () => {
    const { model, calls } = countingModel();
    await buildIndex({ documents: corpus, embeddingModel: model });
    expect(calls.flat()).toContain(
      'Rate limiting › Upstash\n\nPass upstashRateLimit with a configured Ratelimit instance for a limit shared across regions.',
    );
  });

  it('rejects duplicate ids and inconsistent dimensions', async () => {
    await expect(buildIndex({ documents: [corpus[0]!, corpus[0]!] })).rejects.toThrow(/Duplicate/);
    let n = 0;
    const flaky = new MockEmbeddingModelV4({
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map(() => Array.from({ length: 4 + (n++ % 2) }, () => 1)),
          warnings: [],
        }),
    });
    await expect(buildIndex({ documents: corpus, embeddingModel: flaky })).rejects.toThrow(
      /dimensions/,
    );
  });
});

describe('index file validation', () => {
  it('names the offending field', async () => {
    const { index } = await buildIndex({ documents: corpus });
    expect(() => validateIndexFile({ ...index, format: 'other@9' })).toThrow(
      /Unsupported index format/,
    );
    expect(() =>
      validateIndexFile({ ...index, chunks: [{ ...index.chunks[0], doc: 99 }] }),
    ).toThrow(/chunks\[0\]\.doc/);
    expect(() => validateIndexFile({ ...index, embedding: { model: 'm', dimensions: 8 } })).toThrow(
      /chunks\[0\]\.vector/,
    );
    expect(() => parseIndexFile('{nope')).toThrow(AskIndexError);
  });

  it('checks vector lengths on load', async () => {
    const { model } = countingModel('m', 16);
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    expect(() => loadIndex({ ...index, embedding: { model: 'm', dimensions: 32 } })).toThrow(
      /16 dimensions/,
    );
  });
});

describe('checkIndex', () => {
  it('passes for unchanged content without calling any model', async () => {
    const { model, calls } = countingModel();
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    const before = calls.length;
    const result = await checkIndex({ documents: corpus, index, embeddingModel: model });
    expect(result).toEqual({ upToDate: true, problems: [], added: [], removed: [], changed: [] });
    expect(calls.length).toBe(before);
  });

  it('lists added, changed and removed chunks', async () => {
    const { index } = await buildIndex({ documents: corpus });
    const edited = [
      ...corpus.filter((d) => d.id !== 'pricing.md'),
      { id: 'faq.md', url: '/faq', title: 'FAQ', content: 'Questions.' },
    ].map((d) => (d.id === 'install.md' ? { ...d, content: d.content.replace('22', '24') } : d));
    const result = await checkIndex({ documents: edited, index });
    expect(result.upToDate).toBe(false);
    expect(result.added).toEqual(['faq.md#0']);
    expect(result.removed).toEqual(['pricing.md#0']);
    expect(result.changed).toEqual(['install.md#1']);
  });

  it('fails on chunking, model or dimension drift', async () => {
    const { model } = countingModel('m', 16);
    const { index } = await buildIndex({ documents: corpus, embeddingModel: model });
    expect(
      (await checkIndex({ documents: corpus, index, chunking: { maxChars: 300 } })).upToDate,
    ).toBe(false);
    const otherModel = await checkIndex({ documents: corpus, index, embeddingModel: 'other' });
    expect(otherModel.problems).toEqual(['Index was embedded with "m", expected "other".']);
    // Gateway-style ids match bare ids.
    expect(
      (await checkIndex({ documents: corpus, index, embeddingModel: 'acme/m' })).upToDate,
    ).toBe(true);
    const dims = await checkIndex({ documents: corpus, index, embeddingDimensions: 32 });
    expect(dims.problems).toEqual(['Index vectors have 16 dimensions, expected 32.']);
  });
});
