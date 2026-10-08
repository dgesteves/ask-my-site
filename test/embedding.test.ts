import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startOpenAIStub } from '../scripts/openai-stub.mjs';

import { main } from '../src/cli/main';
import askMySite from '../src/docusaurus';
import { parseIndexFile } from '../src/index-file';
import { embeddingFromSpec, EmbeddingSpecError } from '../src/node/embedding';
import { importOptional } from '../src/node/optional';

const execFileAsync = promisify(execFile);

// The real loader unless a test says otherwise, so a test can make @ai-sdk/openai missing or
// broken without uninstalling it.
vi.mock('../src/node/optional', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/node/optional')>();
  return { importOptional: vi.fn(actual.importOptional) };
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ask-my-site-embedding-'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  vi.stubEnv('OPENAI_BASE_URL', undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

async function write(files: Record<string, string>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

/** Answers OpenAI's and AI Gateway's embedding requests with fixed vectors, and records them. */
function stubEmbeddings(dimensions = 4) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = JSON.parse(init?.body as string) as { input?: string[]; values?: string[] };
      requests.push({ url, body });
      const vectors = (body.input ?? body.values ?? []).map((_, i) =>
        Array.from({ length: dimensions }, (_, j) => (j === 0 ? 1 : i)),
      );
      return Promise.resolve(
        Response.json(
          url.includes('/v1/embeddings')
            ? { data: vectors.map((embedding) => ({ embedding })) }
            : { embeddings: vectors },
        ),
      );
    }),
  );
  return requests;
}

/** One built Docusaurus page, as `postBuild` sees it. */
async function site() {
  await write({
    'build/intro/index.html': `<!doctype html><html class="docs-wrapper docs-doc-page docs-doc-id-intro"><head><title>Intro | Acme</title></head><body><main><article><div class="theme-doc-markdown markdown"><header><h1>Intro</h1></header><p>Install the package, then ask it questions.</p></div></article></main></body></html>`,
  });
  return {
    outDir: join(root, 'build'),
    routesPaths: ['/intro'],
    context: {
      siteDir: root,
      siteConfig: { title: 'Acme' },
      baseUrl: '/',
      i18n: { currentLocale: 'en' },
    },
  };
}

const readIndex = async () =>
  parseIndexFile(await readFile(join(root, 'build', 'ask-index.json'), 'utf8'));

describe('importOptional', () => {
  const from = () => pathToFileURL(join(root, 'index.js'));
  const pkg = (name: string, source: string) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      type: 'module',
      main: 'index.js',
    }),
    [`node_modules/${name}/index.js`]: source,
  });

  it('loads an ES module package, and returns null for one that is not installed', async () => {
    await write({
      ...pkg('esm-provider', 'export const ok = true;'),
      // Top-level await, which `require` cannot load.
      ...pkg('async-provider', 'await Promise.resolve();\nexport const ok = true;'),
    });
    expect(await importOptional('esm-provider', from())).toMatchObject({ ok: true });
    expect(await importOptional('async-provider', from())).toMatchObject({ ok: true });
    expect(await importOptional('not-installed', from())).toBeNull();
  });

  it('throws the real error for a package that is installed but fails to load', async () => {
    await write({
      ...pkg('broken-provider', "throw new TypeError('Cannot read properties of undefined');"),
      ...pkg('half-installed', "import 'its-missing-dependency';\nexport const ok = true;"),
    });
    await expect(importOptional('broken-provider', from())).rejects.toThrow(
      'Cannot read properties of undefined',
    );
    // A dependency of the package is missing, not the package.
    await expect(importOptional('half-installed', from())).rejects.toMatchObject({
      code: 'ERR_MODULE_NOT_FOUND',
      message: expect.stringContaining("'its-missing-dependency'") as string,
    });
  });
});

