---
title: Try it locally
description: Run the whole pipeline on your machine with mock mode and ask-my-site dev, no API key.
section: Get started
order: 3
---

You can try ask-my-site on your own content in about two minutes, without an API key. Mock mode replaces both models with offline stand-ins, and `ask-my-site dev` serves the endpoint on your machine.

## Run the endpoint locally

To run the endpoint locally, index a folder of Markdown, MDX or HTML with the mock embedder, then start `ask-my-site dev`:

```sh
npm i ask-my-site
npx ask-my-site index ./docs -e mock   # writes ask-index.json
npx ask-my-site dev                    # serves POST http://localhost:8787/api/ask
```

`ask-my-site dev` answers from `ask-index.json`, or from `build/ask-index.json` or `dist/ask-index.json`, where the Docusaurus and Astro plugins write theirs. It listens on 127.0.0.1 port 8787 (`--port`), answers pages on this machine only (`--allow-origin` adds another origin), and picks up a rebuilt index on the next question.

## Point the dialog at it

The plugins post to the `ASK_ENDPOINT` environment variable when it is set and no `endpoint` option is given, so you don't edit any config:

```sh
ASK_ENDPOINT=http://localhost:8787/api/ask npm start
```

With React, render `<AskDialog endpoint="http://localhost:8787/api/ask" launcher />`. With the script tag, set `data-endpoint="http://localhost:8787/api/ask"`. Then press ⌘K (⌘I with the plugins and the script tag) and ask.

## What mock mode does

`mockEmbeddingModel()` hashes words and word pairs into 512-dimension vectors, so similarity tracks shared vocabulary. `mockLanguageModel()` answers extractively: it picks the sentences from the retrieved sources that best match the question and cites each one, and it never writes text of its own. Everything else is the production code path: chunking, the int8 index, hybrid retrieval, the relevance gate, streaming and citations.

Both models come from `ask-my-site/mock`. They are for demos, tests and local development. Retrieval over a mock index is lexical, so a question has to share words with the page that answers it.

## Use a real model locally

With `OPENAI_API_KEY` set, `ask-my-site dev` answers with OpenAI's `gpt-5.4-mini` (`--model` picks another) instead of the mock model. With only `AI_GATEWAY_API_KEY` set, it answers through AI Gateway. Questions are always embedded with the model the index was built with: an index embedded with OpenAI needs one of the two keys, and an index it cannot match is refused with a message saying what to change.

The CLI and `ask-my-site dev` read `.env` and `.env.local` in the working directory, without overriding variables that are already set.

## The demo website

The ask-my-site website runs in mock mode. It is a Next.js app that indexes these pages with `ask-my-site index` at build time and answers through `createAskHandler` with `mockLanguageModel()`, so its answers are quotes from these docs, picked by the words they share with the question. With a real model, answers are written in full sentences from the same sources. The Docusaurus and Starlight examples in the repository answer the same way through `ask-my-site dev`.
