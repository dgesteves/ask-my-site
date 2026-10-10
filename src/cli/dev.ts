// `ask-my-site dev`: the ask endpoint on this machine, answering from a built index, so the dialog
// on a site's dev server has something to post to. Node.js only.
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { EmbeddingModel, LanguageModel } from 'ai';

import type { EmbeddingProviderOptions } from '../build';
import type { AskIndexFile } from '../index-file';
import { MOCK_MIN_SIMILARITY, mockEmbeddingModel, mockLanguageModel } from '../mock';
import { readIndexFile } from '../node';
import { importOptional } from '../node/optional';
import type { RetrievalOptions } from '../search/retrieve';
import { createAskHandler, memoryRateLimit } from '../server';
import type { CliIO } from './main';

export const DEV_USAGE = `Usage: ask-my-site dev [options]

Serves POST /api/ask on this machine, answering from an index, for the dialog on a site's dev
server. Questions are embedded as the index was: with the mock model, with OpenAI or AI Gateway
when the index was (set OPENAI_API_KEY or AI_GATEWAY_API_KEY), or not at all for a keyword-only
index. Answers come from OpenAI when OPENAI_API_KEY is set, else from the mock model.

Options:
      --index <file>           Index file (default: ask-index.json, then build/ask-index.json,
                               then dist/ask-index.json)
      --port <n>               Port on 127.0.0.1 (default: 8787)
      --origin <origin>        Origin allowed to call it (CORS); repeatable (default: any)
      --model <id>             OpenAI model for answers (default: gpt-5.4-mini)
  -h, --help                   Show this help

.env and .env.local in the working directory are loaded first. A rebuilt index is picked up on
the next question. Up to 30 questions a minute are answered.`;

/** Where `dev` looks for an index: the CLI's output, then Docusaurus's and Astro's build output. */
export const INDEX_FILES = ['ask-index.json', 'build/ask-index.json', 'dist/ask-index.json'];

/** A setup problem to explain, rather than a crash. */
export class DevError extends Error {}

export interface DevModels {
  model: LanguageModel;
  embeddingModel?: EmbeddingModel;
  embeddingProviderOptions?: EmbeddingProviderOptions;
  retrieval?: RetrievalOptions;
  /** How questions are embedded and answered, for the log. */
  description: string;
}

/**
 * The models that answer from `index`: questions embedded with the model the index was built with
 * (the mock one, OpenAI's, or AI Gateway's), and answers from OpenAI (or AI Gateway) when its key
 * is set, else from the mock model. Throws a {@link DevError} when the index's model cannot be
 * used here.
 */
