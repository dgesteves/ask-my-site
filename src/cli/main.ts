import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

import type { EmbeddingModel } from 'ai';

import { version } from '../../package.json' with { type: 'json' };
import { buildIndex, checkIndex, embeddingModelId, type EmbeddingProviderOptions } from '../build';
import { DEFAULT_CHUNKING } from '../chunk';
import type { AskIndexFile } from '../index-file';
import { mockEmbeddingModel } from '../mock';
import {
  detectFramework,
  loadDirectory,
  readIndexFile,
  writeIndexFile,
  type AskConfig,
  type Framework,
} from '../node';
import type { ChunkingOptions, SourceDocument } from '../types';

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
}

const USAGE = `Usage: ask-my-site index [dir] [options]

Builds a static retrieval index from the Markdown, MDX and HTML files in <dir>.

Options:
  -o, --out <file>             Index file (default: ask-index.json)
      --check                  Exit 1 if the index is stale. Never calls a model.
      --base-url <url>         URL prefix for pages (default: /)
  -e, --embedding <spec>       openai:<model>    @ai-sdk/openai, needs OPENAI_API_KEY
                               <provider>/<model> AI Gateway, needs AI_GATEWAY_API_KEY
                               mock[:<dims>]     deterministic, offline
                               none              keyword-only index
                               (default: openai:text-embedding-3-small if OPENAI_API_KEY is set)
      --dimensions <n>         Vector size, for models that support it (e.g. 512).
                               With --check, the size the index must have.
      --chunk-size <chars>     Max characters per chunk (default: ${String(DEFAULT_CHUNKING.maxChars)})
      --chunk-overlap <chars>  Characters shared by consecutive chunks (default: ${String(DEFAULT_CHUNKING.overlap)})
      --ignore <glob>          Skip matching files; repeatable
      --framework <name>       How file paths become URLs: docusaurus | starlight | next | none
                               (default: detected from the framework config above <dir>)
  -c, --config <file>          Module whose default export is an AskConfig
  -q, --quiet                  Only print errors
  -h, --help                   Show this help
  -v, --version                Show the version

.env and .env.local in the working directory are loaded first, without overriding variables
that are already set.`;

class UsageError extends Error {}

const FRAMEWORKS: readonly (Framework | 'auto')[] = [
  'auto',
  'docusaurus',
  'starlight',
  'next',
  'none',
];
const FRAMEWORK_NAMES: Record<Exclude<Framework, 'none'>, string> = {
  docusaurus: 'Docusaurus',
  starlight: 'Starlight',
  next: 'Next.js-style (route groups, page.mdx)',
};

interface Flags {
  out: string;
  check: boolean;
  baseUrl?: string;
  embedding?: string;
  dimensions?: number;
  chunking: ChunkingOptions;
  ignore: string[];
  framework?: Framework | 'auto';
  config?: string;
  quiet: boolean;
}

function integerFlag(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`--${name} must be a non-negative integer.`);
  }
  return parsed;
}

function loadEnvFiles(io: CliIO): void {
  for (const name of ['.env.local', '.env']) {
    const path = resolve(io.cwd, name);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      io.env[key] ??= value;
    }
  }
}

interface EmbeddingChoice {
  /** `undefined`: no opinion (check mode without a flag). `null`: keyword-only. */
  model: EmbeddingModel | null | undefined;
  providerOptions?: EmbeddingProviderOptions;
  dimensions?: number;
}

async function resolveEmbedding(
  flags: Flags,
  config: AskConfig,
  io: CliIO,
  mode: 'build' | 'check',
): Promise<EmbeddingChoice> {
  const choice = await chooseEmbedding(flags, config, io, mode);
  const dims = flags.dimensions;
  if (dims === undefined || choice.dimensions !== undefined) return choice;
  // A check compares the size on its own, whatever the model. A build cannot apply it to a
  // config's model (or none), and silently ignoring it would build the wrong vectors.
  if (mode === 'check') return { ...choice, dimensions: dims };
  throw new UsageError(
    '--dimensions applies to the model given with --embedding. With a config module, set ' +
      'embeddingProviderOptions there instead.',
  );
}

async function chooseEmbedding(
  flags: Flags,
  config: AskConfig,
  io: CliIO,
  mode: 'build' | 'check',
): Promise<EmbeddingChoice> {
  const dims = flags.dimensions;
  const spec = flags.embedding;

  if (spec === undefined) {
    if (config.embeddingModel !== undefined) {
      return {
        model: config.embeddingModel,
        ...(config.embeddingProviderOptions
          ? { providerOptions: config.embeddingProviderOptions }
          : {}),
      };
    }
    if (mode === 'check') return { model: undefined };
    if (io.env.OPENAI_API_KEY) return resolveSpec('openai:text-embedding-3-small', dims, io, mode);
    if (io.env.AI_GATEWAY_API_KEY)
      return resolveSpec('openai/text-embedding-3-small', dims, io, mode);
    throw new UsageError(
      'No embedding model. Set OPENAI_API_KEY, pass --embedding <spec>, or use ' +
        '--embedding none for a keyword-only index.',
    );
  }
  return resolveSpec(spec, dims, io, mode);
}

