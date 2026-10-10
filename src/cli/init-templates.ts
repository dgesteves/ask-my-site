// The files `ask-my-site init` writes: one ask endpoint and one MCP endpoint per host, with the
// rate limit, the daily budget and, where the endpoint is on another origin than the pages, CORS.
// Each is plain code the site owns afterwards, so it reads as if written by hand.

/** Where the endpoint runs. */
export type Host = 'vercel' | 'netlify' | 'cloudflare' | 'github-pages';

/** How a Cloudflare site is deployed: Pages (with Pages Functions) or a Worker with static assets. */
export type CloudflareMode = 'pages' | 'workers';

export interface TemplateSite {
  /** The site's name, for the model's instructions. */
  name: string;
  /** The index's path in the project, where the build writes it, such as `build/ask-index.json`. */
  indexFile: string;
  /** The index's path on the site, from its root: `/ask-index.json`. */
  indexPath: string;
  /** The site's public URL, with its base path: `https://acme.github.io/docs`. */
  url?: string;
}

export interface GeneratedFile {
  /** Relative to the project root. */
  path: string;
  content: string;
  /** What it is, for init's summary. */
  description: string;
  /**
   * An edit to a config file the site already has that only adds to it (a key, a table), so
   * init makes it without asking.
   */
  addition?: boolean;
}

/** Text as `//` comment lines of at most 100 characters. */
export function comment(text: string, pad = ''): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && pad.length + 3 + line.length + 1 + word.length > 100) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((text) => `${pad}// ${text}`).join('\n');
}

const HEADER = (what: string, ...paragraphs: string[]) =>
  [
    comment(
      `${what} Written by \`npx ask-my-site init\`: edit it as you like, and init asks before it overwrites it.`,
    ),
    ...paragraphs.map((paragraph) => comment(paragraph)),
  ].join('\n//\n');

const MODEL = 'gpt-5.4-mini';
const EMBEDDING = 'text-embedding-3-small';

/** The client IP header each host sets, replacing whatever the client sent. */
const CLIENT_IP: Record<Host, string | null> = {
  vercel: null, // X-Forwarded-For, which Vercel overwrites: the limiter's default
  netlify: 'x-nf-client-connection-ip',
  cloudflare: 'cf-connecting-ip',
  'github-pages': 'cf-connecting-ip',
};

const HOST_NAMES: Record<Host, string> = {
  vercel: 'Vercel',
  netlify: 'Netlify',
  cloudflare: 'Cloudflare',
  'github-pages': 'Cloudflare',
};

const quote = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function limiter(host: Host, limit: number): string {
  const header = CLIENT_IP[host];
  return header
    ? `memoryRateLimit({ limit: ${String(limit)}, windowMs: 60_000, trustedHeader: '${header}' })`
    : `memoryRateLimit({ limit: ${String(limit)}, windowMs: 60_000 })`;
}

function limiterComment(host: Host, what: string): string {
  const header = CLIENT_IP[host];
  return header
    ? `// ${what} per client, keyed on ${header}, the client IP ${HOST_NAMES[host]} sets.`
    : `// ${what} per client, keyed on the client IP Vercel sets in X-Forwarded-For.`;
}