export async function devModels(
  index: AskIndexFile,
  env: Record<string, string | undefined>,
  answerModel = 'gpt-5.4-mini',
): Promise<DevModels> {
  const { OPENAI_API_KEY, AI_GATEWAY_API_KEY, OPENAI_BASE_URL } = env;
  let openai: ReturnType<(typeof import('@ai-sdk/openai'))['createOpenAI']> | undefined;
  const openaiProvider = async () => {
    if (openai) return openai;
    const provider = await importOptional<typeof import('@ai-sdk/openai')>('@ai-sdk/openai');
    if (!provider) {
      throw new DevError(
        'OPENAI_API_KEY is set, but @ai-sdk/openai is not installed: npm i @ai-sdk/openai',
      );
    }
    openai = provider.createOpenAI({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
    });
    return openai;
  };

  const [model, answers]: [LanguageModel, string] = OPENAI_API_KEY
    ? [(await openaiProvider())(answerModel), `answers from ${answerModel}`]
    : AI_GATEWAY_API_KEY
      ? [`openai/${answerModel}`, `answers from openai/${answerModel} through AI Gateway`]
      : [mockLanguageModel(), 'answers from the mock model, which quotes the sources'];

  const embedding = index.embedding;
  if (!embedding) return { model, description: `keyword-only retrieval, ${answers}` };

  const mock = /^mock-hash-(\d+)$/.exec(embedding.model);
  if (mock) {
    return {
      model,
      embeddingModel: mockEmbeddingModel({ dimensions: Number(mock[1]) }),
      retrieval: { minSimilarity: MOCK_MIN_SIMILARITY },
      description: `mock embeddings, ${answers}`,
    };
  }

  // OpenAI's own ids are bare (`text-embedding-3-small`); AI Gateway's name the provider.
  const gateway = embedding.model.includes('/');
  const bare = embedding.model.replace(/^openai\//, '');
  const fromOpenAI = gateway
    ? embedding.model.startsWith('openai/')
    : bare.startsWith('text-embedding-');
  // text-embedding-3 models take a size; the index records the one it was built with.
  const embeddingProviderOptions = bare.startsWith('text-embedding-3-')
    ? { openai: { dimensions: embedding.dimensions } }
    : undefined;
  const sized = embeddingProviderOptions ? { embeddingProviderOptions } : {};
  if (fromOpenAI && OPENAI_API_KEY) {
    return {
      model,
      embeddingModel: (await openaiProvider()).embedding(bare),
      ...sized,
      description: `${bare} embeddings from OpenAI, ${answers}`,
    };
  }
  if ((gateway || fromOpenAI) && AI_GATEWAY_API_KEY) {
    const id = gateway ? embedding.model : `openai/${bare}`;
    return {
      model,
      embeddingModel: id,
      ...sized,
      description: `${id} embeddings through AI Gateway, ${answers}`,
    };
  }
  throw new DevError(
    fromOpenAI || gateway
      ? `The index was embedded with ${embedding.model}, so questions must be too: set ` +
          `${fromOpenAI ? 'OPENAI_API_KEY or ' : ''}AI_GATEWAY_API_KEY. To try it without a key, ` +
          'rebuild the index with --embedding mock.'
      : `The index was embedded with ${embedding.model}, which ask-my-site dev cannot load: it ` +
          'embeds with OpenAI, AI Gateway or the mock model. Serve this index with your own ' +
          'createAskHandler, or rebuild it with --embedding mock to try it.',
  );
}

/** The index to serve: `--index`, else the first of {@link INDEX_FILES} in `cwd`. */
export function findIndexFile(cwd: string, index?: string): string {
  if (index !== undefined) {
    const file = resolve(cwd, index);
    if (!existsSync(file)) throw new DevError(`No index at ${index}.`);
    return file;
  }
  const file = INDEX_FILES.map((name) => resolve(cwd, name)).find((path) => existsSync(path));
  if (file) return file;
  throw new DevError(
    `No index found: looked for ${INDEX_FILES.join(', ')}. Build one with ` +
      '`ask-my-site index <dir>` (or your site’s build, with the Docusaurus or Astro plugin), ' +
      'or pass --index <file>.',
  );
}

export interface DevServerOptions {
  /** The index file, absolute. */
  file: string;
  /** Default 8787; 0 picks a free port. */
  port?: number;
  /** Origins allowed to call the endpoint; `*` (the default) allows any. */
  origins?: readonly string[];
  /** OpenAI model for answers, when OPENAI_API_KEY is set. */
  answerModel?: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  error: (line: string) => void;
}

export interface DevServer {
  /** `http://localhost:<port>/api/ask` */
  endpoint: string;
  /** How questions are embedded and answered. */
  description: string;
  chunks: number;
  close: () => Promise<void>;
}

/**
 * Serves `createAskHandler` at `/api/ask` on 127.0.0.1, with CORS for `origins`. The index is read
 * again, with its models chosen again, when the file changes, so rebuilding the site is enough.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const origins = options.origins?.length ? options.origins : ['*'];
  const load = async () => {
    const index = await readIndexFile(options.file);
    if (!index) throw new DevError(`No index at ${options.file}.`);
    const { description, ...models } = await devModels(index, options.env, options.answerModel);
    const handler = createAskHandler({
      index,
      ...models,
      // Every question comes from this machine, so one bucket, roomier than a public endpoint's
      // default, still bounds what a runaway page can spend of your key.
      rateLimit: memoryRateLimit({ limit: 30, windowMs: 60_000, key: () => 'local' }),
      onFinish: ({ question, refused, sources }) => {
        options.log(
          `  ${refused ? 'refused' : `answered from ${String(sources.length)} sources`}: ${question}`,
        );
      },
      onError: (error) => {
        options.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    return { handler, description, chunks: index.chunks.length };
  };

  let current = await load();
  let loadedAt = (await stat(options.file)).mtimeMs;
  // A rebuilt index replaces the handler before the next question is answered.
  const handlerFor = async () => {
    const modified = (await stat(options.file)).mtimeMs;
    if (modified !== loadedAt) {
      loadedAt = modified;
      current = await load();
      options.log(`Reloaded the index (${String(current.chunks)} chunks).`);
    }
    return current.handler;
  };

  const cors = (request: IncomingMessage): Record<string, string> => {
    const origin = request.headers.origin;
    const allowed = origins.includes('*')
      ? '*'
      : origin && origins.includes(origin)
        ? origin
        : undefined;
    return {
      ...(allowed ? { 'access-control-allow-origin': allowed } : {}),
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...(allowed === '*' ? {} : { vary: 'origin' }),
    };
  };

  const server = createServer((request, response) => {
    void serve(request, response).catch((error: unknown) => {
      options.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json', ...cors(request) });
      }
      response.end(
        JSON.stringify({ error: { code: 'internal_error', message: 'See the dev server log.' } }),
      );
    });
  });

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/ask') {
      response.writeHead(404, { 'content-type': 'application/json', ...cors(request) });
      response.end(
        JSON.stringify({
          error: { code: 'not_found', message: 'ask-my-site dev answers POST /api/ask.' },
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    // Stops the answer when the browser goes away, as a platform would.
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) controller.abort();
    });
    const method = request.method ?? 'GET';
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const answer = await (
      await handlerFor()
    )(
      new Request(url, {
        method,
        headers,
        signal: controller.signal,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
      }),
    );
    response.writeHead(answer.status, { ...Object.fromEntries(answer.headers), ...cors(request) });
    if (answer.body) {
      for await (const chunk of answer.body) response.write(chunk);
    }
    response.end();
  }

  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new DevError(`Port ${String(options.port ?? 8787)} is in use: pass --port <n>.`)
          : error,
      );
    });
    server.listen(options.port ?? 8787, '127.0.0.1', () => {
      const address = server.address();
      resolvePort(typeof address === 'object' && address ? address.port : 0);
    });
  });

  return {
    endpoint: `http://localhost:${String(port)}/api/ask`,
    description: current.description,
    chunks: current.chunks,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections();
        server.close(() => {
          resolveClose();
        });
      }),
  };
}

/** Aborts on Ctrl+C or a termination signal. */
function untilInterrupted(): AbortSignal {
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) {
    process.once(name, () => {
      controller.abort();
    });
  }
  return controller.signal;
}

