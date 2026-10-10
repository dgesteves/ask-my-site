# docusaurus-plugin-ask-my-site

[ask-my-site](https://github.com/dgesteves/ask-my-site)'s Docusaurus plugin, under the name Docusaurus users search for. It makes your docs answerable by people and by agents, from one static index: a cited Ask box, an MCP server and llms.txt, on your own function and key, with no vector database and no vendor.

This package only re-exports `ask-my-site/docusaurus`, at the same version. Everything is documented on [the ask-my-site website](https://ask-my-site-demo.vercel.app/docs/docusaurus).

```sh
npm i docusaurus-plugin-ask-my-site ai @ai-sdk/openai @radix-ui/react-dialog cmdk
```

```ts
// docusaurus.config.ts
export default {
  plugins: ['docusaurus-plugin-ask-my-site'],
};
```

Use the full name: Docusaurus resolves the shorthand `'ask-my-site'` to the `ask-my-site` package itself, which is not the plugin. `plugins: ['ask-my-site/docusaurus']` is the same plugin, from the main package.

After `docusaurus build`, the plugin indexes the pages into `build/ask-index.json`, writes `llms.txt` and a `.md` copy of each page, and adds an "Ask AI" button with ⌘I. The answers come from an endpoint you deploy as one function on your host: see [Deploying](https://ask-my-site-demo.vercel.app/docs/deployment).

MIT © Diogo Esteves
