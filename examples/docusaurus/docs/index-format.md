---
title: The index file
description: Why vectors are int8, how the file stays small and diffable.
sidebar_position: 5
---

The index is one JSON file with the documents, the chunks and their vectors.

## int8 vectors

Each embedding is quantized to 8-bit integers. The vector is scaled so its largest component maps to 127, then every component is rounded. No scale factor is stored, because cosine similarity is scale-invariant and the scale cancels out.

An int8 vector takes one byte per dimension, a quarter of float32. Stored as base64, a 512-dimension vector is 684 characters, against 6,500 to 7,000 characters for the same vector written as JSON numbers the way embedding APIs return them, about ten times more.

Quantization costs almost nothing in accuracy. Similarities stay within 0.005 of the float32 values, and top-10 results are the same in at least 98% of positions in the test suite.

## Diffable by design

The file is written deterministically: documents are sorted, no timestamps are stored, and each chunk sits on its own line. Editing one paragraph changes one or two lines in a pull request.

## Incremental rebuilds

Every chunk records a hash of the text it was embedded from. On rebuild, chunks whose hash is unchanged reuse their vectors, so only edited sections are sent to the embedding model.

## Loading

At startup the handler parses the file, decodes the vectors into one contiguous Int8Array and builds the BM25 inverted index. This happens once per server instance and takes about 30 ms for 1,000 chunks.
