---
title: The ask dialog
description: AskDialog props, the useAsk hook, theming and accessibility.
order: 7
---

`AskDialog` is a command palette built on Radix Dialog and cmdk. `useAsk` is the hook behind it, for building your own interface.

## Opening the dialog

The dialog opens with ⌘K on macOS and Ctrl+K elsewhere. Change the key with `shortcut`, or pass `shortcut={false}` and a `trigger` element such as a search button.

## Citations and navigation

Citations in the answer and entries in the sources list are links to the exact section. Pass `onNavigate` to route with your framework's client router, for example `router.push(url)` in Next.js. The dialog closes after a click either way.

## Accessibility

Focus moves into the dialog when it opens and returns to the previously focused element when it closes. The answer region is `aria-live="polite"` and `aria-busy` while text streams, and a separate status region announces when the answer is ready. All animation is disabled under `prefers-reduced-motion`.

## Theming

Import `ask-my-site/react/styles.css` for the default theme, which follows the system light or dark setting. Every color, radius and font is a CSS custom property, so `.ask-dialog { --ask-accent: #7c3aed; }` is a complete rebrand. To style from scratch, skip the stylesheet: every part has a stable `ask-*` class, and `classNames` adds your own classes, which suits Tailwind.

## The useAsk hook

`useAsk()` returns `ask`, `stop` and `reset`, plus the current `status`, `question`, `answer`, `sources`, `refused` flag, `truncated` flag (the answer hit the model's output limit) and a typed `error`. Errors distinguish rate limiting, HTTP failures, network failures and interrupted streams. Closing the dialog stops the answer in flight.
