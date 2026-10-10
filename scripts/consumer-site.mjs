// Creates a fresh site the way a new user would, with each framework's own scaffolder, installs
// ask-my-site into it from a packed tarball, builds it with embeddings from OpenAI, and checks the
// index came out embedded. OPENAI_BASE_URL points at a local stub (./openai-stub.mjs), the only
// thing the index build calls; the API key is fake, so a request to the real API would fail.
//
//   npm pack && node scripts/consumer-site.mjs <next|docusaurus|starlight> ask-my-site-x.y.z.tgz [dir]
//
// The workspace examples link the package from source, so they cannot catch what only an
// installed package meets: how Docusaurus loads plugins, the published files, peer resolution.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { startOpenAIStub } from './openai-stub.mjs';

const MODEL = 'text-embedding-3-small';
const PEERS = ['ai', '@ai-sdk/openai', '@radix-ui/react-dialog', 'cmdk'];

/**
 * Per site: how to create it, what to add, what to install and run, where the index lands and
 * the vector size it must have. Scaffolders are pinned to a major version, so a new major is a
 * deliberate upgrade here rather than a surprise in an unrelated pull request.
 *
 * @type {Record<string, {
 *   create: (dir: string) => [string, string[], string?],
 *   configure: (dir: string) => void,
 *   install: string[],
 *   build: string[][],
 *   index: string,
 *   llms: string,
 *   dimensions: number,
 * }>}
 */
const SITES = {
  // The CLI indexes the content; the build compiles a route handler and the dialog against the
  // installed package.
  next: {
    create: (dir) => [
      'npx',
      [
        '-y',
        'create-next-app@16',
        dir,
        '--ts',
        '--app',
        '--eslint',
        '--no-tailwind',
        '--no-src-dir',
        '--import-alias',
        '@/*',
        '--use-npm',
        '--skip-install',
        '--disable-git',
        '--yes',
      ],
    ],
    configure: (dir) => {
      cpSync(new URL('../examples/nextjs/content/docs', import.meta.url), join(dir, 'content'), {
        recursive: true,
      });
      write(
        dir,
        'app/api/ask/route.ts',
        `import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler } from 'ask-my-site/server';

import index from '../../../ask-index.json';

const openai = createOpenAI();

export const POST = createAskHandler({
  index,
  model: openai('gpt-5.4-mini'),
  embeddingModel: openai.embedding('${MODEL}'),
  embeddingProviderOptions: { openai: { dimensions: 512 } },
});
`,
      );
      write(
        dir,
        'app/ask.tsx',
        `'use client';
import { AskDialog } from 'ask-my-site/react';

export function Ask() {
  return <AskDialog suggestions={['How do I install it?']} />;
}
`,
      );
      edit(dir, 'app/layout.tsx', (layout) =>
        layout
          .replace(
            'import "./globals.css";',
            'import "./globals.css";\nimport "ask-my-site/react/styles.css";\nimport { Ask } from "./ask";',
          )
          .replace('{children}', '{children}<Ask />'),
      );
    },
    install: PEERS,
    build: [
      [
        'npx',
        'ask-my-site',
        'index',
        'content',
        '--base-url',
        '/docs',
        '-e',
        `openai:${MODEL}`,
        '--dimensions',
        '512',
        '--llms-txt',
        'public',
      ],
      ['npx', 'next', 'build'],
    ],
    index: 'ask-index.json',
    llms: 'public',
    dimensions: 512,
  },
  // The plugin with no options: the default model, from OPENAI_API_KEY, loaded under jiti.
  docusaurus: {
    create: (dir) => [
      'npx',
      ['-y', 'create-docusaurus@3', basename(dir), 'classic', '--typescript', '--skip-install'],
      dirname(dir),
    ],
    configure: (dir) => {
      edit(dir, 'docusaurus.config.ts', (config) =>
        config.replace(
          '  presets: [',
          "  plugins: [['ask-my-site/docusaurus', {}]],\n\n  presets: [",
        ),
      );
    },
    install: PEERS,
    build: [['npx', 'docusaurus', 'build']],
    index: 'build/ask-index.json',
    llms: 'build',
    // The plugin's default model, at its default size.
    dimensions: 512,
  },
  // The plugin with the model named as a string, as the CLI's --embedding names it.
  starlight: {
    create: (dir) => [
      'npx',
      ['-y', 'create-astro@4', dir, '--template', 'starlight', '--no-install', '--no-git', '--yes'],
    ],
    configure: (dir) => {
      edit(dir, 'astro.config.mjs', (config) =>
        config
          .replace(
            "import starlight from '@astrojs/starlight';",
            "import starlight from '@astrojs/starlight';\nimport askMySite from 'ask-my-site/starlight';",
          )
          .replace(
            'starlight({',
            `starlight({\n\t\t\tplugins: [askMySite({ embedding: 'openai:${MODEL}', dimensions: 512 })],`,
          ),
      );
    },
    install: [...PEERS, 'react', 'react-dom'],
    build: [['npx', 'astro', 'build']],
    index: 'dist/ask-index.json',
    llms: 'dist',
    dimensions: 512,
  },
};

