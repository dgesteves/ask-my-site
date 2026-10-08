import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { defineConfig, type UserConfig } from 'tsdown';

/**
 * Imports a stylesheet as its text, without comments or runs of whitespace, for the script embed
 * to inject itself.
 */
const cssAsText: NonNullable<UserConfig['plugins']> = {
  name: 'ask-my-site:css-as-text',
  resolveId: {
    filter: { id: /\.css$/ },
    handler: (source, importer) => (importer ? `${resolve(dirname(importer), source)}?text` : null),
  },
  load: {
    filter: { id: /\.css\?text$/ },
    handler: async (id) => {
      const css = (await readFile(id.replace(/\?text$/, ''), 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/ ?([{};]) ?/g, '$1')
        .trim();
      return `export default ${JSON.stringify(css)};`;
    },
  },
};

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      node: 'src/node/index.ts',
      server: 'src/server/index.ts',
      react: 'src/react/index.ts',
      mock: 'src/mock/index.ts',
      embed: 'src/embed/index.tsx',
      cli: 'src/cli/bin.ts',
      'docusaurus/index': 'src/docusaurus/index.ts',
      // The plugin finds its theme next to itself, and Docusaurus resolves theme components by
      // file name: dist/docusaurus/theme/Root.js and AskMySite.js.
      'docusaurus/theme/Root': 'src/docusaurus/theme/Root.tsx',
      'docusaurus/theme/AskMySite': 'src/docusaurus/theme/AskMySite.tsx',
      'astro/index': 'src/astro/index.ts',
      'starlight/index': 'src/starlight/index.ts',
    },
    // Provided by the Docusaurus site at build time: its modules and theme components.
    deps: { neverBundle: [/^@docusaurus\//, /^@theme(-init|-original)?\//] },
    format: 'esm',
    // `node` only governs how built-ins resolve. The core, server, react, mock and embed entries
    // never import a built-in, so their output stays runtime-neutral (edge, workers, browsers).
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
      { from: 'src/embed/launcher.css', to: 'dist/embed' },
      { from: 'src/starlight/launcher.css', to: 'dist/starlight' },
      { from: 'src/docusaurus/launcher.css', to: 'dist/docusaurus' },
      { from: 'src/docusaurus/theme.d.ts', to: 'dist/docusaurus' },
    ],
  },
  {
    // dist/embed.global.js, for a <script> tag on any site: production React, the dialog and its
    // stylesheets in one minified file that mounts itself.
    entry: { embed: 'src/embed/global.ts' },
    outputOptions: { entryFileNames: 'embed.global.js' },
    deps: { alwaysBundle: [/./], onlyBundle: false },
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [cssAsText],
    inputOptions: {
      // Radix and cmdk mark their modules "use client", which means nothing in a script.
      onLog: (level, log, handler) => {
        if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
      },
    },
    dts: false,
    // The first build cleans dist/.
    clean: false,
  },
]);
