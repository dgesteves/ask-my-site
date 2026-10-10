import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const readme = read('README.md');

describe('what the README claims', () => {
  it('states the Node.js version package.json requires', () => {
    const engines = (JSON.parse(read('package.json')) as { engines: { node: string } }).engines;
    const required = /^>=(\d+\.\d+)\.0$/.exec(engines.node)?.[1];
    expect(required).toBeDefined();
    expect(readme).toContain(`Requires Node.js ${String(required)} or later`);
    expect(readme).not.toMatch(/Requires Node \d+ and/);
    expect(read('CONTRIBUTING.md')).toContain(`Node ${String(required)} or later`);
  });

  it('does not say the live demo runs without a model key', () => {
    // The production site answers with OpenAI; only previews and local runs are in mock mode.
    for (const file of [
      'README.md',
      'examples/nextjs/content/docs/local-development.md',
      'examples/nextjs/content/docs/faq.md',
    ]) {
      const text = read(file);
      expect([file, /demo runs in mock mode|website runs in mock mode/.test(text)]).toEqual([
        file,
        false,
      ]);
      expect([file, text.includes('It runs in mock mode, so its answers')]).toEqual([file, false]);
    }
  });

  it('calls the benchmark’s memory figure heap, next to what the process grows by', () => {
    for (const file of ['README.md', 'examples/nextjs/content/docs/benchmarks.md']) {
      const header = read(file)
        .split('\n')
        .find((line) => line.startsWith('| Chunks |') && line.includes('Cold load'));
      expect([file, header]).toEqual([
        file,
        expect.stringMatching(/Heap retained \|\s+Process memory \(peak\)/),
      ]);
    }
  });

  it('says the integration needs a deployed endpoint and a rate limit, not five lines alone', () => {
    expect(readme).not.toContain('That is the whole integration');
    const quickstart = readme.slice(readme.indexOf('## Quickstart'), readme.indexOf('## Try it'));
    expect(quickstart).toMatch(/endpoint still has to run somewhere/);
    expect(quickstart).toMatch(/rate limit/);
  });
});
