import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const readme = path.join(root, 'README.md');

describe('the README on npm', () => {
  it('keeps the demo video on GitHub and shows the hero image in the packed package', () => {
    const before = fs.readFileSync(readme, 'utf8');
    expect(before).toMatch(/^https:\/\/github\.com\/user-attachments\/assets\/[\da-f-]{36}$/m);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-readme-'));
    try {
      const packed = JSON.parse(
        execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
          cwd: root,
          encoding: 'utf8',
        }),
      ) as { filename: string }[];
      const filename = packed[0]?.filename;
      expect(filename).toBeTypeOf('string');
      execFileSync('tar', [
        '-xzf',
        path.join(dir, String(filename)),
        '-C',
        dir,
        'package/README.md',
      ]);
      const npmReadme = fs.readFileSync(path.join(dir, 'package/README.md'), 'utf8');

      expect(npmReadme).not.toContain('github.com/user-attachments');
      expect(npmReadme).not.toContain('npm-readme:');
      expect(npmReadme).toContain('<img src=".github/assets/demo.webp"');
      expect(npmReadme).toContain('## What you get');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // postpack put the GitHub version back.
    expect(fs.readFileSync(readme, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(root, '.npm-readme-backup.md'))).toBe(false);
  });
});
