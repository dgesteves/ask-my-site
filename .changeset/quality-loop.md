---
'ondocs': minor
---

The quality loop. `ondocs eval <questions.yaml>` scores retrieval against questions whose answers you know, hit@1 and hit@3, and refusal precision and recall for questions marked unanswerable, question by question, embedding each question as the index was and calling no language model; it exits 1 under its thresholds, for CI. With `onFeedback`, the dialog asks "Was this helpful?" under each answer, with thumbs up and down and a comment, posted to the endpoint with the answer's id, which `onFinish` now gets too. `onFinish` also gets `lowConfidence`, true when the model answered without citing its sources, so `refused || lowConfidence` is the log of the questions the docs do not answer. Nothing leaves the site unless you wire it. `useAsk` has `rate()`, and `ondocs dev` prints ratings.
