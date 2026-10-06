---
'ask-my-site': patch
---

Security and robustness fixes before the first release:

- Rate limits key on one client IP header: the last `X-Forwarded-For` entry by default, or the header your platform sets via the new `trustedHeader` option. A client can no longer pick its own key by sending another platform's header. See "Rate limits and client IPs" in the README.
- Prompts wrap sources and the question in tags with a random per-request suffix, and pass content through verbatim (`<source>` elements in docs are no longer rewritten).
- The handler answers 415 to bodies that are not `application/json`, so other sites cannot post to it without a CORS preflight.
- A throwing `rateLimit` gets a JSON 503 by default (`rateLimitFailure: 'open'` answers anyway), a throwing `onFinish` no longer turns into a stream error, and generation timeouts are reported to `onError`.
- `useAsk` exposes `truncated` for answers cut off at the output limit, and `AskDialog` says so and cancels the request when it closes.
- `safeHref` allows bare relative URLs such as `docs/a`.
- The CLI never ignores `--dimensions`; file names are NFC-normalized, symlinks are followed, and `--ignore` no longer relies on the experimental `path.matchesGlob` on Node 22.
- Loaders run in linear time on unclosed tags, labels and comments, and heading anchors match github-slugger exactly.
- `@radix-ui/react-dialog` and `cmdk` are optional peer dependencies: install them to use `ask-my-site/react`.
