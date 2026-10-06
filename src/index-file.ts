/**
 * The static index file: everything retrieval needs, as one JSON document.
 *
 * It is designed to be committed. Serialization is deterministic (sorted documents, no
 * timestamps) and writes one chunk per line, so a content edit is a small, reviewable diff and
 * `ask-my-site index --check` can fail CI when the file is stale.
 */

export const INDEX_FORMAT = 'ask-my-site/index@1';

export interface IndexDocument {
  id: string;
  url: string;
  title: string;
}

export interface IndexChunk {
  id: string;
  /** Position of the chunk's document in {@link AskIndexFile.documents}. */
  doc: number;
  /** Heading path joined with ` › `; empty at the top of a page. */
  heading: string;
  anchor?: string;
  text: string;
  /** First 16 hex characters of the SHA-256 of the embedded text; keys embedding reuse. */
  hash: string;
  /** int8 vector, base64. Absent in keyword-only indexes. */
  vector?: string;
}

export interface IndexEmbedding {
  /** Model id as reported by the model (`text-embedding-3-small`, `openai/text-embedding-3-small`). */
  model: string;
  dimensions: number;
}

export interface AskIndexFile {
  format: typeof INDEX_FORMAT;
  /** SHA-256 over the chunker version, chunking options and every chunk's location and text. */
  contentHash: string;
  chunking: { maxChars: number; overlap: number };
  /** `null` for a keyword-only index (built without an embedding model). */
  embedding: IndexEmbedding | null;
  documents: IndexDocument[];
  chunks: IndexChunk[];
}

export class AskIndexError extends Error {
  override name = 'AskIndexError';
}

function fail(path: string, expected: string): never {
  throw new AskIndexError(`Invalid ask-my-site index: \`${path}\` must be ${expected}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks that a parsed JSON value is a well-formed index and returns it typed.
 *
 * It validates structure and cross-references (chunk → document, vector presence) without
 * decoding vectors, so it stays cheap on a cold start. Vector lengths are checked on load.
 */
export function validateIndexFile(value: unknown): AskIndexFile {
  if (!isRecord(value)) fail('index', 'an object');
  if (value.format !== INDEX_FORMAT) {
    throw new AskIndexError(
      `Unsupported index format ${JSON.stringify(value.format)}; expected "${INDEX_FORMAT}". ` +
        'Rebuild it with this version of ask-my-site.',
    );
  }
  if (typeof value.contentHash !== 'string') fail('contentHash', 'a string');
  const { chunking, embedding, documents, chunks } = value;
  if (!isRecord(chunking) || typeof chunking.maxChars !== 'number') {
    fail('chunking', 'an object with numeric maxChars and overlap');
  }
  if (embedding !== null) {
    if (!isRecord(embedding) || typeof embedding.model !== 'string') {
      fail('embedding', 'null or { model, dimensions }');
    }
    if (!Number.isInteger(embedding.dimensions) || Number(embedding.dimensions) <= 0) {
      fail('embedding.dimensions', 'a positive integer');
    }
  }
  if (!Array.isArray(documents)) fail('documents', 'an array');
  documents.forEach((doc: unknown, i) => {
    if (!isRecord(doc) || typeof doc.id !== 'string' || typeof doc.url !== 'string') {
      fail(`documents[${String(i)}]`, 'an object with string id, url and title');
    }
    if (typeof doc.title !== 'string') fail(`documents[${String(i)}].title`, 'a string');
  });
  if (!Array.isArray(chunks)) fail('chunks', 'an array');
  chunks.forEach((chunk: unknown, i) => {
    const at = `chunks[${String(i)}]`;
    if (!isRecord(chunk)) fail(at, 'an object');
    if (typeof chunk.id !== 'string' || typeof chunk.text !== 'string') {
      fail(at, 'an object with string id and text');
    }
    if (typeof chunk.doc !== 'number' || chunk.doc < 0 || chunk.doc >= documents.length) {
      fail(`${at}.doc`, 'the index of an entry in documents');
    }
    if (typeof chunk.heading !== 'string') fail(`${at}.heading`, 'a string');
    if (embedding !== null && typeof chunk.vector !== 'string') {
      fail(`${at}.vector`, 'a base64 string, because the index declares an embedding model');
    }
  });
  return value as unknown as AskIndexFile;
}

/** Parses and validates index JSON. */
export function parseIndexFile(json: string): AskIndexFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new AskIndexError(`Index is not valid JSON: ${(error as Error).message}`);
  }
  return validateIndexFile(value);
}

/** Serializes an index deterministically: stable key order, one document or chunk per line. */
export function serializeIndexFile(index: AskIndexFile): string {
  const line = (value: unknown): string => JSON.stringify(value);
  const documents = index.documents.map((d) => line({ id: d.id, url: d.url, title: d.title }));
  const chunks = index.chunks.map((c) =>
    line({
      id: c.id,
      doc: c.doc,
      heading: c.heading,
      ...(c.anchor === undefined ? {} : { anchor: c.anchor }),
      text: c.text,
      hash: c.hash,
      ...(c.vector === undefined ? {} : { vector: c.vector }),
    }),
  );
  const list = (items: string[]): string =>
    items.length === 0 ? '[]' : `[\n    ${items.join(',\n    ')}\n  ]`;
  return [
    '{',
    `  "format": ${line(index.format)},`,
    `  "contentHash": ${line(index.contentHash)},`,
    `  "chunking": ${line({ maxChars: index.chunking.maxChars, overlap: index.chunking.overlap })},`,
    `  "embedding": ${line(index.embedding && { model: index.embedding.model, dimensions: index.embedding.dimensions })},`,
    `  "documents": ${list(documents)},`,
    `  "chunks": ${list(chunks)}`,
    '}',
    '',
  ].join('\n');
}
