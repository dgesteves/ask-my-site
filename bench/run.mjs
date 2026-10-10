// Benchmarks the built package (dist/) on synthetic corpora: index size, cold load, and
// retrieval latency. Run with `pnpm bench`. Pass corpus sizes as arguments to override, e.g.
// `node --expose-gc bench/run.mjs 1000 10000 50000`. Without --expose-gc, heap memory is not
// reported. Process memory (RSS) is measured in a fresh Node.js process per size, as a server
// instance loads the index on its first question.
//
// The corpus is synthetic but shaped like documentation: Zipf-distributed vocabulary, chunks of
// 600-1000 characters grouped into pages with headings, and 512-dimension embeddings drawn
// around shared topic centroids (real embeddings of one site cluster the same way). Query
// latency excludes the embedding API call, which is network-bound and the same for any design.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';

import {
  INDEX_FORMAT,
  cosineSimilarity,
  encodeVector,
  loadIndex,
  retrieve,
  serializeIndexFile,
} from '../dist/index.js';

const DIMS = 512;
const QUERIES = 1000;
const WARMUP = 100;
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const SIZES = sizes.length > 0 ? sizes : [1000, 10000, 50000];

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seeded(42);
const gaussian = () =>
  Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());

// 20k pseudo-words, sampled with a Zipf distribution like natural text.
const SYLLABLES = 'ka lo mi ne su ta ri po de va ge zu fi no ba te lu so re xi'.split(' ');
const VOCABULARY = Array.from({ length: 20000 }, (_, i) => {
  let word = '';
  let n = i + 1;
  do {
    word += SYLLABLES[n % SYLLABLES.length];
    n = Math.floor(n / SYLLABLES.length);
  } while (n > 0);
  return word;
});
const zipfWeights = VOCABULARY.map((_, i) => 1 / (i + 1) ** 1.07);
const zipfTotal = zipfWeights.reduce((a, b) => a + b, 0);
const cumulative = [];
zipfWeights.reduce((sum, w, i) => (cumulative[i] = sum + w / zipfTotal), 0);
function word() {
  const r = random();
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return VOCABULARY[lo];
}
function sentence(min, max) {
  const n = min + Math.floor(random() * (max - min));
  const words = Array.from({ length: n }, word);
  return `${words[0][0].toUpperCase()}${words.join(' ').slice(1)}.`;
}
function paragraph(chars) {
  let text = '';
  while (text.length < chars) text += `${sentence(6, 18)} `;
  return text.trim();
}

const centroids = Array.from({ length: 64 }, () => Array.from({ length: DIMS }, gaussian));
function vector() {
  const c = centroids[Math.floor(random() * centroids.length)];
  const v = c.map((x) => x + 0.9 * gaussian());
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

function corpus(n) {
  const documents = [];
  const chunks = [];
  const vectors = [];
  for (let i = 0; i < n; i += 1) {
    const doc = Math.floor(i / 20);
    if (i % 20 === 0) {
      documents.push({ id: `page-${doc}.md`, url: `/docs/page-${doc}`, title: sentence(2, 5) });
    }
    const v = vector();
    vectors.push(v);
    chunks.push({
      id: `page-${doc}.md#${i % 20}`,
      doc,
      heading: sentence(2, 4).slice(0, -1),
      anchor: `section-${i % 20}`,
      text: paragraph(600 + Math.floor(random() * 400)),
      hash: i.toString(16).padStart(16, '0'),
      vector: encodeVector(v),
    });
  }
  const file = {
    format: INDEX_FORMAT,
    contentHash: 'bench',
    chunking: { maxChars: 1200, overlap: 150 },
    embedding: { model: 'synthetic', dimensions: DIMS },
    documents,
    chunks,
  };
  return { file, vectors };
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const ms = (n) => `${n.toFixed(2)} ms`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function time(fn, runs) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b);
}

// Run in a fresh process: how much the process grows to load the index from its JSON text, as
// `index: () => readFile(…)` does. Peak includes the text and the parse; steady is what stays once
// the text is collected. This is what counts against a platform's memory limit, and it is more
// than the heap the index retains: V8 and the allocator keep pages they have used.
const RSS_PROBE = `
const { readFileSync } = await import('node:fs');
const { loadIndex } = await import(process.argv[1]);
globalThis.gc({ type: 'major', execution: 'sync' });
const start = process.memoryUsage().rss;
let text = readFileSync(process.argv[2], 'utf8');
const index = loadIndex(text);
text = null;
globalThis.gc({ type: 'major', execution: 'sync' });
const steady = process.memoryUsage().rss;
const peak = process.resourceUsage().maxRSS * 1024;
console.log(JSON.stringify({ chunks: index.chunks.length, steady: steady - start, peak: peak - start }));
`;

