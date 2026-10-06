export interface FusedResult {
  /** The item, e.g. a chunk index. */
  item: number;
  /** Sum over lists of 1 / (k + rank), rank starting at 1. */
  score: number;
}

/**
 * Reciprocal rank fusion (Cormack, Clarke & Büttcher, 2009).
 *
 * Merges ranked lists using ranks only, so BM25 scores and cosine similarities never have to be
 * put on a common scale. An item near the top of both lists beats one at the top of only one.
 * Ties break by best single rank, then by item, so the output is deterministic.
 */
export function reciprocalRankFusion(lists: readonly (readonly number[])[], k = 60): FusedResult[] {
  const scores = new Map<number, { score: number; bestRank: number }>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1;
      const entry = scores.get(item) ?? { score: 0, bestRank: Number.POSITIVE_INFINITY };
      entry.score += 1 / (k + rank);
      entry.bestRank = Math.min(entry.bestRank, rank);
      scores.set(item, entry);
    });
  }
  return [...scores.entries()]
    .sort(([a, x], [b, y]) => y.score - x.score || x.bestRank - y.bestRank || a - b)
    .map(([item, { score }]) => ({ item, score }));
}
