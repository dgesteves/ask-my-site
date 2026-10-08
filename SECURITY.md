# Security

Report a vulnerability privately, through [GitHub's private vulnerability reporting](https://github.com/dgesteves/ask-my-site/security/advisories/new), not in a public issue. Include the version of `ask-my-site`, which part (handler, dialog, embed, plugin, CLI or `ask-my-site dev`) and a reproduction.

Fixes ship in the latest release only. The handler faces the internet and the dialog renders model output, so these count as vulnerabilities:

- an answer, citation or source that runs script in the dialog or the embed, renders raw HTML, or links to a `javascript:` or `data:` URL;
- a request that gets past the handler's input validation, body-size cap or rate limit;
- the handler or `ask-my-site dev` exposing an API key, a provider's error details, or files outside the index.
