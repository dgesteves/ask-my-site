---
title: Deploying
description: Runtimes, bundle size, cold starts and cost.
sidebar_position: 8
---

ask-my-site deploys wherever your site's server code runs. There is no database to provision.

## Runtimes

The core and the handler use only Web APIs, so they run on Node.js, Bun, Deno, Cloudflare Workers and Vercel Functions. File-system helpers live in `ask-my-site/node` and are only needed at build time.

## Where the index lives

Importing the JSON file bundles it with the function, which is simplest. For large indexes on platforms with bundle limits, serve the file as a static asset and pass a loader instead: `index: () => fetch(url).then((r) => r.text())`. The loader runs once per instance.

## Cold starts

Loading the index is a one-time cost per server instance: about 30 ms for 1,000 chunks and 340 ms for 10,000. After that, a query takes under a millisecond of CPU at 1,000 chunks and about 7 ms at 10,000, so nearly all request time is the embedding call and the model's answer.

## Cost

Each answered question costs one embedding call for the question and one model call for the answer. Refused questions skip the model call. Indexing costs one embedding call per changed chunk.
