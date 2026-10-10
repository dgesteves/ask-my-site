// The tests run in workerd, the Workers runtime, on this machine. remoteBindings: false keeps the
// AI binding local, where the tests stand in for it, so they need no Cloudflare account and use
// none of your Workers AI allowance.
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({ remoteBindings: false, wrangler: { configPath: './wrangler.jsonc' } }),
  ],
});
