/**
 * `@botmesh/voice/internal` — the building blocks of the voice plugin: the STT/TTS config
 * resolvers, audio sniffing and duration estimates, the MIME tables of the TTS services and
 * the punctuation trimmer `autoTranscribe` applies to `ctx.body`. **No semver guarantee:**
 * any of them may change or disappear in a minor release. Applications use `voicePlugin`,
 * `VoiceClient` and the adapters from `@botmesh/voice`.
 *
 * @example
 * ```ts
 * import { sniffMimetype, estimateDurationSec } from '@botmesh/voice/internal'
 * ```
 *
 * @packageDocumentation
 */

export { trimPunctuation } from './plugin.js'
export { resolveStt, resolveTts } from './resolve.js'
export { OPENAI_TTS_MIMETYPES } from './tts/openai.js'
export { elevenLabsMimetype } from './tts/elevenlabs.js'
export { estimateOggDurationSec, estimateDurationSec, sniffMimetype } from './audio.js'
