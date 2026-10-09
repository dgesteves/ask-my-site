---
'ask-my-site': patch
---

`mockLanguageModel` answers better from the same sources. It weighs the question's rarer words over words every source shares, counts each source's title and heading, and leads with the best sentence, so "How do I deploy to Netlify?" quotes the Netlify section instead of a passing mention. A sentence that introduces a code block, a list or a table now quotes it too, so a "how do I" question gets the snippet. List items and table rows are no longer run together into one sentence, sentences are not split inside quotes, and what is left of a link ("See Deploying.") is skipped. It still quotes only the sources, and cites each.
