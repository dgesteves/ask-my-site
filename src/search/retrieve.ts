import { chunkSearchText } from '../chunk';
import {
  AskIndexError,
  parseIndexFile,
  validateIndexFile,
  type IndexEmbedding,
} from '../index-file';
import { decodeVector } from '../quantize';
import { tokenize } from '../text/tokenize';
import { Bm25Index } from './bm25';
import { reciprocalRankFusion } from './rrf';
import { VectorIndex } from './vectors';

/** A chunk as retrieval returns it: everything needed to cite it. */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  title: string;
  heading: string;
  /** The document URL plus the section anchor, ready to link to. */
  url: string;
  text: string;
}

/** An index ready to query: chunks, the BM25 inverted index and the int8 matrix, in memory. */
export interface LoadedIndex {
  readonly chunks: readonly RetrievedChunk[];
  readonly embedding: IndexEmbedding | null;
  readonly contentHash: string;
  readonly bm25: Bm25Index;
  readonly vectors: VectorIndex | null;
}

export interface RetrievalOptions {
  /** Chunks to return at most. Default 6. */
  topK?: number;
  /** Candidates taken from each retriever before fusion. Default 40. */
  candidates?: number;
  /** RRF constant. Default 60. */
  rrfK?: number;
  /**
   * Minimum cosine similarity for a chunk to count as relevant on meaning alone. Default 0.25,
   * calibrated for OpenAI `text-embedding-3-small`; other models need their own value.
   */
  minSimilarity?: number;
  /**
   * Minimum share of the query's IDF mass a chunk must contain to count as relevant on keywords
   * alone. Default 0.5.
   */
  minKeywordCoverage?: number;
}

export interface RetrievalHit {
  chunk: RetrievedChunk;
  /** Fused RRF score. Only meaningful relative to other hits for the same query. */
  score: number;
  /** Cosine similarity, or `null` when the query was keyword-only. */
  similarity: number | null;
  keywordScore: number;
  keywordCoverage: number;
}

export interface RetrievalResult {
  hits: RetrievalHit[];
  /**
   * `false` when no chunk passed either relevance threshold. The handler then answers
   * "I don't know" without calling the language model.
   */
  answerable: boolean;
  mode: 'hybrid' | 'keyword';
  /** The best raw signals seen, useful for tuning thresholds. */
  best: { similarity: number | null; keywordCoverage: number };
}

export const DEFAULT_RETRIEVAL = {
  topK: 6,
  candidates: 40,
  rrfK: 60,
  minSimilarity: 0.25,
  minKeywordCoverage: 0.5,
} as const satisfies Required<RetrievalOptions>;

/**
 * Builds the in-memory search structures from an index file, its JSON text, or the parsed JSON
 * (for example a static `import index from './ask-index.json'`).
 *
 * Do this once per process or isolate and reuse the result; `createAskHandler` does.
 */
export function loadIndex(input: unknown): LoadedIndex {
  const file = typeof input === 'string' ? parseIndexFile(input) : validateIndexFile(input);
  const chunks: RetrievedChunk[] = file.chunks.map((chunk) => {
    const document = file.documents[chunk.doc];
    if (!document) throw new AskIndexError(`Chunk ${chunk.id} points at a missing document.`);
    return {
      id: chunk.id,
      documentId: document.id,
      title: document.title,
      heading: chunk.heading,
      url: chunk.anchor ? `${document.url}#${chunk.anchor}` : document.url,
      text: chunk.text,
    };
  });

  const bm25 = new Bm25Index(chunks.map((chunk) => tokenize(chunkSearchText(chunk))));

  let vectors: VectorIndex | null = null;
  if (file.embedding) {
    const { dimensions } = file.embedding;
    const matrix = new Int8Array(file.chunks.length * dimensions);
    file.chunks.forEach((chunk, i) => {
      matrix.set(decodeVector(chunk.vector ?? '', dimensions), i * dimensions);
    });
    vectors = new VectorIndex(matrix, dimensions);
  }

  return { chunks, embedding: file.embedding, contentHash: file.contentHash, bm25, vectors };
}

/**
 * Hybrid retrieval: BM25 and cosine similarity, fused with reciprocal rank fusion, behind a
 * relevance gate.
 *
 * A chunk is a candidate only if it clears `minSimilarity` or `minKeywordCoverage`. If none does,
 * the result is not `answerable` and has no hits, which is how the agent says "I don't know"
 * instead of answering from unrelated context.
 *
 * Pass `vector: null` (or use a keyword-only index) to retrieve with BM25 alone, e.g. when the
 * embedding provider is down.
 */
export function retrieve(
  index: LoadedIndex,
  query: { text: string; vector?: ArrayLike<number> | null },
  options: RetrievalOptions = {},
): RetrievalResult {
  const opts = { ...DEFAULT_RETRIEVAL, ...stripUndefined(options) };
  const keyword = index.bm25.search(tokenize(query.text));
  const similarities =
    index.vectors && query.vector ? index.vectors.similarities(query.vector) : null;

  const relevant = (i: number): boolean =>
    (similarities !== null && (similarities[i] ?? 0) >= opts.minSimilarity) ||
    (keyword.coverage[i] ?? 0) >= opts.minKeywordCoverage;

  const keywordList = keyword.ranked.slice(0, opts.candidates).filter(relevant);
  const lists: number[][] = [keywordList];
  let bestSimilarity: number | null = null;
  if (similarities) {
    const order = topIndices(similarities, opts.candidates);
    bestSimilarity = order.length > 0 ? (similarities[order[0] ?? 0] ?? 0) : 0;
    lists.push(order.filter(relevant));
  }

  let bestCoverage = 0;
  for (const i of keyword.ranked) bestCoverage = Math.max(bestCoverage, keyword.coverage[i] ?? 0);

  const hits = reciprocalRankFusion(lists, opts.rrfK)
    .slice(0, opts.topK)
    .flatMap(({ item, score }): RetrievalHit[] => {
      const chunk = index.chunks[item];
      if (!chunk) return [];
      return [
        {
          chunk,
          score,
          similarity: similarities ? (similarities[item] ?? 0) : null,
          keywordScore: keyword.scores[item] ?? 0,
          keywordCoverage: keyword.coverage[item] ?? 0,
        },
      ];
    });

  return {
    hits,
    answerable: hits.length > 0,
    mode: similarities ? 'hybrid' : 'keyword',
    best: { similarity: bestSimilarity, keywordCoverage: bestCoverage },
  };
}

/** Indices of the `k` largest values, largest first. */
function topIndices(values: Float32Array, k: number): number[] {
  if (k <= 0) return [];
  const top: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    if (top.length === k && value <= (values[top[k - 1] ?? 0] ?? 0)) continue;
    let position = top.length < k ? top.length : k - 1;
    while (position > 0 && (values[top[position - 1] ?? 0] ?? 0) < value) position -= 1;
    top.splice(position, 0, i);
    if (top.length > k) top.pop();
  }
  return top;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
