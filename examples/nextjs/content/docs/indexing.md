---
title: Indexing content
description: Loaders, frontmatter, URLs, chunking and the --check mode.
order: 3
---

Indexing turns pages into chunks, embeds each chunk, and writes everything to one JSON file.

## Supported sources

The CLI reads `.md`, `.mdx`, `.markdown`, `.html` and `.htm` files recursively. Dot-folders and `node_modules` are skipped. For content that is not on disk, such as a CMS, pass a plain array of `{ id, url, title, content }` records through a config file or call `buildIndex` directly.

## Frontmatter

Markdown files can set `title` and `url` (or `permalink`) in YAML frontmatter. Without a title, the first `# Heading` is used, then the file name. Pages with `draft: true`, `ask: false` or `noindex: true` are left out of the index.

## URLs

A file path becomes a URL by dropping the extension, so `guides/setup.md` is served at `/guides/setup`. Files named `index` or `README` stand for their folder. Use `--base-url` to add a prefix such as `/docs` or a full origin.

## Chunking

Chunks never cross a heading, so every chunk has exactly one heading path and one anchor. Within a section, paragraphs are packed up to 1,200 characters by default. Consecutive chunks of the same section share up to 150 characters of overlap, cut at a sentence boundary. Code blocks are never split in the middle of a line.

Each chunk is embedded together with its page title and heading path, so a short paragraph under "Rate limiting › Upstash" still carries that context.

## Checking the index in CI

Run `ask-my-site index --check` in CI to fail the build when the committed index is stale. The check re-chunks the content and compares content hashes. It never calls an embedding model and needs no API key, and on failure it lists which chunks were added, changed or removed.
