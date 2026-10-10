---
'ondocs': minor
---

A Cloudflare Worker that answers any static docs site with Workers AI, with no API key: `npx ondocs init --host github-pages` now writes it by default (`--provider openai` keeps OpenAI), and `templates/cloudflare-worker` is the same Worker as a template for `npm create cloudflare`. It reads the index from the live site, embeds questions with the Workers AI model the index records (or searches by keywords), answers with `CHAT_MODEL`, caps itself near the free daily allowance, and runs its tests in workerd with stand-ins, offline.

`-e workers-ai:@cf/<model>` (and `embedding: 'workers-ai:…'` in the plugins) builds an index with a Workers AI embedding model over Cloudflare's REST API, with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; `ondocs dev` embeds questions for such an index the same way.

An index embedded with `@cf/baai/bge-small-en-v1.5` gets a relevance gate of 0.65 by default, measured on docusaurus.io's docs, instead of the 0.25 set for OpenAI's models, which would let every question through.
