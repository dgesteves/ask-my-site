/**
 * int8 vector quantization and base64 transport.
 *
 * Each vector is scaled so its largest component maps to ±127, then rounded. No per-vector scale
 * is stored: retrieval only ever needs cosine similarity, which is invariant to scaling, so the
 * scale cancels out. That makes a vector exactly `dimensions` bytes, a quarter of float32, and
 * roughly a tenth of the same vector written as JSON numbers.
 */

/** Quantizes a vector to int8. A zero vector stays zero. Throws on NaN or infinity. */
export function quantizeInt8(vector: ArrayLike<number>): Int8Array {
  let max = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i] ?? 0;
    if (!Number.isFinite(value))
      throw new RangeError(`Vector component ${String(i)} is not finite.`);
    const magnitude = Math.abs(value);
    if (magnitude > max) max = magnitude;
  }
  const out = new Int8Array(vector.length);
  if (max === 0) return out;
  const scale = 127 / max;
  for (let i = 0; i < vector.length; i += 1) out[i] = Math.round((vector[i] ?? 0) * scale);
  return out;
}

/** Cosine similarity of two equal-length vectors; 0 if either is all zeros. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new RangeError(`Vector length mismatch: ${String(a.length)} vs ${String(b.length)}.`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

const CHUNK = 0x8000;

/** Standard base64 of raw bytes, using only `btoa` (available in every JS runtime). */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Inverse of {@link encodeBase64}. */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Quantizes and base64-encodes one embedding for the index file. */
export function encodeVector(vector: ArrayLike<number>): string {
  const quantized = quantizeInt8(vector);
  return encodeBase64(new Uint8Array(quantized.buffer, quantized.byteOffset, quantized.byteLength));
}

/** Decodes one index vector, checking it has the expected number of dimensions. */
export function decodeVector(base64: string, dimensions: number): Int8Array {
  const bytes = decodeBase64(base64);
  if (bytes.length !== dimensions) {
    throw new RangeError(
      `Vector has ${String(bytes.length)} dimensions; the index declares ${String(dimensions)}.`,
    );
  }
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
