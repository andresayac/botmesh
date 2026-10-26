---
'@botmesh/core': patch
---

Durable scheduler: a slot that fell due while the previous occurrence was still running (a handler slower than the interval, or an occurrence claimed late after a fail-over) was silently dropped, even with `missed: 'catch-up'` or `'run-once'`. Under those policies it is now claimed next and goes through the policy (run normally within the grace period, otherwise as missed). `'skip'` is unchanged.
