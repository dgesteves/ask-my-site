---
'ask-my-site': minor
---

The Docusaurus, Astro and Starlight plugins now build their default model, OpenAI's `text-embedding-3-small`, at 512 dimensions instead of its full 1,536: a third of the index size, as the README's figures assume. Pass `dimensions` (or `embeddingProviderOptions`) for another size; a model you name with `embedding` keeps its own size unless you give one. `createAskHandler` reads the vector size from the index for OpenAI's `text-embedding-3` models, directly or through AI Gateway, so the endpoint no longer repeats `embeddingProviderOptions: { openai: { dimensions } }`, and indexes built at 1,536 keep working. If your endpoint runs on an older ask-my-site than your site's build, either upgrade it or pin `dimensions: 1536` in the plugin. `ask-my-site dev` also finds `dist/client/ask-index.json`, where Astro writes the index for a site with an adapter, and the Astro integration's build log names the file it wrote from the project root.
