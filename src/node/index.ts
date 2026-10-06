/**
 * ask-my-site/node: file-system helpers for build scripts and the CLI. Node.js only.
 */

import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, sep } from 'node:path';

import type { EmbeddingModel } from 'ai';

import type { EmbeddingProviderOptions } from '../build';
import { parseIndexFile, serializeIndexFile, type AskIndexFile } from '../index-file';
import { fromHtml } from '../loaders/html';
import { fromMarkdown } from '../loaders/markdown';
import type { ChunkingOptions, SourceDocument } from '../types';
import { matchesGlob } from './glob';

export const DEFAULT_EXTENSIONS = ['.md', '.mdx', '.markdown', '.html', '.htm'] as const;

export interface LoadDirectoryOptions {
  /** Prefix for every page URL, e.g. `/docs` or `https://example.com`. Default `/`. */
  baseUrl?: string;
  /** File extensions to read. Default Markdown, MDX and HTML. */
  extensions?: readonly string[];
  /**
   * Glob patterns, relative to the directory, of files to skip: `*`, `**`, `?`, `[...]` and
   * `{a,b}`, matched case-sensitively.
   */
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
 * The files under `directory` with one of `extensions`, as `/`-separated paths relative to it:
 * `file` as named on disk, `path` in NFC. Symlinks are followed, except one that leads back into
 * a directory being walked (a cycle); broken links, dot-entries and `node_modules` are skipped.
 */
async function listFiles(
  directory: string,
  extensions: ReadonlySet<string>,
): Promise<{ file: string; path: string }[]> {
  const files: { file: string; path: string }[] = [];
  const walk = async (relativeDir: string, ancestors: ReadonlySet<string>): Promise<void> => {
    const absolute = join(directory, relativeDir);
    const real = await realpath(absolute);
    if (ancestors.has(real)) return;
    const within = new Set(ancestors).add(real);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const file = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        const target = await stat(join(directory, file)).catch(() => null);
        isDirectory = target?.isDirectory() ?? false;
        isFile = target?.isFile() ?? false;
      }
      if (isDirectory) await walk(file, within);
      else if (isFile && extensions.has(extname(entry.name).toLowerCase())) {
        // macOS can hand back decomposed names (`e` + U+0301) where Linux has composed ones (`é`).
        // Ids and URLs use NFC, so an index checks out the same everywhere.
        files.push({ file, path: file.normalize('NFC') });
      }
    }
  };
  await walk('', new Set());
  return files;
}

/**
 * Reads every Markdown, MDX and HTML file under `directory` (recursively, in a stable order) and
 * returns them as documents. Dot-directories and `node_modules` are skipped, as are pages that
 * opt out (`draft: true`, `ask: false`, `noindex`). Symlinked files and directories are followed;
 * a link back into a directory that is already being read is skipped. Ids and URLs are the
 * relative path in Unicode NFC.
 */
export async function loadDirectory(
  directory: string,
  options: LoadDirectoryOptions = {},
): Promise<SourceDocument[]> {
  const extensions = new Set(
    (options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
  );
  const ignore = options.ignore ?? [];
  const files = (await listFiles(directory, extensions))
    .filter(({ path }) => !ignore.some((pattern) => matchesGlob(path, pattern)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const documents: SourceDocument[] = [];
  for (const { file, path } of files) {
    const source = await readFile(join(directory, file), 'utf8');
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
