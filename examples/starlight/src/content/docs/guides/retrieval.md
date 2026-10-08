---
title: How retrieval works
description: BM25, cosine similarity, reciprocal rank fusion and the relevance gate.
sidebar:
  order: 2
---

Retrieval combines keyword search and vector search, then decides whether anything found is relevant enough to answer from.

## Two retrievers

BM25 ranks chunks by the question's keywords, weighting rare terms higher. It is strong on exact names such as function names, flags and error messages.

Cosine similarity ranks chunks by the meaning of the question, using the embedding model the index was built with. It is strong on paraphrases, where the question and the page use different words.

## Reciprocal rank fusion

The two rankings are merged with reciprocal rank fusion. Each chunk scores the sum of 1 / (60 + rank) over the lists it appears in. Fusion uses ranks only, so BM25 scores and similarities never need to be put on the same scale, and a chunk ranked well by both retrievers beats one ranked first by only one.

## Saying "I don't know"

Before fusion, every candidate must clear a relevance gate: a cosine similarity of at least 0.25, or keyword coverage of at least 0.5. Keyword coverage is the share of the question's IDF weight that a chunk contains, so it is bounded between 0 and 1 and comparable across questions of any length. It still depends on the site: a word that appears on no page carries the most weight, so a question with one off-site word can fall short on keywords alone. The similarity side of the gate catches those; with a keyword-only index, lower `minKeywordCoverage`.

When no chunk clears the gate, the handler answers "I don't know" immediately and never calls the language model. That makes refusals fast, free and deterministic. The system prompt adds a second layer: the model must answer only from the sources and say it does not know when they are insufficient.

## Tuning

The defaults are calibrated for OpenAI `text-embedding-3-small`. Other embedding models produce different similarity ranges, so pass `retrieval: { minSimilarity }` to the handler and check the `best` scores that retrieval reports.
