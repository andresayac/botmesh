---
'@botmesh/redis-store': patch
---

Checkpoint compare-and-set (`setCheckpointIf` / `clearCheckpointIf`, used with `BotConfig.coordination`) no longer depends on Redis' cjson decoding the stored checkpoint. A `c.state` holding a lone UTF-16 surrogate (a message cut in the middle of an emoji) made cjson fail, the stored revision read as 0 and every later write of that conversation was refused as if another replica owned it. The scripts now report an undecodable value and the store decides in JS, writing only while the key still holds the exact string it read. Both layouts (legacy and cluster).