/** The options both kinds of ask endpoint share, after `index`, indented by `pad`. */
function askOptions(site: TemplateSite, host: Host, pad: string, openai = 'openai'): string {
  return [
    `model: ${openai}('${MODEL}'),`,
    '// The model the plugins and the CLI embed pages with when OPENAI_API_KEY is set as the site',
    '// builds. The index records its model, and a different one here fails loudly. An index built',
    '// without a key has no vectors: it is searched by keywords, and this model is never called.',
    `embeddingModel: ${openai}.embedding('${EMBEDDING}'),`,
    `siteName: ${quote(site.name)},`,
    limiterComment(host, '10 questions a minute'),
    `rateLimit: ${limiter(host, 10)},`,
    '// A daily cap for the endpoint, counted per instance: about 500 answers. Set a spend limit',
    '// with your model provider as well; it is the only hard cap.',
    'budget: { requestsPerDay: 500, tokensPerDay: 1_500_000 },',
    '// A question asked again is answered from memory, without a model call.',
    'answerCache: true,',
  ]
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/** The options of an MCP endpoint, after `index`. */
function mcpOptions(site: TemplateSite, host: Host, pad: string): string {
  return [
    `siteName: ${quote(docsName(site.name))},`,
    limiterComment(host, '60 tool calls a minute'),
    `rateLimit: ${limiter(host, 60)},`,
  ]
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/** How the MCP tools' descriptions name the docs: "Acme Docs", or "the ask-my-site docs". */
const docsName = (name: string): string =>
  /\bdocs?\b|documentation/i.test(name) ? name : `the ${name} docs`;

const readIndex = (site: TemplateSite) =>
  `() => readFile(join(process.cwd(), ${quote(site.indexFile)}), 'utf8')`;

/** `api/ask.ts` and `api/mcp.ts`, Vercel Functions, for a static site. */
export function vercelFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  const imports = (names: string) =>
    [
      "import { readFile } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      '',
      ...(names.includes('createAskHandler') ? ["import { openai } from '@ai-sdk/openai';"] : []),
      `import { ${names} } from 'ask-my-site/server';`,
    ].join('\n');
  const files: GeneratedFile[] = [
    {
      path: 'api/ask.ts',
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Vercel Function.', `It answers from ${site.indexFile}, which the build writes and vercel.json bundles with this function. Set OPENAI_API_KEY in the project's environment variables: the build embeds the pages with it, and this function embeds questions and calls the model.`)}
${imports('createAskHandler, memoryRateLimit')}

const handler = createAskHandler({
  index: ${readIndex(site)},
${askOptions(site, 'vercel', '  ')}
});

export const POST = handler;
// CORS preflights, for a dialog on another origin (add access-control-* headers with \`headers\`).
export const OPTIONS = handler;
`,
    },
  ];
  if (mcp) {
    files.push({
      path: 'api/mcp.ts',
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Vercel Function.', `It serves ${site.indexFile} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own.`)}
${imports('createMcpHandler, memoryRateLimit')}

const handler = createMcpHandler({
  index: ${readIndex(site)},
${mcpOptions(site, 'vercel', '  ')}
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
`,
    });
  }
  return files;
}

/** `vercel.json`, with the index bundled with each function, keeping everything else. */
export function vercelConfig(
  existing: string | null,
  site: TemplateSite,
  mcp: boolean,
): { content: string } | { error: string } {
  let config: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { error: 'vercel.json is not a JSON object' };
      }
      config = parsed as Record<string, unknown>;
    } catch (error) {
      return { error: `vercel.json is not valid JSON (${(error as Error).message})` };
    }
  }
  const functions =
    typeof config.functions === 'object' && config.functions !== null
      ? { ...(config.functions as Record<string, Record<string, unknown>>) }
      : {};
  for (const file of mcp ? ['api/ask.ts', 'api/mcp.ts'] : ['api/ask.ts']) {
    const included = functions[file]?.includeFiles;
    if (included !== undefined && included !== site.indexFile) {
      return {
        error: `vercel.json already sets includeFiles for ${file} (${JSON.stringify(included)}): make it include ${site.indexFile} as well`,
      };
    }
    functions[file] = { ...functions[file], includeFiles: site.indexFile };
  }
  return { content: `${JSON.stringify({ ...config, functions }, null, 2)}\n` };
}

/** `netlify/functions/ask.mts` and `mcp.mts`, Netlify Functions, for a static site. */
export function netlifyFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  const imports = (names: string) =>
    [
      "import { readFile } from 'node:fs/promises';",
      "import { join } from 'node:path';",
      '',
      ...(names.includes('createAskHandler') ? ["import { openai } from '@ai-sdk/openai';"] : []),
      `import { ${names} } from 'ask-my-site/server';`,
    ].join('\n');
  const files: GeneratedFile[] = [
    {
      path: 'netlify/functions/ask.mts',
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Netlify Function.', `It answers from ${site.indexFile}, which the build writes and netlify.toml bundles with this function. Set OPENAI_API_KEY in the site's environment variables: the build embeds the pages with it, and this function embeds questions and calls the model.`)}
${imports('createAskHandler, memoryRateLimit')}

export default createAskHandler({
  index: ${readIndex(site)},
${askOptions(site, 'netlify', '  ')}
});

export const config = { path: '/api/ask' };
`,
    },
  ];
  if (mcp) {
    files.push({
      path: 'netlify/functions/mcp.mts',
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Netlify Function.', `It serves ${site.indexFile} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own.`)}
${imports('createMcpHandler, memoryRateLimit')}

export default createMcpHandler({
  index: ${readIndex(site)},
${mcpOptions(site, 'netlify', '  ')}
});

export const config = { path: '/api/mcp' };
`,
    });
  }
  return files;
}

/**
 * `netlify.toml`, with `included_files` for each function, appended as tables of their own. A
 * file that already configures one of the functions is not edited: the lines to add are returned
 * as `error` instead.
 */
export function netlifyConfig(
  existing: string | null,
  site: TemplateSite,
  mcp: boolean,
): { content: string } | { error: string } {
  const names = mcp ? ['ask', 'mcp'] : ['ask'];
  const tables = names
    .map((name) => `[functions.${name}]\n  included_files = [${JSON.stringify(site.indexFile)}]`)
    .join('\n\n');
  const text = existing ?? '';
  const configured = names.filter((name) =>
    new RegExp(`^\\s*\\[\\s*functions\\s*\\.\\s*"?${name}"?\\s*\\]`, 'm').test(text),
  );
  if (configured.length > 0) {
    const included = names.every((name) =>
      new RegExp(
        `\\[\\s*functions\\s*\\.\\s*"?${name}"?\\s*\\][^[]*included_files[^\\]]*${site.indexFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ).test(text),
    );
    if (included) return { content: text };
    return {
      error: `netlify.toml already configures ${configured.map((name) => `[functions.${name}]`).join(' and ')}; add included_files = [${JSON.stringify(site.indexFile)}] to ${configured.length === 1 ? 'it' : 'each'}`,
    };
  }
  const comment = '# The index the ask-my-site functions answer from, bundled with them.';
  const separator =
    text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${text}${separator}${comment}\n${tables}\n` };
}

/** The index, read from the site's own static files through the ASSETS binding. */
const assetsIndex = (site: TemplateSite, pad: string) =>
  [
    'async () => {',
    `  const response = await env.ASSETS.fetch(new Request(new URL(${quote(site.indexPath)}, request.url)));`,
    `  if (!response.ok) throw new Error(\`${site.indexPath}: HTTP \${String(response.status)}\`);`,
    '  return response.text();',
    '},',
  ]
    .map((line, i) => (i === 0 ? line : `${pad}${line}`))
    .join('\n');

/**
 * `functions/api/ask.ts` and `mcp.ts`, Cloudflare Pages Functions, for a static site on Pages.
 * They read the index through the ASSETS binding, from the same deployment's files.
 */
export function cloudflarePagesFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  const envType = (secret: boolean) =>
    [
      'interface Env {',
      ...(secret ? ['  OPENAI_API_KEY: string;'] : []),
      '  ASSETS: { fetch: (request: Request) => Promise<Response> };',
      '}',
    ].join('\n');
  const files: GeneratedFile[] = [
    {
      path: 'functions/api/ask.ts',
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Cloudflare Pages Function.', `It answers from ${site.indexPath}, which the build writes into the site's files, read through the ASSETS binding. Set OPENAI_API_KEY as a secret, for production and previews: in the dashboard (Settings, Variables and Secrets) or with \`npx wrangler pages secret put OPENAI_API_KEY\`. Set it as a build variable too: the build embeds the pages with it.`)}
import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';

${envType(true)}

let handler: ((request: Request) => Promise<Response>) | undefined;

function create(request: Request, env: Env) {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return createAskHandler({
    index: ${assetsIndex(site, '    ')}
${askOptions(site, 'cloudflare', '    ')}
  });
}

export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  handler ??= create(request, env);
  return handler(request);
};
`,
    },
  ];
  if (mcp) {
    files.push({
      path: 'functions/api/mcp.ts',
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Cloudflare Pages Function.', `It serves ${site.indexPath} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own.`)}
import { createMcpHandler, memoryRateLimit } from 'ask-my-site/server';

${envType(false)}

let handler: ((request: Request) => Promise<Response>) | undefined;

export const onRequest = ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  handler ??= createMcpHandler({
    index: ${assetsIndex(site, '    ')}
${mcpOptions(site, 'cloudflare', '    ')}
  });
  return handler(request);
};
`,
    });
  }
  return files;
}

