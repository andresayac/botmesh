---
"@botmesh/tickets": patch
---

Input validation and clearer errors: `update()` rejects a non-string `subject`, `close()` a non-string `reason`, and `create()`/`update()` reject a `meta` that is not a plain JSON object (before any write, so no ticket id is consumed); a property set to `undefined` is still accepted and dropped, as JSON does, while `undefined` inside an array is rejected. `new TicketDesk()` without a usable `storage` and `isOpen()`/`isWithinWorkingHours()` with an invalid `Date` throw a `TypeError` that says what to pass. A stored value that is not valid JSON makes the call reject with an error naming the storage key. Message templates only read the ticket's own fields (`{{constructor}}` renders empty), and a working-hours window can no longer start at `24:00`.
