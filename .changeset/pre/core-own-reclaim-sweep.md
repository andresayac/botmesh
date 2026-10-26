---
'@botmesh/core': patch
---

Durability: the first sweep of a restarted replica (same `instanceId`) re-claimed its own `sending` outbox records to catch its dead incarnation's late writes, but it could also re-claim a send the NEW incarnation had just claimed while replaying a recovered message. That send's completion then carried a superseded fencing token: the message was delivered, but its outbox record stayed `sending` until the 60 s lease expired (seen as an intermittent timeout of the Redis Cluster crash matrix). The sweep now re-claims only own leases taken before `recover()` (`OutboxClaimOptions.reclaimOwnBefore`, honoured by every `DurableKv`-based journal); a journal that ignores the new option behaves as before.