async function resolveSpec(
  spec: string,
  dims: number | undefined,
  io: CliIO,
  mode: 'build' | 'check',
): Promise<EmbeddingChoice> {
  if (spec === 'none') return { model: null };

  const mock = /^mock(?::(\d+))?$/.exec(spec);
  if (mock) {
    const dimensions = mock[1] ? Number(mock[1]) : dims;
    const model = mockEmbeddingModel(dimensions ? { dimensions } : {});
    return { model, ...(dimensions ? { dimensions } : {}) };
  }

  const openai = /^openai:(.+)$/.exec(spec);
  if (openai?.[1]) {
    const modelId = openai[1];
    const providerOptions = dims ? { openai: { dimensions: dims } } : undefined;
    const choice = {
      ...(providerOptions ? { providerOptions } : {}),
      ...(dims ? { dimensions: dims } : {}),
    };
    // Checking compares ids only, so it needs neither the provider package nor a key.
    if (mode === 'check') return { model: modelId, ...choice };
    if (!io.env.OPENAI_API_KEY) throw new UsageError(`--embedding ${spec} needs OPENAI_API_KEY.`);
    let provider: typeof import('@ai-sdk/openai');
    try {
      provider = await import('@ai-sdk/openai');
    } catch {
      throw new UsageError(
        `--embedding ${spec} needs @ai-sdk/openai. Install it: npm i @ai-sdk/openai`,
      );
    }
    const client = provider.createOpenAI({
      apiKey: io.env.OPENAI_API_KEY,
      ...(io.env.OPENAI_BASE_URL ? { baseURL: io.env.OPENAI_BASE_URL } : {}),
    });
    return { model: client.embedding(modelId), ...choice };
  }

  const gateway = /^([\w-]+)\/(.+)$/.exec(spec);
  if (gateway?.[1]) {
    const providerOptions = dims ? { [gateway[1]]: { dimensions: dims } } : undefined;
    return {
      model: spec,
      ...(providerOptions ? { providerOptions } : {}),
      ...(dims ? { dimensions: dims } : {}),
    };
  }

  throw new UsageError(`Unknown --embedding "${spec}". Run ask-my-site --help.`);
}

async function loadConfig(path: string | undefined, io: CliIO): Promise<AskConfig> {
  if (!path) return {};
  const absolute = resolve(io.cwd, path);
  if (!existsSync(absolute)) throw new UsageError(`Config file not found: ${path}`);
  const module = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  const config = module.default;
  if (!config || typeof config !== 'object') {
    throw new UsageError(`${path} must export a config object as its default export.`);
  }
  return config;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function parseFlags(args: string[]): {
  command?: string;
  dir?: string;
  flags: Flags;
  help: boolean;
  version: boolean;
} {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        out: { type: 'string', short: 'o' },
        check: { type: 'boolean' },
        'base-url': { type: 'string' },
        embedding: { type: 'string', short: 'e' },
        dimensions: { type: 'string' },
        'chunk-size': { type: 'string' },
        'chunk-overlap': { type: 'string' },
        ignore: { type: 'string', multiple: true },
        framework: { type: 'string' },
        config: { type: 'string', short: 'c' },
        quiet: { type: 'boolean', short: 'q' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 2)
    throw new UsageError(`Unexpected argument: ${String(positionals[2])}`);
  const maxChars = integerFlag('chunk-size', values['chunk-size']);
  const overlap = integerFlag('chunk-overlap', values['chunk-overlap']);
  const dimensions = integerFlag('dimensions', values.dimensions);
  const framework = values.framework;
  if (framework !== undefined && !FRAMEWORKS.includes(framework as Framework | 'auto')) {
    throw new UsageError(`--framework must be one of ${FRAMEWORKS.join(', ')}.`);
  }
  return {
    ...(positionals[0] ? { command: positionals[0] } : {}),
    ...(positionals[1] ? { dir: positionals[1] } : {}),
    help: values.help ?? false,
    version: values.version ?? false,
    flags: {
      out: values.out ?? 'ask-index.json',
      check: values.check ?? false,
      ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}),
      ...(values.embedding ? { embedding: values.embedding } : {}),
      ...(dimensions ? { dimensions } : {}),
      chunking: {
        ...(maxChars !== undefined ? { maxChars } : {}),
        ...(overlap !== undefined ? { overlap } : {}),
      },
      ignore: values.ignore ?? [],
      ...(framework ? { framework: framework as Framework | 'auto' } : {}),
      ...(values.config ? { config: values.config } : {}),
      quiet: values.quiet ?? false,
    },
  };
}

