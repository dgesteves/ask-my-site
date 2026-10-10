---
'ondocs': patch
---

The Cloudflare Worker that `ondocs init` writes, and `templates/cloudflare-worker`, now allow the install scripts of esbuild and workerd in `package.json` (`allowScripts`) and decline fsevents. npm 12 runs no install scripts unless they are allowed, so a fresh install no longer warns that Wrangler's binaries were blocked.
