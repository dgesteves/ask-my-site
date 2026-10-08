---
'ask-my-site': patch
---

Fix the Docusaurus plugin building a keyword-only index when `OPENAI_API_KEY` is set and `@ai-sdk/openai` is installed. Docusaurus loads plugins through jiti, which broke loading `@ai-sdk/openai` (`Cannot read properties of undefined (reading 'object')`), and the plugin reported that as "not installed". Provider packages now load with Node's own `require`, which works under jiti, Astro and plain Node.

A missing provider package is reported as missing only when it is; any other failure is printed as it is. When `OPENAI_API_KEY` is set and the provider cannot load, the Docusaurus, Astro and Starlight plugins now fail the build instead of quietly building a keyword-only index. The CLI's `--embedding openai:…` reports the real error too.
