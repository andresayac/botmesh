---
'@botmesh/core': patch
---

Durability with coordination: when another replica took a parked conversation, the reply to the waking message was keyed under the previous turn's causation, colliding with the outbox record of the question asked before the hand-over. With `durability.outbox.onDiverged: 'skip'` that reply was never sent (the user got no answer); with the default `'send'` it went out but counted a false `outboxDiverged` and logged a warning. The waking message now keys the sends that answer it, as on a live delivery.
