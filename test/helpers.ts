import type { SourceDocument } from '../src';

/** Deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * Random unit vectors. With `clusters`, vectors are drawn around shared centroids, which is
 * closer to how real embeddings of one site's content are distributed than uniform noise.
 */
export function randomUnitVectors(
  count: number,
  dims: number,
  seed: number,
  options: { clusters?: number; spread?: number } = {},
): number[][] {
  const random = seeded(seed);
  const centroidRandom = seeded(9001);
  const centroids = Array.from({ length: options.clusters ?? 0 }, () =>
    Array.from({ length: dims }, () => gaussian(centroidRandom)),
  );
  const spread = options.spread ?? 0.9;
  return Array.from({ length: count }, () => {
    const centroid =
      centroids.length > 0 ? centroids[Math.floor(random() * centroids.length)] : null;
    const v = Array.from({ length: dims }, (_, j) =>
      centroid ? (centroid[j] ?? 0) + spread * gaussian(random) : gaussian(random),
    );
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  });
}

/** A small, varied corpus about a fictional product, used across tests. */
export const corpus: SourceDocument[] = [
  {
    id: 'install.md',
    url: '/docs/install',
    title: 'Installation',
    content: `Install the package with your package manager of choice.

## Requirements

You need Node.js 22 or newer. Bun and Deno work for the runtime parts.

## With pnpm

Run pnpm add ask-my-site ai zod, then add a provider such as @ai-sdk/openai.`,
  },
  {
    id: 'quantization.md',
    url: '/docs/quantization',
    title: 'Vector quantization',
    content: `Embeddings are stored as int8 vectors encoded in base64.

## Why int8

Each vector is scaled so its largest component maps to 127. Cosine similarity is scale-invariant, so no scale is stored. The file is a quarter of the size of float32.`,
  },
  {
    id: 'rate-limits.md',
    url: '/docs/rate-limits',
    title: 'Rate limiting',
    content: `The handler accepts a rateLimit hook.

## Upstash

Pass upstashRateLimit with a configured Ratelimit instance for a limit shared across regions.

## In memory

memoryRateLimit keeps a token bucket per client IP inside one process.`,
  },
  {
    id: 'pricing.md',
    url: '/pricing',
    title: 'Pricing',
    content: `The library is free and MIT licensed. You pay your model provider for embeddings and answers.`,
  },
];
