import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The site's CSS is a few KB; inlined, it no longer holds up the first paint with a request.
  experimental: { inlineCss: true },
};

export default config;
