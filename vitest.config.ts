import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // React tests opt into jsdom with a `@vitest-environment jsdom` docblock.
    restoreMocks: true,
    testTimeout: 20_000,
  },
});
