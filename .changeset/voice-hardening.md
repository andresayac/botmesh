---
'@botmesh/voice': patch
---

Harden `@botmesh/voice`: a per-call `timeoutMs` on `transcribe`/`synthesize` is now honoured (it can only tighten `limits.timeoutMs`); `limits` are validated at `plug()` with a `VoiceConfigError` naming the field (an `Infinity`, `0`, negative or `NaN` `timeoutMs` used to time out at once) and `client.limits` is frozen; Deepgram no longer sends an inbound mimetype with line breaks or garbage as `Content-Type` (it made the whole transcription fail); `sk_…` keys are redacted from service error details like `sk-…`; `Uint8Array` audio is accepted; a throwing `autoTranscribe.filter` / `autoReplyWithVoice.filter` is logged and skips instead of dropping the message or failing the send.
