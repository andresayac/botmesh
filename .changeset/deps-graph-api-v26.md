---
'@botmesh/graph-core': minor
'@botmesh/meta': minor
---

**Breaking (default): Graph API v26.0.** The Meta providers now call Graph API `v26.0` by default (it was `v21.0`, which Meta retires on 2027-01-21). The default lives in the new `DEFAULT_GRAPH_API_VERSION` export of `@botmesh/graph-core` and follows Meta's current version; the send and webhook payloads the providers use did not change between v21.0 and v26.0. Pass `apiVersion` to stay on a version (`apiVersion: 'v21.0'` restores the previous behaviour).

- `@botmesh/meta`: WhatsApp's `played` status (a voice note was listened to) is now reported as a `read` status with `platformData.played: true`; it used to be dropped. Statuses without the `conversation` object (Graph v24.0+) keep working.
