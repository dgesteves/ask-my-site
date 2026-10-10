// What the framework plugins share at build time: the default embedding model, `exclude`, and
// writing an index that reuses the previous build's vectors. Node.js only.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import type { EmbeddingModel } from 'ai';

import { buildIndex, type EmbeddingProviderOptions } from '../build';
import { parseIndexFile, serializeIndexFile, type AskIndexFile } from '../index-file';
import {
  checkEmbeddingSpec,
  embeddingFromSpec,
  EmbeddingSpecError,
  type EmbeddingChoice,
  type EmbeddingSpec,
} from '../node/embedding';
import { mcpServerName } from '../mcp-install';
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
   * The embedding model for the index, as the CLI's `--embedding` names it, so the config needs
   * no provider import: `openai:<model>` (needs @ai-sdk/openai and `OPENAI_API_KEY`),
   * `<provider>/<model>` through AI Gateway (`AI_GATEWAY_API_KEY`), `mock[:<dims>]`, or `none`
   * for a keyword-only index. The endpoint must use the same model. Instead of `embeddingModel`.
   */
  embedding?: EmbeddingSpec;
  /**
   * The vector size for `embedding` or the default model, as the CLI's `--dimensions`. The default
   * model is built at 512 unless this (or `embeddingProviderOptions`) says otherwise; with
   * `embedding`, the default is the model's own size.
   */
  dimensions?: number;
  /**
   * The embedding model for the index, as an AI SDK model; the endpoint must use the same one.
   * Default: OpenAI's `text-embedding-3-small` at 512 dimensions when `OPENAI_API_KEY` is set at
   * build time, the same model through AI Gateway when only `AI_GATEWAY_API_KEY` is, else `null`:
   * a keyword-only index, with a warning.
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

/** Throws on options that contradict each other or name no model, before anything is built. */
export function checkIndexOptions(options: IndexOptions): void {
  if (options.embedding !== undefined && options.embeddingModel !== undefined) {
    throw new Error('ask-my-site: pass `embedding` or `embeddingModel`, not both.');
  }
  if (options.dimensions !== undefined && options.embeddingModel !== undefined) {
    throw new Error(
      'ask-my-site: `dimensions` applies to `embedding` or the default model. With ' +
        '`embeddingModel`, set `embeddingProviderOptions` instead.',
    );
  }
  if (options.embedding !== undefined) {
    try {
      checkEmbeddingSpec(options.embedding, `embedding: '${options.embedding}'`);
    } catch (error) {
      throw new Error(`ask-my-site: ${(error as Error).message}`, { cause: error });
    }
  }
}

const DEFAULT_MODEL = 'text-embedding-3-small';
/**
 * The default model's vector size: a third of its full 1,536, for a third of the index, which
 * keeps a large site's index small enough to bundle with a function or serve as a static asset.
 * The endpoint reads the size from the index.
 */
export const DEFAULT_DIMENSIONS = 512;

/** Whether provider options already set a vector size, under any provider. */
const setsDimensions = (options: EmbeddingProviderOptions | undefined): boolean =>
  Object.values(options ?? {}).some((values) => 'dimensions' in values);

/**
 * The embedding model a build uses, with its provider options: `embeddingModel` or `embedding`
 * when given, else OpenAI's `text-embedding-3-small` when `OPENAI_API_KEY` is set, the same model
 * through AI Gateway when only `AI_GATEWAY_API_KEY` is, else none, with a warning. A key that is
 * set but cannot be used, because its provider package is missing or fails to load, fails the
 * build rather than quietly building a keyword-only index; `embedding: 'none'` opts out.
 */
export async function buildEmbedding(
  options: IndexOptions,
  log: Logger,
): Promise<{ model: EmbeddingModel | null; providerOptions?: EmbeddingProviderOptions }> {
  checkIndexOptions(options);
  const given = options.embeddingProviderOptions;
  if (options.embeddingModel !== undefined) {
    return { model: options.embeddingModel, ...(given ? { providerOptions: given } : {}) };
  }

  let spec: string | undefined = options.embedding;
  let dimensions = options.dimensions;
  if (spec === undefined) {
    const { OPENAI_API_KEY, AI_GATEWAY_API_KEY } = process.env;
    if (!OPENAI_API_KEY && !AI_GATEWAY_API_KEY) {
      log.warn(
        'No embedding model: building a keyword-only index. Set OPENAI_API_KEY or ' +
          'AI_GATEWAY_API_KEY at build time, or pass `embedding`, for semantic search.',
      );
      return { model: null };
    }
    spec = OPENAI_API_KEY ? `openai:${DEFAULT_MODEL}` : `openai/${DEFAULT_MODEL}`;
    if (dimensions === undefined && !setsDimensions(given)) dimensions = DEFAULT_DIMENSIONS;
  }
  const name =
    options.embedding === undefined
      ? `OPENAI_API_KEY is set, so the default embedding, ${spec},`
      : `embedding: '${spec}'`;

  let choice: EmbeddingChoice;
  try {
    choice = await embeddingFromSpec(spec, {
      ...(dimensions ? { dimensions } : {}),
      name,
    });
  } catch (error) {
    // Both keys set, without @ai-sdk/openai: AI Gateway serves the same model.
    if (
      options.embedding === undefined &&
      error instanceof EmbeddingSpecError &&
      process.env.AI_GATEWAY_API_KEY
    ) {
      log.warn(`${error.message.replace(/\.?$/, '.')} Embedding through AI Gateway instead.`);
      return buildEmbedding(
        { ...options, embedding: `openai/${DEFAULT_MODEL}`, ...(dimensions ? { dimensions } : {}) },
        log,
      );
    }
    const message = (error as Error).message.replace(/\.?$/, '.');
    const hint =
      options.embedding === undefined
        ? " Or set `embedding: 'none'` to build a keyword-only index."
        : '';
    throw new Error(`ask-my-site: ${message}${hint}`, { cause: error });
  }
  const providerOptions = mergeProviderOptions(given, choice.providerOptions);
  return { model: choice.model, ...(providerOptions ? { providerOptions } : {}) };
}

