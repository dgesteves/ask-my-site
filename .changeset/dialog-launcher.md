---
'ask-my-site': minor
---

Add `launcher` to `AskDialog`: `<AskDialog launcher />` shows the floating "Ask AI" button with its shortcut that the Docusaurus, Astro and Starlight plugins and the script embed show, so a React site has something to click without writing a trigger (`launcher="Ask the docs"` sets its label). Style it with `ask-my-site/embed/launcher.css`, which now follows the system's color scheme when the dialog's theme is not pinned. It renders on the server without touching `navigator`.
