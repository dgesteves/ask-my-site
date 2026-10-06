import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node/index.ts',
    server: 'src/server/index.ts',
    react: 'src/react/index.ts',
    mock: 'src/mock/index.ts',
    cli: 'src/cli/bin.ts',
  },
  format: 'esm',
  // `node` only governs how built-ins resolve. The core, server, react and mock entries never
  // import a built-in, so their output stays runtime-neutral (edge, workers, browsers).
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: true,
  clean: true,
  // React Server Components need the directive at the top of the emitted client entry.
  banner: ({ fileName }) => (fileName === 'react.js' ? { js: "'use client';" } : undefined),
  copy: [{ from: 'src/react/styles.css', to: 'dist' }],
});