/** The Worker module for a Cloudflare Worker with static assets: the endpoints, then the files. */
export const WORKER_MODULE = 'worker/ask-my-site.ts';

export function cloudflareWorkerFiles(site: TemplateSite, mcp: boolean): GeneratedFile[] {
  return [
    {
      path: WORKER_MODULE,
      description: `the Worker: POST /api/ask${mcp ? ' and /api/mcp' : ''}; other requests get the static files`,
      content: `${HEADER("The Worker's entry point: the ask endpoint and the MCP endpoint, then the site's files.", `It answers from ${site.indexPath}, which the build writes into the static assets, read through the ASSETS binding. Set OPENAI_API_KEY with \`npx wrangler secret put OPENAI_API_KEY\`, and in the build's environment: the build embeds the pages with it.`, `A Worker that has its own entry point already can call \`askMySite(request, env)\` from it: it answers the endpoints' paths and returns null for every other request.`)}
import { createOpenAI } from '@ai-sdk/openai';
import { createAskHandler, ${mcp ? 'createMcpHandler, ' : ''}memoryRateLimit } from 'ask-my-site/server';

interface Env {
  OPENAI_API_KEY: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

type Handler = (request: Request) => Promise<Response>;
let handlers: { ask: Handler${mcp ? '; mcp: Handler' : ''} } | undefined;

function create(request: Request, env: Env) {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  // One copy of the index for both endpoints, loaded on the first request.
  let text: Promise<string> | undefined;
  const index = () =>
    (text ??= (async () => {
      const response = await env.ASSETS.fetch(new Request(new URL(${quote(site.indexPath)}, request.url)));
      if (!response.ok) throw new Error(\`${site.indexPath}: HTTP \${String(response.status)}\`);
      return response.text();
    })().catch((error: unknown) => {
      text = undefined;
      throw error;
    }));
  return {
    ask: createAskHandler({
      index,
${askOptions(site, 'cloudflare', '      ')}
    }),${
      mcp
        ? `
    mcp: createMcpHandler({
      index,
${mcpOptions(site, 'cloudflare', '      ')}
    }),`
        : ''
    }
  };
}

/** Answers the endpoints' paths, or returns null for any other request. */
export function askMySite(request: Request, env: Env): Promise<Response> | null {
  const { pathname } = new URL(request.url);
  if (pathname !== '/api/ask'${mcp ? " && pathname !== '/api/mcp'" : ''}) return null;
  handlers ??= create(request, env);
  return ${mcp ? "pathname === '/api/ask' ? handlers.ask(request) : handlers.mcp(request)" : 'handlers.ask(request)'};
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return askMySite(request, env) ?? env.ASSETS.fetch(request);
  },
};
`,
    },
  ];
}

/** The folder of the Worker that answers for a site on GitHub Pages or another static host. */
export const STANDALONE_DIR = 'ask-my-site-worker';

/** A Worker name from the site's: lowercase letters, digits and dashes, at most 63 characters. */
export function workerName(name: string): string {
  const slug = name
    .normalize('NFKD')
    // The accents NFKD splits off.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .replace(/-+$/, '');
  return `${slug || 'docs'}-ask`;
}

/**
 * A Cloudflare Worker of its own, for a site served by GitHub Pages or any other static host: it
 * fetches the index from the live site, follows its deploys, and answers the site's pages across
 * origins (CORS for the site's origin only).
 */
export function standaloneWorkerFiles(
  site: TemplateSite & { url: string },
  mcp: boolean,
  versions: { askMySite: string; ai: string; openai: string; wrangler: string },
): GeneratedFile[] {
  const dir = STANDALONE_DIR;
  const indexUrl = new URL(site.indexPath.replace(/^\/+/, ''), `${site.url.replace(/\/+$/, '')}/`);
  return [
    {
      path: `${dir}/package.json`,
      description: 'the Worker’s dependencies and scripts',
      content: `${JSON.stringify(
        {
          name: workerName(site.name),
          private: true,
          type: 'module',
          scripts: { dev: 'wrangler dev', deploy: 'wrangler deploy' },
          dependencies: {
            '@ai-sdk/openai': versions.openai,
            ai: versions.ai,
            'ask-my-site': versions.askMySite,
          },
          devDependencies: { wrangler: versions.wrangler },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: `${dir}/wrangler.jsonc`,
      description: 'the Worker’s configuration, with the site’s URL',
      content: `// The Worker that answers questions for ${site.name}. Written by \`npx ask-my-site init\`.
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(workerName(site.name))},
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "vars": {
    // The site the Worker answers for: it reads the index at ${indexUrl.href}.
    "SITE_URL": ${JSON.stringify(site.url.replace(/\/+$/, ''))}
  }
}
`,
    },
    {
      path: `${dir}/src/index.ts`,
      description: `the Worker: POST /api/ask${mcp ? ' and /api/mcp' : ''}, from the live site’s index`,
      content: `${HEADER(`The Worker that answers questions for ${site.name}.`, `It fetches the index from the live site, SITE_URL${site.indexPath}, and checks it again every five minutes, so it follows the site's deploys. The site's pages call it across origins, so it sends CORS headers for SITE_URL's origin, and only for it.`, `Set the key with \`npx wrangler secret put OPENAI_API_KEY\`, and deploy with \`npx wrangler deploy\`.`)}
import { createOpenAI } from '@ai-sdk/openai';
import {
  createAskHandler,${mcp ? '\n  createMcpHandler,' : ''}
  memoryRateLimit,
  remoteIndex,
} from 'ask-my-site/server';

interface Env {
  SITE_URL: string;
  OPENAI_API_KEY: string;
}

type Handler = (request: Request) => Promise<Response>;
let handlers: { ask: Handler${mcp ? '; mcp: Handler' : ''} } | undefined;

function create(env: Env) {
  const site = new URL(\`\${env.SITE_URL.replace(/\\/+$/, '')}/\`);
  const index = remoteIndex(new URL(${quote(site.indexPath.replace(/^\/+/, ''))}, site));
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return {
    ask: createAskHandler({
      index,
${askOptions(site, 'github-pages', '      ')}
      // The site's pages post here from their own origin.
      headers: {
        'access-control-allow-origin': site.origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
        vary: 'origin',
      },
    }),${
      mcp
        ? `
    mcp: createMcpHandler({
      index,
${mcpOptions(site, 'github-pages', '      ')}
      // Results link to the pages on the site, not on this Worker.
      siteUrl: site.origin,
    }),`
        : ''
    }
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    handlers ??= create(env);
    const { pathname } = new URL(request.url);
    if (pathname === '/api/ask') return handlers.ask(request);${
      mcp
        ? `
    if (pathname === '/api/mcp') return handlers.mcp(request);`
        : ''
    }
    return Promise.resolve(new Response('Not found', { status: 404 }));
  },
};
`,
    },
  ];
}

/** `app/api/ask/route.ts` and `app/api/mcp/route.ts`, for a Next.js app. */
export function nextFiles(
  site: TemplateSite,
  host: Host,
  appDir: string,
  mcp: boolean,
): GeneratedFile[] {
  const depth = appDir.split('/').length + 2;
  const importPath = `${'../'.repeat(depth)}${site.indexFile}`;
  const files: GeneratedFile[] = [
    {
      path: `${appDir}/api/ask/route.ts`,
      description: 'POST /api/ask: answers questions from the index',
      content: `${HEADER('The ask endpoint, POST /api/ask, as a Next.js route handler.', `It answers from ${site.indexFile}, which \`ask-my-site index\` writes before the build, imported so it is bundled with the route. Set OPENAI_API_KEY where the app builds and runs.`)}
import { openai } from '@ai-sdk/openai';
import { createAskHandler, memoryRateLimit } from 'ask-my-site/server';

import index from '${importPath}';

const handler = createAskHandler({
  index,
${askOptions(site, host, '  ')}
});

export { handler as OPTIONS, handler as POST };
`,
    },
  ];
  if (mcp) {
    files.push({
      path: `${appDir}/api/mcp/route.ts`,
      description: '/api/mcp: the same index as an MCP server for agents, keyword-only',
      content: `${HEADER('The MCP endpoint, /api/mcp, as a Next.js route handler.', `It serves ${site.indexFile} to agents as search, fetch and list_pages tools. Search is keyword-only, so it calls no model: the agent brings its own. Importing the same file as the ask route keeps one copy of the index in memory.`)}
import { createMcpHandler, memoryRateLimit } from 'ask-my-site/server';

import index from '${importPath}';

const handler = createMcpHandler({
  index,
${mcpOptions(site, host, '  ')}
});

export { handler as DELETE, handler as GET, handler as OPTIONS, handler as POST };
`,
    });
  }
  return files;
}