/** `a` with `b` over it, provider by provider: `dimensions` joins any other OpenAI options. */
function mergeProviderOptions(
  a: EmbeddingProviderOptions | undefined,
  b: EmbeddingProviderOptions | undefined,
): EmbeddingProviderOptions | undefined {
  if (!a || !b) return a ?? b;
  const merged = { ...a };
  for (const [provider, values] of Object.entries(b)) {
    merged[provider] = { ...a[provider], ...values };
  }
  return merged;
}

/**
 * Where the dialog posts: `ASK_ENDPOINT` when it is set at build or dev time, else `endpoint`,
 * else `/api/ask`. The variable wins so that `ASK_ENDPOINT=http://localhost:8787/api/ask npm start`
 * points any site at `ask-my-site dev`, whatever its config says, without editing it.
 */
export function dialogEndpoint(endpoint: string | undefined): string {
  return process.env.ASK_ENDPOINT?.trim() || (endpoint ?? '/api/ask');
}

const HINTED = Symbol.for('ask-my-site.devEndpointHint');

/**
 * Says how to get answers while developing, when the dialog posts to a path on the site that
 * `server`, the framework's dev server, does not serve. Once per process: Docusaurus loads its
 * plugins again as the site reloads.
 */
export function hintDevEndpoint(endpoint: string, server: string, log: Logger): void {
  const shared = globalThis as Record<symbol, unknown>;
  if (shared[HINTED] || !endpoint.startsWith('/') || endpoint.startsWith('//')) return;
  shared[HINTED] = true;
  log.info(
    `The dialog posts to ${endpoint}, which ${server} does not serve. For answers while you ` +
      'work, build the site once, run `npx ask-my-site dev`, and start the site with ' +
      'ASK_ENDPOINT=http://localhost:8787/api/ask.',
  );
}

/** What the dialog renders with: optional peers of ask-my-site that a plugin's site needs. */
const DIALOG_PEERS = ['react', 'react-dom', '@radix-ui/react-dialog', 'cmdk'];

/**
 * Warns, naming what to install, when a package the dialog renders with is missing, resolved as
 * the dialog's own modules resolve it (from `from`, default this package). Otherwise the site's
 * bundler fails later with "Cannot find package 'cmdk'", which does not say who needs it. A
 * warning, not an error, as a site may alias React to something else.
 */
export function warnMissingDialogPeers(log: Logger, from: string | URL = import.meta.url): void {
  const nativeRequire = createRequire(from);
  const missing = DIALOG_PEERS.filter((name) => {
    try {
      nativeRequire.resolve(name);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
    }
  });
  if (missing.length === 0) return;
  log.warn(
    `The ask dialog renders with ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not installed: npm i ${missing.join(' ')}`,
  );
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
  embeddingProviderOptions,
  options,
  file,
  cache,
  name,
  log,
}: {
  documents: SourceDocument[];
  embeddingModel: EmbeddingModel | null;
  embeddingProviderOptions?: EmbeddingProviderOptions | undefined;
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
    ...(embeddingProviderOptions ? { embeddingProviderOptions } : {}),
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

/** The plugins' `mcp` option: the MCP endpoint's URL or path, and optionally its name. */
export type McpOption = string | { url: string; name?: string };

/**
 * The `mcp` option as an absolute URL and a name: a path is resolved against the site's own URL
 * (`where` names the setting that holds it, for the error), and the name defaults to the site
 * title's slug. Throws on a path when the site has no URL.
 */
export function resolveMcp(
  option: McpOption | undefined,
  siteUrl: string | undefined,
  siteTitle: string,
  where: string,
): { url: string; name: string } | undefined {
  if (option === undefined) return undefined;
  const { url, name } = typeof option === 'string' ? { url: option, name: undefined } : option;
  let absolute: string;
  if (/^https?:\/\//i.test(url)) absolute = url;
  else if (siteUrl && URL.canParse(siteUrl)) absolute = new URL(url, siteUrl).href;
  else {
    throw new Error(
      `ask-my-site: mcp: '${url}' is a path, so the site's URL is needed to make it absolute. ` +
        `Set it in ${where}, or give the MCP endpoint as an absolute URL.`,
    );
  }
  return { url: absolute, name: mcpServerName(name ?? siteTitle) };
}
