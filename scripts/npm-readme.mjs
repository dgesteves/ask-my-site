// npm can't play the demo video at the top of the README: GitHub serves it from a
// user-attachments URL that only works on github.com, so on npm it would be a bare
// link that 404s for anyone signed out. While the package is packed, this swaps the
// block between `<!-- npm-readme:video -->` and `<!-- npm-readme:image` for the
// image inside that comment, and puts the README back afterwards:
//
//   node scripts/npm-readme.mjs prepack    README.md → the npm version (original kept aside)
//   node scripts/npm-readme.mjs postpack   restores the original
//   node scripts/npm-readme.mjs --print    prints the npm version, changing nothing
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readme = path.join(root, 'README.md');
const backup = path.join(root, '.npm-readme-backup.md');

const VIDEO = '<!-- npm-readme:video -->';
const IMAGE = '<!-- npm-readme:image';
const ATTACHMENT = /https:\/\/github\.com\/user-attachments\//;

export function toNpmReadme(text) {
  const start = text.indexOf(VIDEO);
  const image = text.indexOf(IMAGE);
  const end = image === -1 ? -1 : text.indexOf('-->', image);
  if (start === -1 || image < start || end === -1) {
    throw new Error(`README.md: expected ${VIDEO}, then ${IMAGE} … --> around the demo video`);
  }
  const replacement = text.slice(image + IMAGE.length, end).trim();
  const out = `${text.slice(0, start)}${replacement}\n${text.slice(end + 3).replace(/^[ \t]*\n/, '')}`;
  if (ATTACHMENT.test(out))
    throw new Error('README.md: a github.com/user-attachments link is left for npm');
  return out;
}

const mode = process.argv[2];
if (mode === '--print') {
  process.stdout.write(toNpmReadme(fs.readFileSync(readme, 'utf8')));
} else if (mode === 'prepack') {
  // A pack that failed before postpack leaves the npm version in place: put the original back first.
  if (fs.existsSync(backup)) fs.renameSync(backup, readme);
  const original = fs.readFileSync(readme, 'utf8');
  const npm = toNpmReadme(original);
  fs.writeFileSync(backup, original);
  fs.writeFileSync(readme, npm);
} else if (mode === 'postpack') {
  if (fs.existsSync(backup)) fs.renameSync(backup, readme);
} else {
  console.error('usage: node scripts/npm-readme.mjs prepack | postpack | --print');
  process.exit(1);
}