/** `ask-my-site dev`: runs until `io.signal` aborts (Ctrl+C by default). Returns the exit code. */
export async function dev(args: string[], io: CliIO): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      options: {
        index: { type: 'string' },
        port: { type: 'string' },
        origin: { type: 'string', multiple: true },
        model: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${DEV_USAGE}`);
    return 2;
  }
  if (values.help) {
    io.stdout(DEV_USAGE);
    return 0;
  }
  const port = Number(values.port ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    io.stderr('--port must be a port number.');
    return 2;
  }

  let server: DevServer;
  let file: string;
  try {
    file = findIndexFile(io.cwd, values.index);
    server = await startDevServer({
      file,
      port,
      ...(values.origin ? { origins: values.origin } : {}),
      ...(values.model ? { answerModel: values.model } : {}),
      env: io.env,
      log: io.stdout,
      error: io.stderr,
    });
  } catch (error) {
    if (!(error instanceof DevError)) throw error;
    io.stderr(`✗ ${error.message}`);
    return 1;
  }

  const { endpoint } = server;
  const label = relative(io.cwd, file) || file;
  const cors =
    values.origin?.length && !values.origin.includes('*') ? values.origin.join(', ') : 'any origin';
  io.stdout(
    [
      `ask-my-site dev: ${label} (${String(server.chunks)} chunks), ${server.description}`,
      '',
      `  Endpoint  ${endpoint}  (CORS: ${cors})`,
      '',
      'Point the dialog at it:',
      `  Docusaurus, Astro, Starlight  start the site with ASK_ENDPOINT=${endpoint}`,
      `                                or set endpoint: '${endpoint}' in the plugin's options`,
      `  React                         <AskDialog endpoint="${endpoint}" />`,
      `  Script embed                  data-endpoint="${endpoint}"`,
      '',
      'Ctrl+C stops it.',
    ].join('\n'),
  );

  const signal = io.signal ?? untilInterrupted();
  if (!signal.aborted) {
    await new Promise((resolveAbort) => {
      signal.addEventListener('abort', resolveAbort, { once: true });
    });
  }
  await server.close();
  return 0;
}