/** Runs the CLI. Returns the exit code: 0 success, 1 failure or stale index, 2 usage error. */
export async function main(args: string[], io: CliIO): Promise<number> {
  try {
    const { command, dir, flags, help, version: showVersion } = parseFlags(args);
    if (showVersion) {
      io.stdout(version);
      return 0;
    }
    if (help || !command) {
      io.stdout(USAGE);
      return command || help ? 0 : 2;
    }
    if (command !== 'index') throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);

    loadEnvFiles(io);
    const config = await loadConfig(flags.config, io);
    const log = (line: string): void => {
      if (!flags.quiet) io.stdout(line);
    };

    const documents: SourceDocument[] = [];
    if (dir) {
      const root = resolve(io.cwd, dir);
      if (!existsSync(root) || !statSync(root).isDirectory()) {
        throw new UsageError(`Not a directory: ${dir}`);
      }
      const baseUrl = flags.baseUrl ?? config.baseUrl;
      const requested = flags.framework ?? config.framework ?? 'auto';
      if (!FRAMEWORKS.includes(requested)) {
        throw new UsageError(`framework must be one of ${FRAMEWORKS.join(', ')}.`);
      }
      const framework = requested === 'auto' ? await detectFramework(root) : requested;
      if (requested === 'auto' && framework !== 'none') {
        log(
          `Reading ${dir} with ${FRAMEWORK_NAMES[framework]} URLs (--framework none to turn off)`,
        );
      }
      if (framework === 'docusaurus' && !baseUrl) {
        log(
          'Docusaurus serves docs under /docs unless routeBasePath says otherwise: pass --base-url /docs',
        );
      }
      documents.push(
        ...(await loadDirectory(root, {
          ...(baseUrl ? { baseUrl } : {}),
          framework,
          ignore: [...(config.ignore ?? []), ...flags.ignore],
        })),
      );
    }
    if (config.documents) {
      const extra =
        typeof config.documents === 'function' ? await config.documents() : config.documents;
      documents.push(...extra);
    }
    if (!dir && !config.documents) throw new UsageError(`Missing <dir>.\n\n${USAGE}`);

    const chunking: ChunkingOptions = { ...config.chunking, ...flags.chunking };
    const out = resolve(io.cwd, flags.out);
    // Paths inside the working directory print relative; anything else prints absolute.
    const relativeOut = relative(io.cwd, out);
    const outLabel = relativeOut && !relativeOut.startsWith('..') ? relativeOut : out;

    if (flags.check) {
      const existing = await readIndexFile(out);
      if (!existing) {
        io.stderr(`✗ ${outLabel} does not exist. Run \`ask-my-site index\` without --check.`);
        return 1;
      }
      const embedding = await resolveEmbedding(flags, config, io, 'check');
      const result = await checkIndex({
        documents,
        index: existing,
        // Options not given again default to what the index was built with.
        chunking: { ...existing.chunking, ...chunking },
        ...(embedding.model !== undefined ? { embeddingModel: embedding.model } : {}),
        ...(embedding.dimensions ? { embeddingDimensions: embedding.dimensions } : {}),
        ...(embedding.providerOptions
          ? { embeddingProviderOptions: embedding.providerOptions }
          : {}),
      });
      if (result.upToDate) {
        log(`✓ ${outLabel} is up to date (${String(existing.chunks.length)} chunks).`);
        return 0;
      }
      io.stderr(`✗ ${outLabel} is stale.`);
      for (const problem of result.problems) io.stderr(`  ${problem}`);
      const sample = (label: string, ids: string[]): void => {
        if (ids.length === 0) return;
        const more = ids.length > 5 ? ` (+${String(ids.length - 5)} more)` : '';
        io.stderr(`  ${label}: ${ids.slice(0, 5).join(', ')}${more}`);
      };
      sample('added', result.added);
      sample('changed', result.changed);
      sample('removed', result.removed);
      io.stderr('  Rebuild it with `ask-my-site index` and commit the result.');
      return 1;
    }

    const embedding = await resolveEmbedding(flags, config, io, 'build');
    let previous: AskIndexFile | null = null;
    try {
      previous = await readIndexFile(out);
    } catch {
      log(`! Ignoring unreadable ${outLabel}; rebuilding from scratch.`);
    }
    const model = embedding.model ?? null;
    log(
      `→ ${String(documents.length)} documents, embedding with ${model ? embeddingModelId(model) : 'none (keyword-only)'}`,
    );
    const started = performance.now();
    const { index, stats } = await buildIndex({
      documents,
      embeddingModel: model,
      ...(embedding.providerOptions ? { embeddingProviderOptions: embedding.providerOptions } : {}),
      chunking,
      previous,
      onProgress: ({ embedded, total }) => {
        log(`  embedded ${String(embedded)}/${String(total)} chunks`);
      },
    });
    await writeIndexFile(out, index);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const reuse = index.embedding
      ? `, ${String(stats.embedded)} embedded, ${String(stats.reused)} reused`
      : '';
    log(
      `✓ ${String(stats.chunks)} chunks${reuse} → ${outLabel} (${formatBytes(statSync(out).size)}, ${seconds}s)`,
    );
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(error.message);
      return 2;
    }
    io.stderr(`✗ ${error instanceof Error ? error.message : String(error)}`);
    if (io.env.DEBUG && error instanceof Error && error.stack) io.stderr(error.stack);
    return 1;
  }
}
