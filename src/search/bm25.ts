/**
 * Okapi BM25 over an in-memory inverted index.
 *
 * Besides the score, every search reports each document's *query coverage*: the share of the
 * query's IDF mass that the document contains. Coverage is bounded to [0, 1] and comparable across
 * corpora and query lengths, which BM25 scores are not, so it is what the relevance gate uses.
 */

export interface Bm25Options {
  /** Term-frequency saturation. Default 1.2. */
  k1?: number;
  /** Length normalization. Default 0.75. */
  b?: number;
}

export interface Bm25Result {
  /** BM25 score per document; 0 where no query term matched. */
  scores: Float32Array;
  /** Query coverage per document, in [0, 1]. */
  coverage: Float32Array;
  /** Indices of documents with a non-zero score, best first. */
  ranked: number[];
}

interface Postings {
  docs: Uint32Array;
  freqs: Uint16Array;
}

export class Bm25Index {
  readonly size: number;
  private readonly postings = new Map<string, Postings>();
  private readonly lengths: Uint32Array;
  private readonly averageLength: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(documents: readonly (readonly string[])[], options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.size = documents.length;
    this.lengths = new Uint32Array(documents.length);

    const lists = new Map<string, number[]>();
    let total = 0;
    documents.forEach((terms, doc) => {
      this.lengths[doc] = terms.length;
      total += terms.length;
      const counts = new Map<string, number>();
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const [term, count] of counts) {
        let list = lists.get(term);
        if (!list) lists.set(term, (list = []));
        list.push(doc, count);
      }
    });
    for (const [term, list] of lists) {
      const docs = new Uint32Array(list.length / 2);
      const freqs = new Uint16Array(list.length / 2);
      for (let i = 0; i < docs.length; i += 1) {
        docs[i] = list[2 * i] ?? 0;
        freqs[i] = Math.min(list[2 * i + 1] ?? 0, 0xffff);
      }
      this.postings.set(term, { docs, freqs });
    }
    this.averageLength = documents.length > 0 ? total / documents.length : 0;
  }

  /** Inverse document frequency (the BM25+ variant, always positive). */
  idf(term: string): number {
    const df = this.postings.get(term)?.docs.length ?? 0;
    return Math.log(1 + (this.size - df + 0.5) / (df + 0.5));
  }

  search(queryTerms: readonly string[]): Bm25Result {
    const scores = new Float32Array(this.size);
    const matched = new Float32Array(this.size);
    const terms = [...new Set(queryTerms)];
    let totalIdf = 0;

    for (const term of terms) {
      const idf = this.idf(term);
      totalIdf += idf;
      const postings = this.postings.get(term);
      if (!postings) continue;
      for (let i = 0; i < postings.docs.length; i += 1) {
        const doc = postings.docs[i] ?? 0;
        const tf = postings.freqs[i] ?? 0;
        const norm = 1 - this.b + (this.b * (this.lengths[doc] ?? 0)) / (this.averageLength || 1);
        scores[doc] = (scores[doc] ?? 0) + (idf * (tf * (this.k1 + 1))) / (tf + this.k1 * norm);
        matched[doc] = (matched[doc] ?? 0) + idf;
      }
    }

    const ranked: number[] = [];
    for (let doc = 0; doc < this.size; doc += 1) if ((scores[doc] ?? 0) > 0) ranked.push(doc);
    ranked.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);

    const coverage = matched;
    if (totalIdf > 0)
      for (let doc = 0; doc < this.size; doc += 1) coverage[doc] = (matched[doc] ?? 0) / totalIdf;
    return { scores, coverage, ranked };
  }
}
