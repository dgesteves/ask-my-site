---
'ask-my-site': minor
---

`npx ask-my-site init` writes the ask endpoint and the MCP endpoint for your site and its host: Vercel Functions, Netlify Functions, Cloudflare Pages Functions, or a Cloudflare Worker with static assets. Each has a rate limit on the host's client IP header, a daily budget, the answer cache, the CORS preflight answered, and the index bundled the way the host needs. For GitHub Pages and other hosts that only serve files, it writes a Cloudflare Worker of its own that reads the index from the live site, with CORS for the site's origin only. It detects Docusaurus, Starlight, Astro, Next.js, VitePress, Hugo, MkDocs, Jekyll and Eleventy, prints what it wrote and the environment variables to set, asks before it overwrites a file that differs, has `--dry-run`, and never deploys anything or reads secrets.

On an Astro or Starlight site with an SSR adapter, the integration now serves `POST /api/ask` and `/api/mcp` itself with `injectRoute`, from the index it builds, so there is no route file to write. It answers with `openai:gpt-5.4-mini` by default, under a rate limit and a daily budget. A route file the site already has at either path answers instead; `route` sets the model and the limits, and `route: false` turns the routes off and keeps the previous behavior.

`remoteIndex(url)` from `ask-my-site/server` fetches an index over HTTP, keeps it in memory and checks it again every five minutes with its ETag, for an endpoint deployed apart from its site.
