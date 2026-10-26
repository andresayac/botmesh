/**
 * @botmesh/twilio — Twilio Programmable Messaging transport for @botmesh/core:
 * WhatsApp + SMS/MMS over the REST API, webhooks verified with X-Twilio-Signature.
 *
 * The main entry is covered by semver. The wire mappers and Twilio resource types
 * live in `@botmesh/twilio/internal` (no semver).
 */

export { TwilioProvider, TWILIO_MAX_BODY } from './TwilioProvider.js'
export type { TwilioIngestRequest } from './TwilioProvider.js'
export { TwilioApiError, toTwilioError } from './errors.js'
export { computeTwilioSignature, verifyTwilioSignature } from './signature.js'
export type { TwilioParams, VerifyTwilioInput } from './signature.js'
export type { HeaderBag, ProviderHttpOptions } from './http.js'
export type { TwilioProviderConfig, TwilioErrorBody, TwilioWebhookParams } from './types.js'
