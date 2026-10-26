/**
 * The Graph API version the Meta providers call by default.
 *
 * Meta releases a Graph version two to three times a year and retires each one about
 * two years later (v21.0, the previous default, expires on 2027-01-21). The default
 * follows the current version and moves in a minor release of the providers, after
 * the webhook and send payloads were checked against Meta's changelog. Pin
 * `apiVersion` in the provider options to stay on a version until you migrate.
 */
export const DEFAULT_GRAPH_API_VERSION = 'v26.0'
