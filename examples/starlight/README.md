# ask-my-site Starlight example

The ask-my-site docs as a Starlight site, with the `ask-my-site/starlight` plugin. Without `OPENAI_API_KEY` it uses the offline mock models, so it runs with no key.

```sh
pnpm install && pnpm build                       # in the repository root, once
cd examples/starlight
ASK_ENDPOINT=http://localhost:8787/api/ask pnpm build   # writes dist/ask-index.json
pnpm api                                         # the ask endpoint, on :8787
pnpm preview                                     # then press ⌘I or "Ask AI"
```

`api-server.mjs` stands in for the serverless function you would deploy; the main README has the Vercel, Netlify and Cloudflare versions. The changelog page has `pagefind: false`, so it is left out of the index, as it is out of Starlight's search.
