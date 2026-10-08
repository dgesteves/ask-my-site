import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node/index.ts',
    server: 'src/server/index.ts',
    react: 'src/react/index.ts',
    mock: 'src/mock/index.ts',
    cli: 'src/cli/bin.ts',
    'docusaurus/index': 'src/docusaurus/index.ts',
    // The plugin finds its theme next to itself, and Docusaurus resolves theme components by file
    // name: dist/docusaurus/theme/Root.js and AskMySite.js.
    'docusaurus/theme/Root': 'src/docusaurus/theme/Root.tsx',
    'docusaurus/theme/AskMySite': 'src/docusaurus/theme/AskMySite.tsx',
  },
  // Provided by the Docusaurus site at build time: its modules and theme components.
  deps: { neverBundle: [/^@docusaurus\//, /^@theme(-init|-original)?\//] },
  format: 'esm',
  // `node` only governs how built-ins resolve. The core, server, react and mock entries never
  // import a built-in, so their output stays runtime-neutral (edge, workers, browsers).
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: true,
  clean: true,
  banner: ({ fileName }) => {
    // React Server Components need the directive at the top of the emitted client entry.
    if (fileName === 'react.js') return { js: "'use client';" };
    // The plugin's types bring the `@theme/AskMySite` declaration, for a site's swizzled Root.
    if (fileName === 'docusaurus/index.d.ts') {
      return { dts: '/// <reference path="./theme.d.ts" />' };
    }
    return undefined;
  },
  copy: [
    { from: 'src/react/styles.css', to: 'dist' },
    { from: 'src/docusaurus/launcher.css', to: 'dist/docusaurus' },
    { from: 'src/docusaurus/theme.d.ts', to: 'dist/docusaurus' },
  ],
});
