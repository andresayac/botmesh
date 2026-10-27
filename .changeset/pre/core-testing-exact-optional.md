---
"@botmesh/core": patch
---

`ChaosProvider` and `RecordingProvider` (`@botmesh/core/testing`) implement `IProvider` again under `exactOptionalPropertyTypes` with `skipLibCheck: false`: their optional delegated members (`ingest`, `downloadMedia`, `typing`…) were typed `X | undefined`, which broke the consumer's build with TS2420 inside the published `.d.ts`.
