---
'ondocs': minor
---

`ask-my-site` is now `ondocs`, and this is its first release under that name. The options, the endpoints and their paths, `ask-index.json` and its format are unchanged, and so is what the dialog and the endpoint send each other. What had the old name moves, and the old names in your code keep working until you rename them ([migration guide](https://ask-my-site-demo.vercel.app/docs/migrating)):

- **Package and command:** `npm install ondocs`, imports from `ondocs/server`, `ondocs/react`, `ondocs/docusaurus`, `ondocs/astro`, `ondocs/starlight`, `ondocs/embed` and the stylesheets under the same paths, and `npx ondocs index`, `init`, `dev` and `eval`. The `ask-my-site` package gets no new releases.
- **Script tag:** `https://cdn.jsdelivr.net/npm/ondocs@0.7/dist/embed.global.js`. Its global is `window.Ondocs`; `window.AskMySite` still works, and says once in the console to use the new name.
- **Docusaurus:** the theme components are `@theme/Ondocs` and `@theme/OndocsMcp`. `@theme/AskMySite` and `@theme/AskMySiteMcp` still work, and say once, while the site builds or in `docusaurus start`, to import the new names. The plugin warns about a swizzled `src/theme/AskMySite`, which its `Root` no longer renders. The plugin's name, for `useAllPluginInstancesData`, is `ondocs`.
- **Types:** `OndocsOptions`, `OndocsDialogOptions`, `OndocsStarlightOptions`, `OndocsGlobalData` and `OndocsTheme`. The `AskMySite…` names are deprecated aliases.
- **Plugins under their own names:** `docusaurus-plugin-ondocs` and `starlight-ondocs`. They were prepared in the repository as `docusaurus-plugin-ask-my-site` and `starlight-ask-my-site`, and never published under those names.
- **Smaller things:** the button's class is `.ondocs-launcher` and the script tag's container `.ondocs`; log lines start with `[ondocs]` and errors with `ondocs:`; the Astro integration and the Starlight plugin are named `ondocs`, and so is the MCP server in `initialize` unless you pass `name`. The plugins keep the previous build's index in `node_modules/.cache/ondocs`, and the first build after the upgrade reuses the vectors in `node_modules/.cache/ask-my-site`, so it embeds only what changed.
- **Unchanged on purpose:** the index's format id (`ask-my-site/index@1`), the key under which the endpoint sends each source's title, and the store keys of `budget` and `answerCache` (`ask-my-site:budget:`, `ask-my-site:answer:`, `ask-my-site:mcp-budget:`), so indexes, dialogs and shared stores carry over.
