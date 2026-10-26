/**
 * Shared instrument settings: histogram bucket boundaries that fit each unit (the SDK's
 * default boundaries, 0–10000, are meant for milliseconds and would put every duration in
 * seconds in the first bucket) and validation of the metric name prefix.
 */

/** Latency in seconds: 5 ms … 10 s (OpenTelemetry's HTTP semantic conventions). */
export const LATENCY_BUCKETS_S: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]

/** Model call duration in seconds (GenAI semantic conventions). */
export const GEN_AI_DURATION_BUCKETS_S: readonly number[] = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92]

/** Token counts (GenAI semantic conventions). */
export const GEN_AI_TOKEN_BUCKETS: readonly number[] = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864]

/** Conversation duration in seconds: 1 s … 1 day. */
export const CONVERSATION_BUCKETS_S: readonly number[] = [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 21600, 86400]

/** `advice` for a histogram with these boundaries. */
export const buckets = (boundaries: readonly number[]): { advice: { explicitBucketBoundaries: number[] } } =>
  ({ advice: { explicitBucketBoundaries: [...boundaries] } })

/** OpenTelemetry instrument name syntax, applied to the prefix (the rest of each name is ours). */
const PREFIX = /^[A-Za-z][A-Za-z0-9_.\-/]{0,200}$/

/** Throw a clear error for a prefix that would make invalid instrument names (the SDK only warns through its diag logger). */
export function assertMetricPrefix(prefix: string, option: string): void {
  if (typeof prefix !== 'string' || !PREFIX.test(prefix)) {
    throw new TypeError(
      `@botmesh/otel: ${option} ${JSON.stringify(prefix)} is not a valid metric name prefix: ` +
      'it must start with a letter and contain only letters, digits, ".", "_", "-" or "/" (e.g. "botmesh" or "acme.bot")',
    )
  }
}
