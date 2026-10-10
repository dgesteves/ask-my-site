// Fetches the real-world docs that test/corpus.test.ts searches: docusaurus.io's own docs, at a
// pinned commit, so the counts it checks never move under a pull request. Only website/docs is
// checked out (a sparse, blobless clone of a few MB). The docs are CC BY 4.0, by Meta Platforms.
//
//   node scripts/corpus.mjs            # into .corpus/ (git-ignored), once
//   ONDOCS_CORPUS=.corpus pnpm vitest run test/corpus.test.ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** facebook/docusaurus main on 2026-10-09: 92 docs pages, as the 2026-10-10 audit measured. */
export const DOCUSAURUS_COMMIT = 'c245217563f6491fdb79bf5ac91bfa16536e5de9';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = join(process.argv[2] ?? join(root, '.corpus'), 'docusaurus');
const git = (...args) => execFileSync('git', args, { cwd: target, stdio: 'inherit' });

if (existsSync(join(target, 'website/docs'))) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target }).toString().trim();
  if (head === DOCUSAURUS_COMMIT) {
    console.log(`${target} is at ${DOCUSAURUS_COMMIT}.`);
    process.exit(0);
  }
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
git('init', '--quiet');
git('remote', 'add', 'origin', 'https://github.com/facebook/docusaurus.git');
git('sparse-checkout', 'set', '--no-cone', '/website/docs/');
git('fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', DOCUSAURUS_COMMIT);
git('checkout', '--quiet', 'FETCH_HEAD');
console.log(`Fetched docusaurus.io's docs at ${DOCUSAURUS_COMMIT} into ${target}.`);
