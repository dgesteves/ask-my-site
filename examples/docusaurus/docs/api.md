---
# Generated from examples/nextjs/content/docs/api.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'Package API'
description: "The package's imports, the core functions for building and searching an index, and what each entry point exports."
---

The package has one CLI and these imports. Each is tree-shakeable, and only `ask-my-site/node`, the framework plugins and the CLI touch Node.js built-ins, so the rest runs on edge runtimes, in workers and in browsers.

| Import                               | For                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `ask-my-site`                        | Loaders, chunking, `buildIndex`, `checkIndex`, `loadIndex`, `retrieve`, `buildLlmsFiles`, `mcpInstallLinks`     |
| `ask-my-site/node`                   | `loadDirectory`, `readIndexFile`, `writeIndexFile`, and the config module's types                               |
| `ask-my-site/server`                 | `createAskHandler`, `createMcpHandler`, the rate limiters, the budget and answer cache stores                   |
| `ask-my-site/react`                  | `AskDialog`, `useAsk`, `AskAnswer`, `McpInstall` and `loadAskDialog`; needs `@radix-ui/react-dialog` and `cmdk` |
| `ask-my-site/embed`                  | `mountAskDialog`: the dialog and its button without writing React                                               |
| `ask-my-site/docusaurus`             | The [Docusaurus plugin](./docusaurus.md)                                                                        |
| `ask-my-site/astro`                  | The [Astro integration](./astro.md)                                                                             |
| `ask-my-site/starlight`              | The [Starlight plugin](./astro.md)                                                                              |
| `ask-my-site/astro/McpInstall.astro` | The "Add to Cursor / VS Code / Claude" block for an Astro or Starlight page                                     |
| `ask-my-site/mock`                   | `mockEmbeddingModel` and `mockLanguageModel`, for tests and offline demos                                       |
| `ask-my-site` (bin)                  | [`ask-my-site index` and `ask-my-site dev`](./cli.md)                                                           |

The handlers are documented in [The ask endpoint](./ask-endpoint.md) and [MCP server](./mcp.md), and the React components in [The ask dialog](./ask-dialog.md).

## Build and search an index yourself

The plugins and the CLI are built on these functions, which work on content from anywhere:

```ts
import { buildIndex, fromMarkdown, loadIndex, retrieve, serializeIndexFile } from 'ask-my-site';

const doc = fromMarkdown(source, { id: 'guide.md', url: '/guide' });
const { index, stats } = await buildIndex({ documents: [doc], embeddingModel, previous });
const loaded = loadIndex(serializeIndexFile(index));
const { hits, answerable, best } = retrieve(loaded, { text: question, vector });
```

`buildIndex` takes the previous index as `previous`, to reuse the vectors of chunks whose text is unchanged. `retrieve` returns the hits that passed the [relevance gate](./retrieval.md), whether any did, and the best raw signals, for tuning the gate's thresholds.

## Also exported

- **Loaders:** `fromHtml` (`root` picks the part of a page to read, as a selector such as `[data-pagefind-body]`, `ignore` what to leave out, and `markdown` keeps links and tables for a Markdown copy), `fromMarkdown` (`mdx`, `markdown`) and `fromDocuments`.
- **The index file:** `chunkDocument`, `checkIndex`, `parseIndexFile`, `validateIndexFile` and `serializeIndexFile`.
- **Text:** `tokenize`, and `createSlugger`, to use in your renderer so citations' anchors always match your headings.
- **Search's building blocks:** `Bm25Index`, `VectorIndex`, `reciprocalRankFusion`, `quantizeInt8`, `encodeVector` and `decodeVector`.
- **For agents:** `buildLlmsFiles` and `markdownPath`, which build `llms.txt`, `llms-full.txt` and the pages' `.md` copies from any list of pages, and `mcpInstallLinks`, the install links and commands for an MCP server's URL.
