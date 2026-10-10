# starlight-ask-my-site

[ask-my-site](https://github.com/dgesteves/ask-my-site)'s Starlight plugin, under the name Starlight users search for. It makes your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor.

This package only re-exports `ask-my-site/starlight`, at the same version. Everything is documented on [the ask-my-site website](https://ask-my-site-demo.vercel.app/docs/astro).

```sh
npm i starlight-ask-my-site ai @ai-sdk/openai react react-dom @radix-ui/react-dialog cmdk
```

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import askMySite from 'starlight-ask-my-site';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [starlight({ title: 'Acme Docs', plugins: [askMySite()] })],
});
```

After `astro build`, the plugin indexes what Starlight's search indexes into `dist/ask-index.json` (one per locale), writes `llms.txt` and a `.md` copy of each page, and adds an "Ask AI" button with ⌘I. The answers come from an endpoint you deploy next to the site: see [Deploying](https://ask-my-site-demo.vercel.app/docs/deployment).

MIT © Diogo Esteves
