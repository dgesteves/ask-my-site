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
      // A server without clean URLs serves the file by its name.
      { id: 'guides/legacy.html', url: '/docs/guides/legacy.html', title: 'Legacy' },
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

  it('--check compares --dimensions even without --embedding', async () => {
    expect((await run('index', 'content', '-e', 'mock')).code).toBe(0);
    const mismatch = await run('index', 'content', '--check', '--dimensions', '256');
    expect(mismatch.code).toBe(1);
    expect(mismatch.stderr).toContain('Index vectors have 512 dimensions, expected 256.');
    expect((await run('index', 'content', '--check', '--dimensions', '512')).code).toBe(0);

    // The same with the model taken from a config module.
    await writeFile(
      join(cwd, 'ask.config.mjs'),
      `import { mockEmbeddingModel } from ${JSON.stringify(new URL('../src/mock/index.ts', import.meta.url).href)};
      export default { embeddingModel: mockEmbeddingModel() };`,
    );
    const viaConfig = await run(
      'index',
      'content',
      '-c',
      'ask.config.mjs',
      '--check',
      '--dimensions',
      '256',
    );
    expect(viaConfig.code).toBe(1);
    expect(viaConfig.stderr).toContain('expected 256');
  });

  it('detects the docs framework, says so, and takes --framework', async () => {
    await writeFile(join(cwd, 'docusaurus.config.ts'), 'export default {}');
    await writeFile(
      join(cwd, 'content/guides/01-setup.md'),
      '---\nslug: /start\n---\n# Setup\n\nGo.',
    );
    const detected = await run('index', 'content', '-e', 'none', '--base-url', '/docs');
    expect(detected.code).toBe(0);
    expect(detected.stdout).toContain(
      'Reading content with Docusaurus URLs (--framework none to turn off)',
    );

    expect((await readIndex()).documents.find((d) => d.id === 'guides/01-setup.md')?.url).toBe(
      '/docs/start',
    );
    expect(detected.stdout).not.toContain('pass --base-url /docs');
    expect((await run('index', 'content', '-e', 'none')).stdout).toContain(
      'Docusaurus serves docs under /docs unless routeBasePath says otherwise: pass --base-url /docs',
    );

    expect(
      (await run('index', 'content', '-e', 'none', '--framework', 'none')).stdout,
    ).not.toContain('Reading content with');
    expect((await readIndex()).documents.find((d) => d.id === 'guides/01-setup.md')?.url).toBe(
      '/guides/01-setup',
    );

    const bad = await run('index', 'content', '-e', 'none', '--framework', 'hugo');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain(
      '--framework must be one of auto, docusaurus, starlight, next, none.',
    );

    // A config module's framework is checked too.
    await writeFile(join(cwd, 'ask.config.mjs'), "export default { framework: 'hugo' };");
    const badConfig = await run('index', 'content', '-e', 'none', '-c', 'ask.config.mjs');
    expect(badConfig.code).toBe(2);
    expect(badConfig.stderr).toContain('framework must be one of');
  });

  it('refuses --dimensions it could not apply to a build', async () => {
    await writeFile(join(cwd, 'ask.config.mjs'), 'export default { embeddingModel: null };');
    for (const args of [
      ['-c', 'ask.config.mjs', '--dimensions', '256'],
      ['-e', 'none', '--dimensions', '256'],
    ]) {
      const result = await run('index', 'content', ...args);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('--dimensions');
    }
  });

  it('--check defaults to the chunking the index was built with', async () => {
    expect(
      (await run('index', 'content', '-e', 'none', '--chunk-size', '400', '--chunk-overlap', '50'))
        .code,
    ).toBe(0);
    expect((await run('index', 'content', '--check')).code).toBe(0);
    // Passing different options explicitly is still a failure.
    expect((await run('index', 'content', '--check', '--chunk-size', '1200')).code).toBe(1);
  });

  it('names the file when its frontmatter is invalid', async () => {
    await writeFile(join(cwd, 'content/broken.md'), '---\ntitle: "unterminated\n---\nBody');
    const result = await run('index', 'content', '-e', 'none');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('broken.md:');
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

  it('drops .html from URLs with --clean-urls', async () => {
    expect((await run('index', 'content', '-e', 'none', '--clean-urls')).code).toBe(0);
    expect((await readIndex()).documents.find((d) => d.id === 'guides/legacy.html')?.url).toBe(
      '/guides/legacy',
    );
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
    [['index', 'content'], 'To try it without a key, use --embedding mock'],
    [['index', 'content', '-e', 'openai:text-embedding-3-small'], 'needs OPENAI_API_KEY'],
    [['index', 'content', '-e', 'bogus'], 'Unknown --embedding bogus. Use openai:<model>'],
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
