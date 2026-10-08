---
'ask-my-site': patch
---

Fix citations into built HTML that led nowhere. An HTML file now keeps `.html` in its URL (`docs/install.html` is cited as `/docs/install.html`, not `/docs/install`, which 404s on a server without clean URLs); `index.html` still stands for its folder, the framework rules still drop the extension, and `--clean-urls` (or `cleanUrls` in `loadDirectory` and a config module) drops it for hosts that serve clean URLs. A heading in HTML now gets an anchor only from its own `id`: one without an `id` links to the nearest heading above it that has one, or to the page, instead of to a slug the page does not have. `fromHtml` marks its documents with the new `anchors: 'explicit'`; Markdown keeps its slug anchors.

Indexes built from HTML change, so `--check` reports them as stale until they are rebuilt.
