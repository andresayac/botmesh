---
'@botmesh/voice': patch
---

`maxDurationSec` can no longer be bypassed with a misleading mimetype: the OGG duration is read whenever the bytes start with `OggS`, whatever mimetype the sender declares (`audio/mpeg`, `video/mp4`, a value with line breaks...). Before, only declared OGG mimetypes were checked and the paid STT call went ahead. `estimateDurationSec` from `@botmesh/voice/internal` no longer takes a mimetype.
