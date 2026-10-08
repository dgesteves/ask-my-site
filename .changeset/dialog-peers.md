---
'ask-my-site': patch
---

The Docusaurus, Astro and Starlight plugins warn when a package the dialog renders with (`react`, `react-dom`, `@radix-ui/react-dialog` or `cmdk`, optional peers of ask-my-site) is not installed, naming the `npm i` that fixes it, before the site's bundler fails with a bare "Cannot find package".
