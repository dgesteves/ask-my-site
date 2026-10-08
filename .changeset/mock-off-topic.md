---
'ask-my-site': patch
---

Fix mock mode answering off-topic questions on small sites. The mock embedder hashes words into buckets, and a short question could collide with a short chunk ("France" and "npm" share one at 512 dimensions), clearing `MOCK_MIN_SIMILARITY` without a word in common: "What is the capital of France?" got a cited answer. Retrieval over an index built with `mockEmbeddingModel` now counts similarity only from chunks that share a word with the question. The new `retrieval.similarityNeedsKeyword` option sets this either way; it is off for real embeddings, which match meaning without shared words.
