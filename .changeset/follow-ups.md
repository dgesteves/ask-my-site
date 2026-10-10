---
'ask-my-site': minor
---

Follow-up questions. The dialog keeps the thread and sends it with each question as `{ messages }`; the handler rewrites a follow-up that leans on the conversation ("and on Netlify?") into a question that stands on its own, with one short model call, before retrieval, the relevance gate, the answer cache and the answer. A question that already stands on its own is not rewritten. The rewrite counts against `budget`, can use a model of its own (`followUps.model`), and `followUps: false` keeps the single-question behavior; `onFinish` gets the rewritten question as `followUp`. In the dialog, earlier questions and answers stay above the current one with their own citations, typing offers "Follow up", and "New question" starts over. `useAsk` returns the thread as `turns`.
