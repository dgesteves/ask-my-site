---
'ask-my-site': minor
---

`ask-my-site dev` now answers only pages on your machine. Before, it allowed any origin, so with `OPENAI_API_KEY` set any site you visited could spend your key through it. Requests from an origin other than localhost, 127.0.0.1 or [::1] (any port) get a 403 unless `--allow-origin` names it (repeatable, or `*` for any; `--origin` still works). Requests whose `Host` is not one of those names get a 403, which stops DNS rebinding. Request bodies over 64 KiB get a 413 as soon as they pass the limit, instead of being read into memory first.
