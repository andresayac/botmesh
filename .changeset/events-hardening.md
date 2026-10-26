---
"@botmesh/events": patch
---

File journals reject an envelope JSON cannot hold (a `BigInt`, a circular reference) with a clear `TypeError` instead of keeping it in memory and failing every later write; what they read back is the JSON form they wrote. `MemoryEventJournal` stores a copy of the envelope. `EventWorker` validates its options and the journals validate their time, duration and limit arguments before changing anything, so a `NaN` can no longer strand a record. `createEnvelope` names the missing field, a damaged snapshot or append-log entry is refused with an error naming the file and the bad record, and a closed `FileEventJournal` no longer applies a write in memory that it then rejects.
