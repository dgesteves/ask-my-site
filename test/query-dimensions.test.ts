import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { buildIndex } from '../src';
import { mockLanguageModel } from '../src/mock';
import { createAskHandler } from '../src/server';
import { corpus } from './helpers';

/**
 * An embedding model that behaves like OpenAI's `text-embedding-3-small`: 1,536 dimensions unless
 * `providerOptions.openai.dimensions` asks for fewer. It records the options of each call.
 */
function openaiLike(modelId = 'text-embedding-3-small') {
  const calls: unknown[] = [];
  const model = new MockEmbeddingModelV4({
    modelId,
    doEmbed: ({ values, providerOptions }) => {
      calls.push(providerOptions);
      const size = Number(providerOptions?.openai?.dimensions ?? 1536);
      return Promise.resolve({
        embeddings: values.map((value) =>
          Array.from({ length: size }, (_, i) => ((value.length * (i + 1)) % 7) - 3 + 0.5),
        ),
        warnings: [],
      });
    },
  });
  return { model, calls };
}

const question = (handler: (request: Request) => Promise<Response>) =>
  handler(
    new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ question: 'How are int8 vectors stored?' }),
    }),
  );

async function indexAt(dimensions: number | null) {
  const { model } = openaiLike();
  const { index } = await buildIndex({
    documents: corpus,
    embeddingModel: model,
    ...(dimensions ? { embeddingProviderOptions: { openai: { dimensions } } } : {}),
  });
  return index;
}

describe('query dimensions', () => {
  it.each([
    [512, 512],
    // An index from before the 512 default, at the model's full size, keeps working.
    [null, 1536],
  ])(
    'embeds questions at the size the index was built at (%s), without embeddingProviderOptions',
    async (built, size) => {
      const index = await indexAt(built);
      expect(index.embedding?.dimensions).toBe(size);
      const { model, calls } = openaiLike();
      const errors: unknown[] = [];
      const handler = createAskHandler({
        index,
        model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
        embeddingModel: model,
        onError: (error) => errors.push(error),
      });
      const response = await question(handler);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"retrieval":"hybrid"');
      expect(calls).toEqual([{ openai: { dimensions: size } }]);
      expect(errors).toEqual([]);
    },
  );

  it('keeps the options it is given, adding only the size, and never overrides a size it is given', async () => {
    const index = await indexAt(512);
    const { model, calls } = openaiLike();
    const handler = (embeddingProviderOptions: Record<string, Record<string, string | number>>) =>
      createAskHandler({
        index,
        model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
        embeddingModel: model,
        embeddingProviderOptions,
        onError: () => undefined,
      });
    await (await question(handler({ openai: { user: 'docs' } }))).text();
    expect(calls.at(-1)).toEqual({ openai: { dimensions: 512, user: 'docs' } });
    // A size given on purpose is passed as it is, and a mismatch is reported, not papered over.
    const wrong = await question(handler({ openai: { dimensions: 256 } }));
    expect(calls.at(-1)).toEqual({ openai: { dimensions: 256 } });
    expect(wrong.status).toBe(500);
  });

  it('leaves other models’ options alone', async () => {
    const { model: other, calls } = openaiLike('embed-v4.0');
    const { index } = await buildIndex({ documents: corpus, embeddingModel: other });
    const handler = createAskHandler({
      index,
      model: mockLanguageModel({ initialDelayMs: 0, wordDelayMs: 0 }),
      embeddingModel: other,
    });
    await (await question(handler)).text();
    expect(calls.at(-1)).toBeUndefined();
  });
});
