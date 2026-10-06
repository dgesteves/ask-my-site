import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../src/cli/main';
import { parseIndexFile } from '../src';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'ask-my-site-cli-'));
  await mkdir(join(cwd, 'content/guides'), { recursive: true });
  await mkdir(join(cwd, 'content/.drafts'), { recursive: true });
  await writeFile(
    join(cwd, 'content/index.md'),
    '---\ntitle: Home\n---\n\nWelcome to the docs.\n\n## Install\n\nRun the installer.\n',
  );
  await writeFile(
    join(cwd, 'content/guides/deploy.mdx'),
    "import X from 'x';\n\n# Deploying\n\nShip it to the edge.\n\n## Rollbacks\n\nRedeploy the previous build.\n",
  );
  await writeFile(
    join(cwd, 'content/guides/legacy.html'),
    '<html><body><main><h1>Legacy</h1><p>Old page.</p></main></body></html>',
  );
  await writeFile(join(cwd, 'content/guides/secret.md'), '---\nask: false\n---\nHidden.');
  await writeFile(join(cwd, 'content/.drafts/wip.md'), 'Not ready.');
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const env: Record<string, string | undefined> = {};
  const code = await main(args, {
    cwd,
    env,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), env };
}

const readIndex = async (name = 'ask-index.json') =>
  parseIndexFile(await readFile(join(cwd, name), 'utf8'));

describe('ask-my-site index', () => {
  it('builds an index from Markdown, MDX and HTML', async () => {
    const result = await run('index', 'content', '--embedding', 'mock', '--base-url', '/docs');
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/✓ \d+ chunks, \d+ embedded, 0 reused → ask-index\.json/);

    const index = await readIndex();
    expect(index.embedding).toEqual({ model: 'mock-hash-512', dimensions: 512 });
    expect(index.documents).toEqual([
      { id: 'guides/deploy.mdx', url: '/docs/guides/deploy', title: 'Deploying' },
      { id: 'guides/legacy.html', url: '/docs/guides/legacy', title: 'Legacy' },
      { id: 'index.md', url: '/docs', title: 'Home' },
    ]);
    expect(index.chunks.find((c) => c.anchor === 'rollbacks')?.text).toBe(
      'Redeploy the previous build.',
    );
  });

  it('--check passes on fresh output and fails, listing changes, when content moves on', async () => {
    expect((await run('index', 'content', '-e', 'mock', '-o', 'out/index.json')).code).toBe(0);

    const fresh = await run('index', 'content', '-e', 'mock', '-o', 'out/index.json', '--check');
    expect(fresh.code).toBe(0);
    expect(fresh.stdout).toMatch(/✓ out\/index\.json is up to date \(\d+ chunks\)/);

    await writeFile(
      join(cwd, 'content/guides/deploy.mdx'),
      '# Deploying\n\nShip it to the edge, then verify.\n\n## Rollbacks\n\nRedeploy the previous build.\n',
    );
    await writeFile(join(cwd, 'content/faq.md'), '# FAQ\n\nAnswers.');
    const stale = await run('index', 'content', '-e', 'mock', '-o', 'out/index.json', '--check');
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain('✗ out/index.json is stale.');
    expect(stale.stderr).toContain('Content changed: 1 added, 1 changed, 0 removed chunks.');
    expect(stale.stderr).toContain('added: faq.md#0');
    expect(stale.stderr).toContain('changed: guides/deploy.mdx#0');
  });

  it('--check never needs a key or a model call to detect a model change', async () => {
    await run('index', 'content', '-e', 'mock');
    const result = await run('index', 'content', '-e', 'openai:text-embedding-3-small', '--check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Index was embedded with "mock-hash-512", expected "text-embedding-3-small".',
    );
    // Without --embedding, a check only compares content.
    expect((await run('index', 'content', '--check')).code).toBe(0);
  });

  it('--check fails when the index is missing', async () => {
    const result = await run('index', 'content', '--check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ask-index.json does not exist');
  });

  it('re-embeds only what changed on rebuild', async () => {
    await run('index', 'content', '-e', 'mock');
    const total = (await readIndex()).chunks.length;
    await writeFile(
      join(cwd, 'content/guides/legacy.html'),
      '<main><h1>Legacy</h1><p>Updated.</p></main>',
    );
    const result = await run('index', 'content', '-e', 'mock');
    expect(result.stdout).toContain(`, 1 embedded, ${String(total - 1)} reused`);
  });

  it('builds a keyword-only index with --embedding none', async () => {
    expect((await run('index', 'content', '-e', 'none', '--chunk-size', '400')).code).toBe(0);
    const index = await readIndex();
    expect(index.embedding).toBeNull();
    expect(index.chunking).toEqual({ maxChars: 400, overlap: 150 });
    expect(index.chunks.every((c) => c.vector === undefined)).toBe(true);
  });

  it('honours --ignore and a config module with extra documents', async () => {
    await writeFile(
      join(cwd, 'ask.config.mjs'),
      `export default {
        embeddingModel: null,
        documents: async () => [{ id: 'cms/pricing', url: '/pricing', title: 'Pricing', content: 'Free.' }],
      };`,
    );
    const result = await run('index', 'content', '-c', 'ask.config.mjs', '--ignore', 'guides/**');
    expect(result.code).toBe(0);
    expect((await readIndex()).documents.map((d) => d.id)).toEqual(['cms/pricing', 'index.md']);
  });

  it('loads .env files without overriding the environment', async () => {
    await writeFile(join(cwd, '.env.local'), 'AI_GATEWAY_API_KEY=from-file\n');
    const result = await run('index', 'content', '-e', 'none');
    expect(result.env.AI_GATEWAY_API_KEY).toBe('from-file');
  });

  it.each([
    [['index', 'content'], 'No embedding model. Set OPENAI_API_KEY'],
    [['index', 'content', '-e', 'openai:text-embedding-3-small'], 'needs OPENAI_API_KEY'],
    [['index', 'content', '-e', 'bogus'], 'Unknown --embedding "bogus"'],
    [['index', 'content', '--chunk-size', 'big'], '--chunk-size must be a non-negative integer'],
    [['index', 'missing', '-e', 'none'], 'Not a directory: missing'],
    [['index', '-e', 'none'], 'Missing <dir>'],
    [['serve'], 'Unknown command "serve"'],
    [['index', 'content', '--nope'], "Unknown option '--nope'"],
  ])('exits 2 on usage errors: %j', async (args, message) => {
    const result = await run(...args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it('prints help and version', async () => {
    expect((await run('--help')).stdout).toContain('Usage: ask-my-site index [dir] [options]');
    expect((await run('--version')).stdout).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await run()).code).toBe(2);
  });
});