function write(dir, file, content) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

/** Rewrites a scaffolded file, failing if the change did not apply (the template moved on). */
function edit(dir, file, change) {
  const before = readFileSync(join(dir, file), 'utf8');
  const after = change(before);
  if (after === before || !after.includes('ask-my-site')) {
    throw new Error(`Could not add ask-my-site to ${file}; did the template change?`);
  }
  writeFileSync(join(dir, file), after);
}

/** Runs a command, inheriting stdio; asynchronously, so the stub in this process can answer it. */
async function run(command, args, { cwd, env } = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(code)}`);
}

const [name = '', tarball = '', target] = process.argv.slice(2);
const site = SITES[name];
if (!site || !tarball) {
  console.error(
    `Usage: node scripts/consumer-site.mjs <${Object.keys(SITES).join('|')}> <tarball> [dir]`,
  );
  process.exit(2);
}
const dir = resolve(target ?? join(tmpdir(), `ask-my-site-consumer-${name}`));
rmSync(dir, { recursive: true, force: true });

const [command, args, cwd] = site.create(dir);
await run(command, args, { cwd: cwd ?? dirname(dir) });
site.configure(dir);
await run('npm', ['install', '--no-audit', '--no-fund', resolve(tarball), ...site.install], {
  cwd: dir,
});

const stub = await startOpenAIStub();
try {
  const env = {
    OPENAI_API_KEY: 'sk-consumer-check',
    OPENAI_BASE_URL: stub.url,
    AI_GATEWAY_API_KEY: '',
    NEXT_TELEMETRY_DISABLED: '1',
    ASTRO_TELEMETRY_DISABLED: '1',
  };
  for (const [step, ...rest] of site.build) await run(step, rest, { cwd: dir, env });
} finally {
  await stub.close();
}

const file = join(dir, site.index);
if (!existsSync(file)) throw new Error(`The build wrote no ${site.index}.`);
const index = JSON.parse(readFileSync(file, 'utf8'));
const problems = [];
const { model, dimensions } = index.embedding ?? {};
if (model !== MODEL || dimensions !== site.dimensions) {
  problems.push(
    `embedding is ${JSON.stringify(index.embedding)}, expected ${MODEL} at ${String(site.dimensions)} dimensions`,
  );
}
if (!index.chunks?.length || !index.chunks.every((chunk) => typeof chunk.vector === 'string')) {
  problems.push('some chunks have no vector');
}
// llms.txt, llms-full.txt and a .md copy of each indexed page, linked from llms.txt.
const llmsDir = join(dir, site.llms);
for (const file of ['llms.txt', 'llms-full.txt']) {
  if (!existsSync(join(llmsDir, file))) problems.push(`the build wrote no ${site.llms}/${file}`);
}
const llmsTxt = existsSync(join(llmsDir, 'llms.txt'))
  ? readFileSync(join(llmsDir, 'llms.txt'), 'utf8')
  : '';
const links = [...llmsTxt.matchAll(/^- \[[^\]]*\]\(([^)]+\.md)\)/gm)].map((match) => match[1]);
if (links.length !== index.documents.length) {
  problems.push(
    `llms.txt links ${String(links.length)} .md pages, the index has ${String(index.documents.length)}`,
  );
}
for (const link of links) {
  const file = join(llmsDir, decodeURI(new URL(link, 'http://site').pathname).replace(/^\//, ''));
  if (!existsSync(file)) problems.push(`llms.txt links ${link}, which is not in ${site.llms}`);
}
const strays = stub.requests.filter((request) => request !== 'POST /v1/embeddings');
if (stub.requests.length === 0) problems.push('the stub received no embedding request');
if (strays.length > 0) problems.push(`the stub received ${strays.join(', ')}`);
if (problems.length > 0) {
  console.error(`\n✗ ${name}: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(
  `\n✓ ${name}: ${site.index} has ${String(index.documents.length)} pages and ${String(index.chunks.length)} chunks embedded with ${MODEL} at ${String(site.dimensions)} dimensions, from ${String(stub.requests.length)} requests to the stub; ${site.llms}/llms.txt links a .md copy of each.`,
);
