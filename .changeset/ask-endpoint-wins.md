---
'ask-my-site': patch
---

The Docusaurus, Astro and Starlight plugins now post to `ASK_ENDPOINT` whenever it is set as the site builds or starts, even when the config sets `endpoint`. Before, an `endpoint` in the config won, so following the README (a config with `endpoint: '/api/ask'`, then `ASK_ENDPOINT=http://localhost:8787/api/ask npm start`) left the dialog posting to a path the dev server does not serve. The README's plugin snippets no longer set `endpoint`, since `/api/ask` is the default.