function rssGrowth(json) {
  const dir = mkdtempSync(join(tmpdir(), 'ondocs-bench-'));
  try {
    const file = join(dir, 'ask-index.json');
    writeFileSync(file, json);
    const dist = new URL('../dist/index.js', import.meta.url).href;
    const out = execFileSync(
      process.execPath,
      ['--expose-gc', '--input-type=module', '-e', RSS_PROBE, dist, file],
      { encoding: 'utf8' },
    );
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const results = [];
for (const n of SIZES) {
  process.stdout.write(`\n${n} chunks: generating… `);
  const { file, vectors } = corpus(n);
  const json = serializeIndexFile(file);
  const bytes = Buffer.byteLength(json);
  const gzip = gzipSync(json).length;
  // The same index with vectors as JSON numbers at 9 significant digits, as embedding APIs return them.
  const floatBytes =
    bytes -
    file.chunks.reduce((sum, c) => sum + c.vector.length, 0) +
    vectors.reduce(
      (sum, v) => sum + JSON.stringify(v.map((x) => Number(x.toPrecision(9)))).length - 2,
      0,
    );

  process.stdout.write('loading… ');
  // Retained memory: heap plus array buffers, measured across a full, synchronous collection.
  const used = () => {
    globalThis.gc?.({ type: 'major', execution: 'sync' });
    const usage = process.memoryUsage();
    return usage.heapUsed + usage.arrayBuffers;
  };
  const before = used();
  const index = loadIndex(json);
  const memory = globalThis.gc ? used() - before : Number.NaN;
  const loads = time(() => loadIndex(json), 5);
  const rss = rssGrowth(json);

  process.stdout.write('querying… ');
  const queries = Array.from({ length: QUERIES + WARMUP }, () => ({
    text: Array.from({ length: 3 + Math.floor(random() * 5) }, word).join(' '),
    vector: vector(),
  }));
  const run = (i) => retrieve(index, queries[i], { minSimilarity: 0, minKeywordCoverage: 0 });
  time(run, WARMUP);
  const hybrid = time((i) => run(i + WARMUP), QUERIES);
  const keyword = time((i) => retrieve(index, { text: queries[i + WARMUP].text }), QUERIES);
  const scan = time((i) => index.vectors.similarities(queries[i + WARMUP].vector), QUERIES);

  // Recall of int8 against exact float32 cosine, top 10, on 100 queries.
  let overlap = 0;
  const recallQueries = 100;
  for (let q = 0; q < recallQueries; q += 1) {
    const query = queries[q].vector;
    const exact = vectors
      .map((v, i) => [cosineSimilarity(query, v), i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 10)
      .map(([, i]) => i);
    const approx = Array.from(index.vectors.similarities(query), (s, i) => [s, i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, 10)
      .map(([, i]) => i);
    const set = new Set(exact);
    overlap += approx.filter((i) => set.has(i)).length;
  }

  const result = {
    chunks: n,
    indexBytes: bytes,
    indexGzipBytes: gzip,
    floatJsonBytes: floatBytes,
    loadMs: percentile(loads, 0.5),
    memoryBytes: memory,
    rssSteadyBytes: rss.steady,
    rssPeakBytes: rss.peak,
    hybrid: {
      p50: percentile(hybrid, 0.5),
      p95: percentile(hybrid, 0.95),
      p99: percentile(hybrid, 0.99),
    },
    keyword: { p50: percentile(keyword, 0.5), p95: percentile(keyword, 0.95) },
    vectorScan: { p50: percentile(scan, 0.5), p95: percentile(scan, 0.95) },
    recallAt10: overlap / (recallQueries * 10),
  };
  results.push(result);
  console.log('done');
}

const machine = `${cpus()[0]?.model ?? 'unknown CPU'}, ${String(Math.round(totalmem() / 1024 ** 3))} GB, Node ${process.version}`;
const lines = [
  `Machine: ${machine}. ${DIMS}-dimension vectors, ${QUERIES} queries per size after ${WARMUP} warm-up.`,
  '',
  '| Chunks | Index (raw) | Index (gzip) | Same index, float JSON | Cold load | Heap retained | RSS growth (peak) | Query p50 | Query p95 | Query p99 | Recall@10 vs float32 |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(
    (r) =>
      `| ${r.chunks.toLocaleString('en-US')} | ${mb(r.indexBytes)} | ${mb(r.indexGzipBytes)} | ${mb(r.floatJsonBytes)} | ${ms(r.loadMs)} | ${mb(r.memoryBytes)} | ${mb(r.rssSteadyBytes)} (${mb(r.rssPeakBytes)}) | ${ms(r.hybrid.p50)} | ${ms(r.hybrid.p95)} | ${ms(r.hybrid.p99)} | ${(r.recallAt10 * 100).toFixed(1)}% |`,
  ),
  '',
  'Query time split (p50 / p95):',
  '',
  '| Chunks | BM25 only | Vector scan only |',
  '| ---: | ---: | ---: |',
  ...results.map(
    (r) =>
      `| ${r.chunks.toLocaleString('en-US')} | ${ms(r.keyword.p50)} / ${ms(r.keyword.p95)} | ${ms(r.vectorScan.p50)} / ${ms(r.vectorScan.p95)} |`,
  ),
];
console.log(`\n${lines.join('\n')}`);
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('./results/latest.json', import.meta.url),
  `${JSON.stringify({ machine, dims: DIMS, results }, null, 2)}\n`,
);
