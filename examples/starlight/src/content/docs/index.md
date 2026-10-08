---
title: Introduction
description: What ask-my-site is and when to use it.
---

ask-my-site adds a ⌘K "ask" box to a website. Visitors type a question and get a short answer, written from the site's own pages, with numbered citations that link to the exact section each claim came from.

## How it is different

Most site assistants need a hosted vector database, an ingestion pipeline and a service to keep both in sync. ask-my-site needs none of them. Content is indexed at build time into one static JSON file, and search runs in memory inside the same request handler that streams the answer.

The index is small enough to commit next to the content it describes. A site of 1,000 chunks produces an index of about 1.6 MB, and a query searches it in under a millisecond.

## When it fits

ask-my-site fits documentation sites, product sites, blogs and portfolios: anything with up to tens of thousands of chunks that changes when you deploy. It does not fit content that changes per user, per request, or faster than you deploy.

## What you get

- A CLI that turns Markdown, MDX and HTML into an index.
- A request handler that retrieves, refuses when nothing is relevant, and streams a cited answer.
- A React command palette and a `useAsk` hook.
