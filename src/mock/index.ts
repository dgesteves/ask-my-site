/**
 * ask-my-site/mock: deterministic stand-ins for the embedding and language models, so the whole
 * pipeline (index, retrieval, streaming, citations) runs without an API key.
 *
 * - `mockEmbeddingModel` hashes words and word pairs into a fixed-size vector (feature hashing).
 *   Similarity tracks shared vocabulary, so retrieval is lexical but real.
 * - `mockLanguageModel` answers extractively: it picks the sentences from the retrieved sources
 *   that best match the question and cites them. It never invents text.
 *
 * Both are built on the AI SDK's own test models from `ai/test`.
 */

import { simulateReadableStream } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';

import { tokenize } from '../text/tokenize';

/**
 * A `minSimilarity` that suits {@link mockEmbeddingModel} at its default size. Chance similarity
 * between hashed vectors has a standard deviation of about 1/sqrt(dimensions), 0.044 at 512, so
 * 0.2 sits well clear of noise. Most relevant matches pass on keyword coverage instead.
 */
export const MOCK_MIN_SIMILARITY = 0.2;

export interface MockEmbeddingModelOptions {
  /** Vector size. Default 512. */
  dimensions?: number;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The mock embedding of one text: signed feature hashing of terms and term pairs, L2-normalized. */
export function hashEmbedding(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const terms = tokenize(text);
  const features: [string, number][] = terms.map((term) => [term, 1]);
  for (let i = 1; i < terms.length; i += 1)
    features.push([`${terms[i - 1] ?? ''} ${terms[i] ?? ''}`, 0.5]);
  for (const [feature, weight] of features) {
    const hash = fnv1a(feature);
    const bucket = hash % dimensions;
    vector[bucket] = (vector[bucket] ?? 0) + (hash & 0x80000000 ? -weight : weight);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

/** A deterministic, offline embedding model. Its id is `mock-hash-<dimensions>`. */
export function mockEmbeddingModel(options: MockEmbeddingModelOptions = {}): MockEmbeddingModelV4 {
  const dimensions = options.dimensions ?? 512;
  return new MockEmbeddingModelV4({
    provider: 'ask-my-site',
    modelId: `mock-hash-${String(dimensions)}`,
    maxEmbeddingsPerCall: 2048,
    supportsParallelCalls: true,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((value) => hashEmbedding(value, dimensions)),
        usage: { tokens: values.reduce((sum, value) => sum + tokenize(value).length, 0) },
        warnings: [],
      }),
  });
}

export interface MockLanguageModelOptions {
  /** Delay before the first token, in ms. Default 250. */
  initialDelayMs?: number;
  /** Delay between streamed words, in ms. Default 18. */
  wordDelayMs?: number;
}

interface ParsedSource {
  id: number;
  text: string;
}

const SOURCE = /<source id="(\d+)"[^>]*>\n?([\s\S]*?)\n?<\/source>/g;
const QUESTION = /<question>\n?([\s\S]*?)\n?<\/question>/;

/** The answer the mock model gives for a prompt produced by `formatPrompt`. */
export function extractiveAnswer(prompt: string): string {
  const question = new Set(tokenize(QUESTION.exec(prompt)?.[1] ?? ''));
  const sources: ParsedSource[] = [...prompt.matchAll(SOURCE)].map((match) => ({
    id: Number(match[1]),
    text: match[2] ?? '',
  }));
  if (sources.length === 0) return "I don't know. No sources were provided.";

  const sentences: string[] = [];
  for (const source of sources.slice(0, 3)) {
    const best = bestSentence(source.text, question);
    if (best && (sentences.length === 0 || best.score > 0)) {
      sentences.push(`${best.sentence} [${String(source.id)}]`);
    }
  }
  return sentences.length > 0
    ? sentences.join(' ')
    : `The closest match is in source [${String(sources[0]?.id ?? 1)}].`;
}

function bestSentence(
  text: string,
  question: Set<string>,
): { sentence: string; score: number } | null {
  const prose = text
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  let best: { sentence: string; score: number } | null = null;
  for (const raw of prose.split(/(?<=[.!?])\s+(?=[A-Z0-9`"(])/)) {
    const sentence = raw.trim().replace(/[:;,]$/, '.');
    if (sentence.length < 20) continue;
    const terms = new Set(tokenize(sentence));
    let score = 0;
    for (const term of question) if (terms.has(term)) score += 1;
    if (!best || score > best.score) best = { sentence: clip(sentence, 260), score };
  }
  return best;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return /[.!?]$/.test(text) ? text : `${text}.`;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function promptText(prompt: MockLanguageModelV4['doStreamCalls'][number]['prompt']): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (message?.role === 'user') {
      return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
    }
  }
  return '';
}

const usage = (text: string) => ({
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: text.split(/\s+/).length, text: undefined, reasoning: undefined },
});

/**
 * A scripted language model that streams an extractive, cited answer built from the sources in
 * its prompt. Use it for demos, tests and local development without an API key.
 */
export function mockLanguageModel(options: MockLanguageModelOptions = {}): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'ask-my-site',
    modelId: 'mock-extractive',
    doGenerate: ({ prompt }) => {
      const text = extractiveAnswer(promptText(prompt));
      return Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(text),
        warnings: [],
      });
    },
    doStream: ({ prompt }) => {
      const text = extractiveAnswer(promptText(prompt));
      const words = text.match(/\S+\s*/g) ?? [];
      return Promise.resolve({
        stream: simulateReadableStream({
          initialDelayInMs: options.initialDelayMs ?? 250,
          chunkDelayInMs: options.wordDelayMs ?? 18,
          chunks: [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'text-start' as const, id: 'answer' },
            ...words.map((delta) => ({ type: 'text-delta' as const, id: 'answer', delta })),
            { type: 'text-end' as const, id: 'answer' },
            {
              type: 'finish' as const,
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: usage(text),
            },
          ],
        }),
      });
    },
  });
}
