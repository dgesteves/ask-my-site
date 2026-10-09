# ask-my-site Starlight example

The ask-my-site docs as a Starlight site, with the `ask-my-site/starlight` plugin. The pages are generated from the website's, in `examples/nextjs/content/docs`, by `pnpm examples:sync`: edit them there. The changelog page is this site's own. Without `OPENAI_API_KEY` it uses the offline mock models, so it runs with no key.

```sh
pnpm install && pnpm build                       # in the repository root, once
cd examples/starlight
pnpm build                                       # writes dist/ask-index.json
pnpm api                                         # ask-my-site dev: the ask endpoint, on :8787
ASK_ENDPOINT=http://localhost:8787/api/ask pnpm dev     # then press ⌘I or "Ask AI"
```

`pnpm api` runs `ask-my-site dev`, which stands in for the serverless function you would deploy; the main README has the Vercel, Netlify and Cloudflare versions. The changelog page has `pagefind: false`, so it is left out of the index, as it is out of Starlight's search.
