---
'@botmesh/telegram': minor
---

`pollTimeoutMs` (milliseconds, sent to `getUpdates` in whole seconds) replaces `pollTimeout` (seconds), which stays as a deprecated alias; setting both to different values throws. The error mapper is now `toTelegramError` (`toProviderError` is a deprecated alias), the `debug` option is deprecated in favour of `logger`, and the wire helpers `parseUpdate`, `toOutbound` and `MEDIA_UPLOAD` are labelled `@experimental`.
