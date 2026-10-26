/**
 * `@botmesh/dialogflow/internal` — the building blocks of the Dialogflow client: the ES and
 * CX result normalizers, the session-id hash, and the service-account helpers (credential
 * parsing, the signed JWT assertion, the OAuth scope and token endpoint). **No semver
 * guarantee:** any of them may change or disappear in a minor release. Applications use
 * `dialogflowPlugin`, `whenDialogflowIntent`, `DialogflowClient` and
 * `ServiceAccountTokenSource` from `@botmesh/dialogflow`.
 *
 * @example
 * ```ts
 * import { normalizeEsResult, toSessionId } from '@botmesh/dialogflow/internal'
 * ```
 *
 * @packageDocumentation
 */

export { normalizeCxResult, normalizeEsResult, toSessionId } from './client.js'
export { DIALOGFLOW_SCOPE, DEFAULT_TOKEN_URI, createServiceAccountJwt, parseCredentials } from './auth.js'
