---
'ask-my-site': minor
---

Serve the index to agents as an MCP server. `createMcpHandler` from `ask-my-site/server` is a Web-standard `(Request) => Promise<Response>`, mounted like the ask endpoint, with three read-only tools: `search` (ranked sections with a snippet and a URL to the anchor), `fetch` (a page or section as Markdown) and `list_pages`. It never calls a language model, and without an `embeddingModel` it calls no model at all. It speaks MCP 2026-07-28 (`server/discover`, no session) and, for clients that start with `initialize`, 2025-11-25 back to 2024-11-05, statelessly. Tool calls are rate-limited (60 a minute per client IP by default) and can take a daily `budget`.

The Docusaurus, Astro and Starlight plugins take an `mcp` option with the endpoint's URL, for an "Add to Cursor / VS Code / Claude" block on a docs page: `<AskMySiteMcp />` from `@theme/AskMySiteMcp`, or `ask-my-site/astro/McpInstall.astro`. `McpInstall` from `ask-my-site/react` and `mcpInstallLinks` from `ask-my-site` do the same anywhere. `ask-my-site dev` serves the index at `/api/mcp` too.
