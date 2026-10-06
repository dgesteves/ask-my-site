/**
 * ask-my-site/node: file-system helpers for build scripts and the CLI. Node.js only.
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, matchesGlob, relative, sep } from 'node:path';

import type { EmbeddingModel } from 'ai';

import type { EmbeddingProviderOptions } from '../build';
import { parseIndexFile, serializeIndexFile, type AskIndexFile } from '../index-file';
import { fromHtml } from '../loaders/html';
import { fromMarkdown } from '../loaders/markdown';
import type { ChunkingOptions, SourceDocument } from '../types';

export const DEFAULT_EXTENSIONS = ['.md', '.mdx', '.markdown', '.html', '.htm'] as const;

export interface LoadDirectoryOptions {
  /** Prefix for every page URL, e.g. `/docs` or `https://example.com`. Default `/`. */
  baseUrl?: string;
  /** File extensions to read. Default Markdown, MDX and HTML. */
  extensions?: readonly string[];
  /** Glob patterns, relative to the directory, of files to skip. */
  ignore?: readonly string[];
}

/**
 * Maps a content path to a URL: extensions are dropped and `index`/`README` files stand for their
 * folder. `guides/setup.md` → `/guides/setup`, `guides/index.html` → `/guides`.
 */
export function pathToUrl(relativePath: string, baseUrl = '/'): string {
  const withoutExt = relativePath
    .split(sep)
    .join('/')
    .replace(/\.(?:mdx?|markdown|html?)$/i, '');
  const path = withoutExt.replace(/(?:^|\/)(?:index|readme)$/i, '');
  const base = baseUrl.replace(/\/+$/, '');
  if (!path) return base || '/';
  return `${base}/${path}`;
}

function titleFromPath(relativePath: string): string {
  const name = basename(relativePath, extname(relativePath));
  const base = /^(?:index|readme)$/i.test(name) ? basename(dirname(relativePath)) : name;
  const words = base.replace(/[-_]+/g, ' ').trim() || 'Home';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Reads every Markdown, MDX and HTML file under `directory` (recursively, in a stable order) and
 * returns them as documents. Dot-directories and `node_modules` are skipped, as are pages that
 * opt out (`draft: true`, `ask: false`, `noindex`).
 */
export async function loadDirectory(
  directory: string,
  options: LoadDirectoryOptions = {},
): Promise<SourceDocument[]> {
  const extensions = new Set(
    (options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
  );
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter(
      (path) => !path.split('/').some((part) => part.startsWith('.') || part === 'node_modules'),
    )
    .filter((path) => !(options.ignore ?? []).some((pattern) => matchesGlob(path, pattern)))
    .sort();

  const documents: SourceDocument[] = [];
  for (const path of files) {
    const source = await readFile(join(directory, path), 'utf8');
    const meta = {
      id: path,
      url: pathToUrl(path, options.baseUrl),
      fallbackTitle: titleFromPath(path),
    };
    const ext = extname(path).toLowerCase();
    let document: SourceDocument | null;
    try {
      document =
        ext === '.html' || ext === '.htm'
          ? fromHtml(source, meta)
          : fromMarkdown(source, { ...meta, mdx: ext === '.mdx' });
    } catch (error) {
      // Invalid frontmatter YAML, most often: say which file.
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    if (document) documents.push(document);
  }
  return documents;
}

/** Reads and validates an index file. Returns `null` if it does not exist. */
export async function readIndexFile(path: string): Promise<AskIndexFile | null> {
  let json: string;
  try {
    json = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseIndexFile(json);
}

/** Writes an index file atomically (temp file, then rename), creating directories as needed. */
export async function writeIndexFile(path: string, index: AskIndexFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, serializeIndexFile(index), 'utf8');
  await rename(temporary, path);
}

/** The default export of a `--config` module for the CLI. Every field is optional. */
export interface AskConfig {
  /** Embedding model for builds. `null` builds a keyword-only index. */
  embeddingModel?: EmbeddingModel | null;
  embeddingProviderOptions?: EmbeddingProviderOptions;
  chunking?: ChunkingOptions;
  /** URL prefix for pages loaded from the directory. */
  baseUrl?: string;
  /** Glob patterns of files to skip. */
  ignore?: string[];
  /** Documents from elsewhere (a CMS, an API), indexed alongside the directory. */
  documents?: SourceDocument[] | (() => SourceDocument[] | Promise<SourceDocument[]>);
}

/** Identity function that types a config module. */
export function defineConfig(config: AskConfig): AskConfig {
  return config;
}
