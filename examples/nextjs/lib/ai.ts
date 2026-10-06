import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { MOCK_MIN_SIMILARITY, mockLanguageModel } from 'ask-my-site/mock';

import config from '../ask-my-site.config.mjs';

/** `openai` when OPENAI_API_KEY is set, otherwise `mock`: scripted, offline, deterministic. */
export const mode: 'openai' | 'mock' = process.env.OPENAI_API_KEY ? 'openai' : 'mock';

export const chatModel: LanguageModel =
  mode === 'openai'
    ? createOpenAI()(process.env.OPENAI_CHAT_MODEL ?? 'gpt-5.4-mini')
    : mockLanguageModel();

if (!config.embeddingModel) throw new Error('ask-my-site.config.mjs must set an embeddingModel.');
export const embeddingModel: EmbeddingModel = config.embeddingModel;
export const embeddingProviderOptions = config.embeddingProviderOptions;

/** The mock embedder's similarity scale differs from OpenAI's; see MOCK_MIN_SIMILARITY. */
export const minSimilarity = mode === 'openai' ? undefined : MOCK_MIN_SIMILARITY;
