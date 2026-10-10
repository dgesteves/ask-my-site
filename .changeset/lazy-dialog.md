---
'ask-my-site': minor
---

Load the dialog on first use. A page now carries only the dialog's button and shortcut, and the dialog itself (Radix Dialog, cmdk and the answer) loads the first time it is wanted: a pointer over or focus on its button or trigger, the shortcut, or opening it. A shortcut pressed while it loads still opens it, with focus in its input, and focus goes back where it was when it closes. Measured on the example sites, ask-my-site's JavaScript per page goes from about 22 KB to 3 KB gzipped with Docusaurus, from 88 KB to under 2 KB with Starlight, and from 91 KB to 2.4 KB with the script tag. `AskDialog` keeps its props; `loadAskDialog()` loads it sooner. `mountAskDialog` from `ask-my-site/embed` no longer loads React until the dialog is wanted. The script tag's `embed.global.js` now loads `embed-dialog.global.js` from next to it: copy both when you host the script yourself, or set `data-dialog-src`.
