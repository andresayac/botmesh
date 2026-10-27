---
'@botmesh/mongo-store': patch
---

An array of objects stored under a key named after an `Object.prototype` member (`constructor`, `toString`, `valueOf`, `hasOwnProperty`…) in a checkpoint's `c.state`, a message or chat `raw` payload or an AI history entry read back as raw BSON `Buffer`s instead of objects (a js-bson lookup in the driver's default `fieldsAsRaw` map). Every read now passes an empty null-prototype `fieldsAsRaw`, with the 6.x and 7.x drivers. A store that created its own client and was stopped now rejects calls with `MongoStore is stopped — call start() before using it` instead of the driver's "Client must be connected" error.
