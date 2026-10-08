import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Docusaurus's client modules only exist in a Docusaurus build; the theme's tests stand in.
    alias: [
      {
        find: /^@docusaurus\/(BrowserOnly|router|useGlobalData)$/,
        replacement: fileURLToPath(new URL('test/docusaurus-client.tsx', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // React tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    restoreMocks: true,
    testTimeout: 20_000,
  },
});
