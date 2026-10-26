/**
 * `JsonValue`: the JSON-safe value type shared by the production contracts that persist data
 * (`SerializedMediaRef.data`, the durability journal records) and by golden transcripts.
 */

/** Any JSON value: what `JSON.stringify` / `JSON.parse` round-trip unchanged. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
