---
# Generated from examples/nextjs/content/docs/cli.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'CLI and config file'
description: 'Every flag of ask-my-site index and ask-my-site dev, and the config module.'
sidebar:
  order: 30
---

The `ask-my-site` command has two subcommands: `index` builds or checks the index, and `dev` serves the endpoint on your machine. Run either with `npx ask-my-site`, or from a `package.json` script.

## ask-my-site index

`ask-my-site index [dir] [options]` builds `ask-index.json` from the Markdown, MDX and HTML files in `dir`.

| Flag                      | Default                  | What it does                                                                           |
| ------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `-o, --out <file>`        | `ask-index.json`         | Where to write the index.                                                              |
| `--check`                 | off                      | Exit 1 if the index is stale. Never calls a model.                                     |
| `--base-url <url>`        | `/`                      | URL prefix for pages, such as `/docs` or a full origin.                                |
| `-e, --embedding <spec>`  | OpenAI when a key is set | `openai:<model>`, `<provider>/<model>`, `mock[:<dims>]` or `none`.                     |
| `--dimensions <n>`        | the model's              | Vector size, for models that support it. With `--check`, the size the index must have. |
| `--chunk-size <chars>`    | `1200`                   | Maximum characters per chunk.                                                          |
| `--chunk-overlap <chars>` | `150`                    | Characters shared by consecutive chunks of a section.                                  |
| `--ignore <glob>`         | none                     | Skip matching files. Repeatable.                                                       |
| `--framework <name>`      | detected                 | `docusaurus`, `starlight`, `next` or `none`: how file paths become URLs.               |
| `--clean-urls`            | off                      | Drop `.html` from HTML files' URLs.                                                    |
| `-c, --config <file>`     | none                     | A module whose default export is an `AskConfig`.                                       |
| `-q, --quiet`             | off                      | Only print errors.                                                                     |

## Choosing the embedding model

Without `--embedding`, the CLI uses `openai:text-embedding-3-small` when `OPENAI_API_KEY` is set, or `openai/text-embedding-3-small` through AI Gateway when only `AI_GATEWAY_API_KEY` is. With neither, it fails rather than quietly building a keyword-only index, and suggests `-e mock` to try it without a key. `-e none` builds a keyword-only index on purpose.

## Environment and exit codes

The CLI reads `.env` and `.env.local` from the working directory, without overriding variables that are already set. It exits with 0 on success, 1 when the build fails or `--check` finds the index stale, and 2 on a usage error.

## ask-my-site dev

`ask-my-site dev [options]` serves `POST /api/ask` on 127.0.0.1, answering from a built index, for the dialog on your site's dev server. It serves the same index as an [MCP server](/integrations/mcp/) at `/api/mcp`, keyword-only, for your editor's agent.

| Flag                      | Default                                                              | What it does                                            |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `--index <file>`          | `ask-index.json`, `build/ask-index.json`, then `dist/ask-index.json` | The index to serve.                                     |
| `--port <n>`              | `8787`                                                               | Port to listen on.                                      |
| `--allow-origin <origin>` | localhost                                                            | Another origin allowed to call it, or `*`. Repeatable.  |
| `--model <id>`            | `gpt-5.4-mini`                                                       | OpenAI model for answers, when `OPENAI_API_KEY` is set. |

It embeds questions with the model the index records, answers with OpenAI when `OPENAI_API_KEY` is set and with the mock model otherwise, and reloads the index when the file changes. It only answers pages on this machine (localhost, 127.0.0.1 and [::1] origins, on any port) and requests addressed to localhost, so a site you visit cannot spend your key through it, and it caps request bodies at 64 KiB. [Try it locally](/get-started/local-development/) shows it with each integration.

## The config file

For an embedding provider the specs don't cover, or content that is not on disk, pass a config module with `--config`. Every field is optional:

```js
// ask-my-site.config.mjs
import { cohere } from '@ai-sdk/cohere';
import { getPosts } from './lib/cms.mjs';

/** @type {import('ask-my-site/node').AskConfig} */
export default {
  embeddingModel: cohere.embedding('embed-multilingual-v3.0'),
  baseUrl: '/docs',
  documents: async () =>
    (await getPosts()).map((post) => ({
      id: post.slug,
      url: `/blog/${post.slug}`,
      title: post.title,
      content: post.markdown,
    })),
};
```

| Field                      | What it does                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `embeddingModel`           | An AI SDK embedding model, or `null` for keyword-only.                              |
| `embeddingProviderOptions` | Passed to the embedding model, such as `{ openai: { dimensions: 512 } }`.           |
| `chunking`                 | `{ maxChars, overlap }`.                                                            |
| `baseUrl`                  | URL prefix for pages loaded from the folder.                                        |
| `ignore`                   | Glob patterns of files to skip.                                                     |
| `framework`                | `'auto'` (the CLI's default), `'docusaurus'`, `'starlight'`, `'next'` or `'none'`.  |
| `cleanUrls`                | Drop `.html` from HTML files' URLs.                                                 |
| `documents`                | `{ id, url, title, content }` records from elsewhere, or a function returning them. |

`defineConfig` from `ask-my-site/node` types the object without a JSDoc comment. Share the config with your route handler, as the ask-my-site website does, so the index and the queries always use the same embedding model.
