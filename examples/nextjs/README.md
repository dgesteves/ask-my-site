# Next.js example

A small docs site that indexes its own pages at build time and answers questions about them with ⌘K. The docs are about ask-my-site itself, so you can ask it how it works.

## Run it

From the repository root:

```sh
pnpm install
pnpm example:dev
```

Open http://localhost:3000 and press ⌘K (Ctrl+K on Windows and Linux).

With no API key the app runs in **mock mode**: a deterministic hashing embedder for retrieval and a scripted model that answers by quoting the most relevant sentences, with citations. Retrieval, the relevance gate, streaming and the UI are the real code paths.

To use OpenAI, add a key and restart. `pnpm dev` rebuilds the index with the matching embedding model first:

```sh
echo "OPENAI_API_KEY=sk-..." > examples/nextjs/.env.local
# optional, defaults to gpt-5.4-mini
echo "OPENAI_CHAT_MODEL=gpt-5.4-mini" >> examples/nextjs/.env.local
```

## Where things are

| File                     | What it does                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `content/docs/*.md`      | The pages, with `title`, `description`, `section` and `order` frontmatter.                        |
| `ask-my-site.config.mjs` | The embedding model, shared by the CLI and the route so the index and queries always agree.       |
| `app/api/ask/route.ts`   | `createAskHandler` mounted as `POST /api/ask`, with an in-memory rate limit.                      |
| `app/ask.tsx`            | `<AskDialog />` with suggestions, a trigger button and client-side navigation for citations.      |
| `lib/docs.ts`            | Renders pages with ask-my-site's own slugger, so every citation anchor matches a real heading id. |

`pnpm index` writes `ask-index.json` (git-ignored here) and runs before `dev` and `build`. In a real project, commit the index and run `pnpm index:check` in CI instead.
