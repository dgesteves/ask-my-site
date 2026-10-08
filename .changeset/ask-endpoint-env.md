---
'ask-my-site': minor
---

The Docusaurus, Astro and Starlight plugins post to `ASK_ENDPOINT` when it is set as the site builds or starts and no `endpoint` is given, so `ASK_ENDPOINT=http://localhost:8787/api/ask npm start` points the dialog at `ask-my-site dev` without editing the config. In `docusaurus start` and `astro dev`, when the dialog posts to a path on the site that the dev server does not serve, the plugins say once how to get answers with `ask-my-site dev`; the dialog's 404 warning in development says it too.
