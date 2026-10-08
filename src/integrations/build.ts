// What the framework plugins share at build time: the default embedding model, `exclude`, and
// writing an index that reuses the previous build's vectors. Node.js only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EmbeddingModel } from 'ai';

import { buildIndex, type EmbeddingProviderOptions } from '../build';
import { parseIndexFile, serializeIndexFile, type AskIndexFile } from '../index-file';
import type { ChunkingOptions, SourceDocument } from '../types';

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/**
 * The build options every plugin takes. A type, not an interface, so the Docusaurus plugin's
 * options still fit Docusaurus's `PluginOptions` index signature.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type IndexOptions = {
  /**
   * The embedding model for the index; the endpoint must use the same one. Default: OpenAI's
   * `text-embedding-3-small` when `OPENAI_API_KEY` is set at build time, the same model through
   * AI Gateway when only `AI_GATEWAY_API_KEY` is, else `null`: a keyword-only index, with a warning.
   */
  embeddingModel?: EmbeddingModel | null;
  /** Passed to the embedding model, default or not, e.g. `{ openai: { dimensions: 512 } }`. */
  embeddingProviderOptions?: EmbeddingProviderOptions;
  chunking?: ChunkingOptions;
};

/** Logs to the console with the plugin's prefix, for frameworks that give plugins no logger. */
export function consoleLogger(): Logger {
  return {
    info: (message) => {
      console.log(`[ask-my-site] ${message}`);
    },
    warn: (message) => {
      console.warn(`[ask-my-site] ${message}`);
    },
  };
}

export async function defaultEmbedding(
  options: IndexOptions,
  log: Logger,
): Promise<EmbeddingModel | null> {
  if (options.embeddingModel !== undefined) return options.embeddingModel;
  if (process.env.OPENAI_API_KEY) {
    try {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI().embedding('text-embedding-3-small');
    } catch {
      log.warn('OPENAI_API_KEY is set but @ai-sdk/openai is not installed: npm i @ai-sdk/openai');
    }
  }
  if (process.env.AI_GATEWAY_API_KEY) return 'openai/text-embedding-3-small';
  log.warn(
    'No embedding model: building a keyword-only index. Set OPENAI_API_KEY or AI_GATEWAY_API_KEY ' +
      'at build time, or pass `embeddingModel`, for semantic search.',
  );
  return null;
}

/**
 * Whether a path (with a leading slash) is one of `exclude`'s prefixes or below one:
 * `['/changelog', 'blog/']` leaves out `/changelog`, `/changelog/1.0` and `/blog`.
 */
export function excluder(exclude: readonly string[]): (path: string) => boolean {
  const prefixes = exclude.map((prefix) => `/${prefix.replace(/^\/+|\/+$/g, '')}`);
  return (path) => {
    const clean = `/${path.replace(/^\/+|\/+$/g, '')}`;
    return prefixes.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
  };
}

/**
 * Builds the index of `documents` and writes it to `file`. The previous build's index, kept at
 * `cache`, gives unchanged pages their vectors back instead of embedding them again; the new one
 * replaces it there. `name` is how the log line refers to the file.
 */
export async function writeSiteIndex({
  documents,
  embeddingModel,
  options,
  file,
  cache,
  name,
  log,
}: {
  documents: SourceDocument[];
  embeddingModel: EmbeddingModel | null;
  options: IndexOptions;
  file: string;
  cache: string;
  name: string;
  log: Logger;
}): Promise<void> {
  let previous: AskIndexFile | null = null;
  try {
    previous = parseIndexFile(await readFile(cache, 'utf8'));
  } catch {
    // First build, or an index from an incompatible version: embed everything.
  }

  const started = Date.now();
  const { index, stats } = await buildIndex({
    documents,
    embeddingModel,
    ...(options.embeddingProviderOptions
      ? { embeddingProviderOptions: options.embeddingProviderOptions }
      : {}),
    ...(options.chunking ? { chunking: options.chunking } : {}),
    previous,
  });
  const json = serializeIndexFile(index);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, json, 'utf8');
  await mkdir(dirname(cache), { recursive: true });
  await writeFile(cache, json, 'utf8');

  const reuse = embeddingModel
    ? `, ${String(stats.embedded)} embedded, ${String(stats.reused)} reused`
    : ', keyword-only';
  log.info(
    `Indexed ${String(documents.length)} pages into ${String(stats.chunks)} chunks${reuse} → ${name} (${String(Math.round(json.length / 1024))} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`,
  );
}
