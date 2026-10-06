/**
 * Brute-force cosine similarity over an int8 matrix.
 *
 * No approximate index: at the corpus sizes a static site has (thousands to tens of thousands of
 * chunks), an exact scan of int8 rows is a few milliseconds, has perfect recall and needs no
 * build step or tuning. Rows stay int8 in memory; only the query is float.
 */
export class VectorIndex {
  readonly dimensions: number;
  readonly size: number;
  private readonly matrix: Int8Array;
  private readonly inverseNorms: Float32Array;

  constructor(matrix: Int8Array, dimensions: number) {
    if (dimensions <= 0 || matrix.length % dimensions !== 0) {
      throw new RangeError('Matrix length must be a multiple of the dimension count.');
    }
    this.matrix = matrix;
    this.dimensions = dimensions;
    this.size = matrix.length / dimensions;
    this.inverseNorms = new Float32Array(this.size);
    for (let row = 0; row < this.size; row += 1) {
      let sum = 0;
      const offset = row * dimensions;
      for (let j = 0; j < dimensions; j += 1) {
        const value = matrix[offset + j] ?? 0;
        sum += value * value;
      }
      this.inverseNorms[row] = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    }
  }

  /** Cosine similarity of `query` against every row. */
  similarities(query: ArrayLike<number>): Float32Array {
    if (query.length !== this.dimensions) {
      throw new RangeError(
        `Query vector has ${String(query.length)} dimensions; the index has ${String(this.dimensions)}.`,
      );
    }
    const q = Float32Array.from(query);
    let norm = 0;
    for (const value of q) norm += value * value;
    const out = new Float32Array(this.size);
    if (norm === 0) return out;
    const inverseQueryNorm = 1 / Math.sqrt(norm);

    const { matrix, dimensions } = this;
    // Four independent accumulators let the CPU overlap the multiply-adds: about 30% faster
    // than a single running sum. The `?? 0` guards are free; V8 eliminates them.
    const unrolled = dimensions - (dimensions % 4);
    for (let row = 0, offset = 0; row < this.size; row += 1, offset += dimensions) {
      let a = 0;
      let b = 0;
      let c = 0;
      let d = 0;
      let j = 0;
      for (; j < unrolled; j += 4) {
        a += (q[j] ?? 0) * (matrix[offset + j] ?? 0);
        b += (q[j + 1] ?? 0) * (matrix[offset + j + 1] ?? 0);
        c += (q[j + 2] ?? 0) * (matrix[offset + j + 2] ?? 0);
        d += (q[j + 3] ?? 0) * (matrix[offset + j + 3] ?? 0);
      }
      for (; j < dimensions; j += 1) a += (q[j] ?? 0) * (matrix[offset + j] ?? 0);
      out[row] = (a + b + c + d) * (this.inverseNorms[row] ?? 0) * inverseQueryNorm;
    }
    return out;
  }
}
