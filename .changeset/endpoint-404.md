---
'ask-my-site': patch
---

Explain a missing endpoint. When the ask endpoint answers 404, the dialog now says "Answers aren’t available here right now." instead of "The request failed (404).", and other errors without a message read "Something went wrong (502). Please try again." In development (a dev build, or a page on localhost) a 404 also logs a console warning with the full URL the dialog posted to and a pointer to the setup docs.
