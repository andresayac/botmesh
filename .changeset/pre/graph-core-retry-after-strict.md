---
'@botmesh/graph-core': patch
---

`readGraphResponse()` parses the `Retry-After` HTTP-date strictly (IMF-fixdate, RFC 850 and asctime, all as GMT): garbage such as `abc 5`, which the engine's lenient date parser read as a date in 2001 and so as "retry now", falls back to the code's default again. A huge value (seconds or date) is capped at 24 hours, so it can never overflow `setTimeout` and turn a rate limit into an immediate retry storm.
