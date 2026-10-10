---
'ask-my-site': minor
---

Labels and locales. Every string the dialog and its button show or announce is a label: `labels` on `AskDialog`, `dialog.labels` in the plugins, and `data-labels` (a JSON object) or `data-label-<name>` on the script tag, over English defaults; `DEFAULT_LABELS` lists them. The endpoint's own messages show as it sends them unless a label for them is given. The plugins take options per locale (`dialog.locales`), from Docusaurus's i18n and from the page's path in Starlight and Astro, and the dialog sends the page's `locale` with each question; `createAskHandler` answers it from `indexes[locale]`, the index the plugins already build per locale. The routes the Astro integration serves, and the endpoints `ask-my-site init` writes, wire each locale's index. `useAsk` takes `locale`, and an `AskError` has a `reason`.
