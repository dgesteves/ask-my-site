---
'ask-my-site': minor
---

Add `links: 'sources'` to the dialog (`<AskDialog links="sources">`, `<AskAnswer links="sources">`, `dialog: { links: 'sources' }` in the plugins, `data-links="sources"` on the script tag): a Markdown link in an answer then stays a link only when it points at one of the answer's source pages, and any other shows as its text, so text injected into indexed content cannot get the model to show visitors another site's link. Citations link to their sources either way; the default, `'all'`, is unchanged. The Docusaurus launcher's shortcut hint now reaches 4.5:1 contrast in light and dark mode (it was 3.97:1 in light mode), using Infima's emphasis colors instead of opacity.
