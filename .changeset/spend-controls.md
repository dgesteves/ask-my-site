---
'ask-my-site': minor
---

Add spend controls to `createAskHandler`. `budget: { requestsPerDay, tokensPerDay }` caps the whole endpoint per UTC day, counting model tokens from each answer's `usage` and reserving an answer's worst case before the model is called, so concurrent answers cannot overshoot it; once it is spent, questions get a 429 with code `budget_exceeded`. `answerCache: true` answers a repeated question (compared after normalizing case, spacing and trailing punctuation) without embedding it or calling the model, keyed by the index's content hash so a rebuilt index starts fresh. Both keep their counts and answers in memory by default, and take a shared store: `upstashBudgetStore` and `upstashAnswerCache` adapt `@upstash/redis` without a dependency on it. Rate-limit keys now bucket an IPv6 client by its /64, so rotating addresses within one subscriber's network no longer gets a fresh limit each time, and `useAsk` errors carry the server's `code`.
