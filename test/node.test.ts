import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDirectory } from '../src/node';
import { matchesGlob } from '../src/node/glob';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ask-my-site-node-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ids = async (directory: string, options?: Parameters<typeof loadDirectory>[1]) =>
  (await loadDirectory(directory, options)).map((document) => [document.id, document.url]);

describe('loadDirectory', () => {
  it('normalizes file names to NFC, so ids and URLs match on every file system', async () => {
    const content = join(root, 'content');
    await mkdir(content);
    // macOS keeps names as created; a file written in decomposed form stays that way.
    await writeFile(join(content, 'café.md'), '# Café\n\nCoffee.');
    expect((await readdir(content))[0]).toBe('café.md');

    const [document] = await loadDirectory(content);
    expect(document?.id).toBe('café.md');
    expect(document?.url).toBe('/café');
    expect(document?.content).toContain('Coffee.');
    // Ignore patterns are written in the same normal form.
    expect(await ids(content, { ignore: ['café.md'] })).toEqual([]);
  });

  it('follows symlinked files and directories, skipping links that loop', async () => {
    const content = join(root, 'content');
    const shared = join(root, 'shared');
    await mkdir(content);
    await mkdir(join(shared, 'dir'), { recursive: true });
    await writeFile(join(content, 'real.md'), 'Real.');
    await writeFile(join(shared, 's.md'), 'Shared file.');
    await writeFile(join(shared, 'dir', 'i.md'), 'Shared directory.');
    await symlink('../shared/s.md', join(content, 'linked.md'));
    await symlink('../shared/dir', join(content, 'linkeddir'));
    // Cycles: a directory linking to itself, and one linking back up to the root.
    await symlink('.', join(shared, 'dir', 'self'));
    await symlink(content, join(shared, 'dir', 'up'));
    await symlink('missing.md', join(content, 'broken.md'));

    expect(await ids(content)).toEqual([
      ['linked.md', '/linked'],
      ['linkeddir/i.md', '/linkeddir/i'],
      ['real.md', '/real'],
    ]);
  });

  it('skips dot-directories and node_modules, and reads files in a stable order', async () => {
    const content = join(root, 'content');
    await mkdir(join(content, '.vitepress'), { recursive: true });
    await mkdir(join(content, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(content, 'b'), { recursive: true });
    await writeFile(join(content, '.vitepress', 'x.md'), 'Hidden.');
    await writeFile(join(content, 'node_modules', 'pkg', 'README.md'), 'Dependency.');
    await writeFile(join(content, '.draft.md'), 'Hidden.');
    await writeFile(join(content, 'b', 'index.md'), 'B.');
    await writeFile(join(content, 'a.md'), 'A.');
    expect(await ids(content)).toEqual([
      ['a.md', '/a'],
      ['b/index.md', '/b'],
    ]);
  });

  it('matches --ignore globs without node:path matchesGlob, which is experimental on Node 22', async () => {
    const spy = vi.spyOn(process, 'emitWarning');
    const content = join(root, 'content');
    await mkdir(join(content, 'guides', 'old'), { recursive: true });
    await writeFile(join(content, 'index.md'), 'Home.');
    await writeFile(join(content, 'guides', 'setup.md'), 'Setup.');
    await writeFile(join(content, 'guides', 'old', 'v1.mdx'), 'Old.');
    expect(await ids(content, { ignore: ['guides/**'] })).toEqual([['index.md', '/']]);
    expect(await ids(content, { ignore: ['**/old/**', '*.md'] })).toEqual([
      ['guides/setup.md', '/guides/setup'],
    ]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('matchesGlob', () => {
  it.each([
    ['*.md', 'a.md', true],
    ['*.md', 'guides/a.md', false],
    ['**/*.md', 'a.md', true],
    ['**/*.md', 'guides/deep/a.md', true],
    ['guides/**', 'guides/a.md', true],
    ['guides/**', 'guides/x/y.md', true],
    ['guides/**', 'guidesx/a.md', false],
    ['**/drafts/**', 'a/drafts/b/c.md', true],
    ['**/drafts/**', 'drafts/c.md', true],
    ['a/**/b.md', 'a/b.md', true],
    ['a/**/b.md', 'a/x/y/b.md', true],
    ['a/**/b.md', 'ab.md', false],
    ['?.md', 'a.md', true],
    ['?.md', 'ab.md', false],
    ['[ab].md', 'b.md', true],
    ['[!ab].md', 'b.md', false],
    ['[^ab].md', 'c.md', true],
    ['[a-c]*.md', 'cat.md', true],
    ['[]a].md', '].md', true],
    ['[!]a].md', 'a.md', false],
    ['[!]a].md', 'b.md', true],
    ['[a.md', '[a.md', true],
    ['[a/b].md', 'a/b].md', false],
    ['*.{md,mdx}', 'a.mdx', true],
    ['*.{md,mdx}', 'a.html', false],
    ['{guides,blog}/**', 'blog/a.md', true],
    ['{a,b{c,d}}.md', 'bd.md', true],
    ['{a}.md', '{a}.md', true],
    ['a+b (1).md', 'a+b (1).md', true],
    ['guides\\*.md', 'guides/a.md', true],
    ['Guides/*.md', 'guides/a.md', false],
    ['a*b.md', 'a/b.md', false],
  ])('%s against %s: %s', (pattern, path, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });
});
