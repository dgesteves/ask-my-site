import { describe, expect, it } from 'vitest';

import {
  VectorIndex,
  cosineSimilarity,
  decodeBase64,
  decodeVector,
  encodeBase64,
  encodeVector,
  quantizeInt8,
} from '../src';
import { randomUnitVectors } from './helpers';

describe('int8 quantization', () => {
  it('maps the largest component to ±127 and keeps zero vectors at zero', () => {
    expect([...quantizeInt8([0.5, -1, 0.25, 0])]).toEqual([64, -127, 32, 0]);
    expect([...quantizeInt8([0, 0, 0])]).toEqual([0, 0, 0]);
    expect(() => quantizeInt8([1, Number.NaN])).toThrow(RangeError);
  });

  it('round-trips through base64 byte for byte', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    const [vector] = randomUnitVectors(1, 512, 7);
    const decoded = decodeVector(encodeVector(vector!), 512);
    expect(decoded).toEqual(quantizeInt8(vector!));
    expect(() => decodeVector(encodeVector(vector!), 256)).toThrow(/512 dimensions/);
  });

  it('preserves direction: cosine(original, quantized) > 0.9999 at 512 and 1536 dimensions', () => {
    for (const dims of [512, 1536]) {
      for (const vector of randomUnitVectors(200, dims, dims)) {
        expect(cosineSimilarity(vector, quantizeInt8(vector))).toBeGreaterThan(0.9999);
      }
    }
  });

  it('keeps query similarities within 0.005 of float32 and preserves top-10 ranking', () => {
    const corpus = randomUnitVectors(2000, 512, 1, { clusters: 40 });
    const queries = randomUnitVectors(50, 512, 2, { clusters: 40 });
    const matrix = new Int8Array(corpus.length * 512);
    corpus.forEach((v, i) => {
      matrix.set(quantizeInt8(v), i * 512);
    });
    const index = new VectorIndex(matrix, 512);

    let maxError = 0;
    let overlap = 0;
    for (const query of queries) {
      const exact = corpus.map((v) => cosineSimilarity(query, v));
      const approx = index.similarities(query);
      exact.forEach((value, i) => {
        maxError = Math.max(maxError, Math.abs(value - approx[i]!));
      });
      const top = (scores: ArrayLike<number>): Set<number> =>
        new Set(
          Array.from(scores, (s, i) => [s, i] as const)
            .sort((a, b) => b[0] - a[0])
            .slice(0, 10)
            .map(([, i]) => i),
        );
      const exactTop = top(exact);
      for (const i of top(approx)) if (exactTop.has(i)) overlap += 1;
    }
    expect(maxError).toBeLessThan(0.005);
    expect(overlap / (queries.length * 10)).toBeGreaterThanOrEqual(0.98);
  });

  it('rejects mismatched query dimensions', () => {
    const index = new VectorIndex(new Int8Array(8), 4);
    expect(index.size).toBe(2);
    expect(() => index.similarities([1, 2, 3])).toThrow(/3 dimensions/);
  });
});
