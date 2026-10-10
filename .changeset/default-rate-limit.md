---
'ask-my-site': minor
---

`createAskHandler` now rate-limits by default: without a `rateLimit`, each client IP gets 10 questions a minute through `memoryRateLimit()`, keyed by the last `X-Forwarded-For` entry as on Vercel. Pass your own limiter to change it (for example `memoryRateLimit({ trustedHeader: 'cf-connecting-ip' })` on Cloudflare), or `rateLimit: false` to turn it off when something in front of the endpoint already limits it. Requests without an `X-Forwarded-For` header share one bucket, so on a platform that does not set it the default is a single limit for all visitors, and the handler reports the first such request to `onError` with the setting to change. `ask-my-site dev` answers up to 30 questions a minute. The Vercel and Cloudflare recipes in the README now show their rate limit, as the Netlify one did.
