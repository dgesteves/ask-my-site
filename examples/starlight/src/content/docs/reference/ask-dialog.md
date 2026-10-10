---
# Generated from examples/nextjs/content/docs/ask-dialog.md by scripts/sync-example-docs.mjs. Edit that file instead.
title: 'The ask dialog'
description: 'AskDialog props, the launcher button, shortcuts, theming, accessibility and the useAsk hook.'
sidebar:
  order: 32
---

`AskDialog` from `ask-my-site/react` is a command palette built on Radix Dialog and cmdk. The Docusaurus, Astro and Starlight plugins and the script tag render the same component, so everything here applies to them too, through their `dialog` options or `data-*` attributes.

## AskDialog props

| Prop                                  | Default                         | Notes                                                                                                 |
| ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `endpoint`                            | `/api/ask`                      | Where questions are posted. Also `headers` and a custom `fetch`.                                      |
| `open`, `defaultOpen`, `onOpenChange` | uncontrolled                    | Controlled or uncontrolled.                                                                           |
| `shortcut`                            | `"k"`                           | Opens the dialog with ⌘ or Ctrl; `false` disables it.                                                 |
| `trigger`                             | none                            | An element that opens the dialog, such as a search button.                                            |
| `launcher`                            | `false`                         | `true` or a label: a floating "Ask AI" button with the shortcut on it.                                |
| `suggestions`                         | `[]`                            | Questions offered before typing, filtered as you type.                                                |
| `onNavigate`                          | browser navigation              | `(url, event)` for citations and sources; call `preventDefault()` to route yourself.                  |
| `theme`                               | `"system"`                      | `"light"` or `"dark"` to pin it.                                                                      |
| `classNames`                          | none                            | Extra classes per part: `overlay`, `content`, `input`, `list`, `item`, `answer`, `sources`, `footer`. |
| `title`                               | "Ask this site"                 | The dialog's accessible name.                                                                         |
| `placeholder`                         | "Ask a question…"               | The input's placeholder.                                                                              |
| `footer`                              | a disclaimer and keyboard hints | Replaces the footer.                                                                                  |
| `links`                               | `"all"`                         | `"sources"` keeps only the answer's links to its source pages; citations always link.                 |

## Opening the dialog

In React, the dialog opens with ⌘K on macOS and Ctrl+K elsewhere. The plugins and the script tag use ⌘I or Ctrl+I instead, so ⌘K stays with the site's search. The shortcut does nothing while a text field or editor has focus.

To change the keyboard shortcut, pass another key, as in `shortcut="j"`, or turn it off with `shortcut={false}` and open the dialog from a `trigger` element or the `launcher` button instead. In the plugins, the same option is `dialog: { shortcut: 'j' }`, and with the script tag it is `data-shortcut="j"`.

## The launcher button

`launcher` adds a floating "Ask AI" button in the corner of the page, with the shortcut on it. Pass a string to change its label, as in `launcher="Ask the docs"`, and import `ask-my-site/embed/launcher.css` for its look, or style `.ask-my-site-launcher` yourself.

## Citations and navigation

Citations in the answer and the entries in the sources list link to the exact section they came from. Pass `onNavigate` to route with your framework's client router, for example `router.push(url)` in Next.js. The dialog closes after a click either way.

## Theming the dialog

Import `ask-my-site/react/styles.css` for the default theme, which follows the system's light or dark setting. To change the dialog's colors, set its CSS custom properties: every color, radius and font is one, so `.ask-dialog { --ask-accent: #7c3aed; --ask-radius: 8px; }` is a complete rebrand. To style it from scratch, skip the stylesheet: every part has a stable `ask-*` class, and `classNames` adds your own, which suits Tailwind.

## Accessibility

Focus moves into the dialog when it opens and returns to where it was when it closes. The answer region is `aria-live="polite"` and `aria-busy` while text streams, and a separate status region announces when the answer is ready. All animation is turned off under `prefers-reduced-motion`. The test suite runs axe on the dialog before and after it answers, and checks that every text color in the light and dark themes keeps a contrast of at least 4.5:1.

## While an answer streams

Sources arrive before the first word, and the answer renders as it streams, batched to one update per animation frame. Closing the dialog, by Escape, a click outside or its parent, stops the answer in flight, so the model is not left generating for nobody. When an answer stops at the model's output limit, the dialog says it may be incomplete.

## The useAsk hook

`useAsk({ endpoint })` is the hook behind the dialog, for building your own interface. It returns `ask`, `stop` and `reset`, plus `status` (`idle`, `loading`, `streaming`, `done` or `error`), `question`, `answer`, `sources`, `refused`, `truncated`, `retrieval` and `error`. `error.kind` is `rate-limited`, `http`, `network` or `stream`, with `retryAfter` for rate limits. `stop()` keeps the partial answer.

`AskAnswer` renders an answer with clickable citations from `answer` and `sources`. It renders a small Markdown subset, never HTML, and only turns `[n]` into a link when source `n` exists.
