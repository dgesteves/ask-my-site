---
'ask-my-site': minor
---

Add `ask-my-site dev`, the ask endpoint on your machine: `npx ask-my-site dev` serves `POST /api/ask` on port 8787 (`--port`), with CORS for any origin (`--origin` to list some), answering from `ask-index.json`, `build/ask-index.json` or `dist/ask-index.json` (`--index`), and picking up a rebuilt index on the next question. Questions are embedded as the index was: with the mock model for an index built with `-e mock`, with OpenAI or AI Gateway when the index was and the key is set, and not at all for a keyword-only index; an index it cannot match is refused with what would fix it. Answers come from OpenAI when `OPENAI_API_KEY` is set (`--model`, default `gpt-5.4-mini`), else from the mock model. On start it prints the endpoint and what to set to point the dialog at it.
