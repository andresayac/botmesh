---
"@botmesh/ai": major
"@botmesh/baileys": major
"@botmesh/meta": major
"@botmesh/telegram": major
"@botmesh/sqlite-store": major
"@botmesh/redis-store": major
"@botmesh/http": major
"@botmesh/graph-core": major
"create-botmesh": major
---

First stable line: the public API of this package is frozen and covered by semver from 1.0.0 (alongside `@botmesh/core` 2.0.0). The breaking changes made during the alpha are listed in the other notes of this release and in the stable migration guides. `@botmesh/baileys` ships stable on the exact `@whiskeysockets/baileys` `7.0.0-rc14` pin, which is upstream's npm `latest` tag (there is no stable Baileys 7.x); moving to a newer upstream release is a minor or patch of `@botmesh/baileys` unless its public API changes (see the README's upstream upgrade policy).
