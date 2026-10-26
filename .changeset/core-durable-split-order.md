---
'@botmesh/core': patch
---

Durable outbox and long text: a later part of a split text (`key#2`, `key#3`…) no longer overtakes an earlier part that is waiting for a retry (it waits behind it, and is dead-lettered with it), and the sweeper splits a journaled record whose text is over the channel's limit with the same splitter (first part under the record's key, the rest journaled first as `key#2`…; deterministic keys, so a retry or a second pass sends nothing twice).