describe('the Docusaurus plugin under jiti', () => {
  it('embeds with @ai-sdk/openai when loaded the way Docusaurus 3 loads plugins', async () => {
    // @docusaurus/utils' loadFreshModule: jiti 1.21 rewrites `import()` and transpiles what it
    // loads, which broke @ai-sdk/openai's `import { z } from 'zod/v4'`. In a process of its own,
    // as in `docusaurus build`: Vitest resolves the `development` condition, which gives the AI
    // SDK's TypeScript sources instead of the dist that sites install.
    const script = `
      const [plugin, built] = process.argv.slice(1);
      const { outDir, routesPaths, context } = JSON.parse(built);
      const load = require('jiti')(plugin, { cache: false, requireCache: false, interopDefault: true });
      const askMySite = load(plugin);
      (askMySite.default ?? askMySite)(context, {})
        .postBuild({ outDir, routesPaths })
        .catch((error) => { console.error(String(error.stack)); process.exitCode = 1; });`;
    const stub = await startOpenAIStub();
    try {
      const s = await site();
      const { NODE_OPTIONS: _, ...env } = process.env;
      await execFileAsync(
        process.execPath,
        ['-e', script, join(import.meta.dirname, '../src/docusaurus/index.ts'), JSON.stringify(s)],
        {
          cwd: join(import.meta.dirname, '..'),
          env: { ...env, OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: stub.url },
        },
      );
    } finally {
      await stub.close();
    }
    expect(stub.requests).toEqual(['POST /v1/embeddings']);
    expect((await readIndex()).embedding).toEqual({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
  }, 60_000);
});

describe('embedding specs', () => {
  it('names a model, with the provider options its dimensions need', async () => {
    const env = { OPENAI_API_KEY: 'sk-test' };
    expect(await embeddingFromSpec('none')).toEqual({ model: null });
    expect((await embeddingFromSpec('mock:64')).model).toMatchObject({ modelId: 'mock-hash-64' });
    expect(await embeddingFromSpec('cohere/embed-v4.0', { dimensions: 256 })).toEqual({
      model: 'cohere/embed-v4.0',
      providerOptions: { cohere: { dimensions: 256 } },
      dimensions: 256,
    });
    expect(
      await embeddingFromSpec('openai:text-embedding-3-small', { env, dimensions: 512 }),
    ).toMatchObject({
      model: { modelId: 'text-embedding-3-small' },
      providerOptions: { openai: { dimensions: 512 } },
    });
    await expect(embeddingFromSpec('openai:text-embedding-3-small', { env: {} })).rejects.toThrow(
      'embedding "openai:text-embedding-3-small" needs OPENAI_API_KEY.',
    );
    await expect(embeddingFromSpec('bogus')).rejects.toBeInstanceOf(EmbeddingSpecError);
  });

  it('says @ai-sdk/openai is not installed only when it is not', async () => {
    const env = { OPENAI_API_KEY: 'sk-test' };
    vi.mocked(importOptional).mockResolvedValueOnce(null);
    await expect(embeddingFromSpec('openai:x', { env })).rejects.toThrow(
      'embedding "openai:x" needs @ai-sdk/openai, which is not installed: npm i @ai-sdk/openai',
    );

    vi.mocked(importOptional).mockRejectedValueOnce(new TypeError("reading 'object'"));
    const failure = embeddingFromSpec('openai:x', { env });
    await expect(failure).rejects.toThrow(
      `embedding "openai:x" could not load @ai-sdk/openai: TypeError: reading 'object'`,
    );
    await expect(failure).rejects.not.toBeInstanceOf(EmbeddingSpecError);
  });
});

describe('the plugins’ embedding options', () => {
  it('take a spec and dimensions, so the config imports no provider', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const requests = stubEmbeddings(8);
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const s = await site();
    await askMySite(s.context, {
      embedding: 'openai:text-embedding-3-large',
      dimensions: 8,
      embeddingProviderOptions: { openai: { user: 'docs-build' } },
    }).postBuild(s);
    expect(requests.at(-1)?.body).toMatchObject({
      model: 'text-embedding-3-large',
      dimensions: 8,
      user: 'docs-build',
    });
    expect((await readIndex()).embedding).toMatchObject({
      model: 'text-embedding-3-large',
      dimensions: 8,
    });

    await askMySite(s.context, { embedding: 'mock:32' }).postBuild(s);
    expect((await readIndex()).embedding).toEqual({ model: 'mock-hash-32', dimensions: 32 });
    // An explicit keyword-only index, with the key set and no warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await askMySite(s.context, { embedding: 'none' }).postBuild(s);
    expect((await readIndex()).embedding).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reject contradictory or unknown options when the plugin is created', async () => {
    const { context } = await site();
    expect(() => askMySite(context, { embedding: 'mock', embeddingModel: null })).toThrow(
      'pass `embedding` or `embeddingModel`, not both',
    );
    expect(() => askMySite(context, { embeddingModel: null, dimensions: 512 })).toThrow(
      '`dimensions` applies to `embedding` or the default model',
    );
    expect(() =>
      askMySite(context, { embedding: 'openai-text-embedding-3-small' as 'none' }),
    ).toThrow("Unknown embedding: 'openai-text-embedding-3-small'. Use openai:<model>");
  });

  it('fail the build, with the real error, when OPENAI_API_KEY is set but the provider cannot load', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const s = await site();

    vi.mocked(importOptional).mockResolvedValueOnce(null);
    await expect(askMySite(s.context, {}).postBuild(s)).rejects.toThrow(
      'ask-my-site: OPENAI_API_KEY is set, so the default embedding, openai:text-embedding-3-small, ' +
        "needs @ai-sdk/openai, which is not installed: npm i @ai-sdk/openai. Or set `embedding: 'none'`",
    );

    vi.mocked(importOptional).mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'object')"),
    );
    await expect(askMySite(s.context, {}).postBuild(s)).rejects.toThrow(
      "could not load @ai-sdk/openai: TypeError: Cannot read properties of undefined (reading 'object')",
    );
  });

  it('embed through AI Gateway when both keys are set but @ai-sdk/openai is not installed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const requests = stubEmbeddings();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway-test');
    vi.mocked(importOptional).mockResolvedValueOnce(null);
    const s = await site();
    await askMySite(s.context, {}).postBuild(s);
    expect(warn.mock.calls[0]?.[0]).toContain('Embedding through AI Gateway instead.');
    expect(requests.at(-1)?.url).toMatch(/\/embedding-model$/);
  });
});

describe('ask-my-site index --embedding openai:…', () => {
  it('exits 1 with the real error when @ai-sdk/openai fails to load', async () => {
    await write({ 'content/index.md': '# Home\n\nWelcome.\n' });
    const stderr: string[] = [];
    vi.mocked(importOptional).mockRejectedValueOnce(new TypeError("reading 'object'"));
    const code = await main(['index', 'content', '-e', 'openai:text-embedding-3-small'], {
      cwd: root,
      env: { OPENAI_API_KEY: 'sk-test' },
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    });
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain(
      "--embedding openai:text-embedding-3-small could not load @ai-sdk/openai: TypeError: reading 'object'",
    );
  });
});
