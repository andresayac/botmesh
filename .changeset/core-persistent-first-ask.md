---
'@botmesh/core': minor
---

`.persistent()` flows now checkpoint when they start (step 0) as well as after every step: a restart while the first `.ask()` waits resumes the flow there and asks again (it used to be lost unless durability or coordination was on). One more checkpoint write per flow entry.
