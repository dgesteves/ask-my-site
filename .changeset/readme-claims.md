---
'ask-my-site': patch
---

Correct the README: the live demo answers with OpenAI (only its previews and local runs use mock mode); development needs Node.js 22.12 or later, as `engines` says, not Node 24; the integration is five lines of code plus a deployed endpoint with a rate limit; and the benchmark's "Memory" column is the heap the index retains, now shown next to how much the process grows to load it (about 240 MB at 10,000 chunks), which is what a platform's memory limit counts. `pnpm bench` measures that process memory in a fresh process per size.
