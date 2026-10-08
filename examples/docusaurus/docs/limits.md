---
title: Limits and trade-offs
description: Where ask-my-site stops being the right tool.
sidebar_position: 9
---

ask-my-site trades scale for simplicity, and the trade has edges.

## Corpus size

Search is an exact scan over every vector. That is the right choice up to tens of thousands of chunks: at 10,000 chunks a query takes about 7 ms and the index is 16 MB. Both grow linearly. At 50,000 chunks the index is 79 MB and a query takes about 37 ms, and past that point an approximate index or a vector database becomes the better tool.

## Freshness

The index is rebuilt when you deploy. Content that changes between deploys, or differs per user, is not a fit.

## Language

Keyword search uses an English stopword list and light plural stripping. Other languages still work through the embedding model, but keyword matching is weaker for them.

## Answers

The model answers from the top few sources only, and only for one question at a time. There is no conversation memory, so a follow-up question must stand on its own.
