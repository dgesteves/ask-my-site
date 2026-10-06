import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface Manifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const read = (path: string): Manifest =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', path), 'utf8')) as Manifest;
const manifest = read('package.json');

describe('package.json', () => {
  it('installs no React for server-only use', () => {
    // npm and pnpm install a dependency's required peers, so one React-only dependency is
    // enough to put React into a project that only mounts the handler.
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const dependency = read(`node_modules/${name}/package.json`);
      const required = Object.keys(dependency.peerDependencies ?? {}).filter(
        (peer) => !dependency.peerDependenciesMeta?.[peer]?.optional,
      );
      expect([name, required.filter((peer) => peer.startsWith('react'))]).toEqual([name, []]);
    }
  });

  it('declares what ask-my-site/react imports as optional peers', () => {
    for (const name of ['react', 'react-dom', '@radix-ui/react-dialog', 'cmdk']) {
      expect(manifest.peerDependencies?.[name]).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
    }
  });
});
