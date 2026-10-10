# ondocs Docusaurus example

The ondocs docs as a Docusaurus 3 site, with the `ondocs/docusaurus` plugin. The pages are generated from the website's, in `examples/nextjs/content/docs`, by `pnpm examples:sync`: edit them there. Without `OPENAI_API_KEY` it uses the offline mock models, so it runs with no key.

```sh
pnpm install && pnpm build                       # in the repository root, once
cd examples/docusaurus
pnpm build                                       # writes build/ask-index.json
pnpm api                                         # ondocs dev: the ask endpoint, on :8787
ASK_ENDPOINT=http://localhost:8787/api/ask pnpm start   # then press ⌘I or "Ask AI"
```

`pnpm api` runs `ondocs dev`, which stands in for the serverless function you would deploy; the main README has the Vercel, Netlify and Cloudflare versions.
