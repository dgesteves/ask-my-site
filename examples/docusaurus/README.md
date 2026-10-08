# ask-my-site Docusaurus example

The ask-my-site docs as a Docusaurus 3 site, with the `ask-my-site/docusaurus` plugin. Without `OPENAI_API_KEY` it uses the offline mock models, so it runs with no key.

```sh
pnpm install && pnpm build                       # in the repository root, once
cd examples/docusaurus
ASK_ENDPOINT=http://localhost:8787/api/ask pnpm build   # writes build/ask-index.json
pnpm api                                         # the ask endpoint, on :8787
pnpm serve --port 3000                           # then press ⌘I or "Ask AI"
```

`api-server.mjs` stands in for the serverless function you would deploy; the main README has the Vercel, Netlify and Cloudflare versions.
