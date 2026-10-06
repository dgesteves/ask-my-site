// @ts-check
import { createOpenAI } from '@ai-sdk/openai';
import { mockEmbeddingModel } from 'ask-my-site/mock';

/**
 * The embedding setup, shared by the CLI (`pnpm index`) and the route handler so the index and
 * the queries always use the same model.
 *
 * With OPENAI_API_KEY set (the CLI reads .env.local), it embeds with OpenAI at 512 dimensions.
 * Without it, it uses the deterministic mock model, so the example runs with no key at all.
 *
 * @type {import('ask-my-site/node').AskConfig}
 */
const config = process.env.OPENAI_API_KEY
  ? {
      baseUrl: '/docs',
      embeddingModel: createOpenAI().embedding('text-embedding-3-small'),
      embeddingProviderOptions: { openai: { dimensions: 512 } },
    }
  : {
      baseUrl: '/docs',
      embeddingModel: mockEmbeddingModel(),
    };

export default config;
