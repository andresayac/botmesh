export { RedisStore } from './RedisStore.js'
export type {
  RedisStoreOptions,
  RedisLikeClient,
  RedisZRangeOptions,
  NativeRedisClient,
  RedisMulti,
} from './RedisStore.js'
export { RedisCoordinator } from './RedisCoordinator.js'
export type { RedisCoordinatorOptions, CoordinatorClient } from './RedisCoordinator.js'
export { RedisScheduleStore } from './schedules.js'
export type { RedisScheduleStoreOptions } from './schedules.js'
export { RedisLeaseProvider } from './lease.js'
export type { RedisLeaseProviderOptions } from './lease.js'
export { RedisDurability, RedisDurableKv } from './durability.js'
export type { RedisDurabilityOptions } from './durability.js'
export { isRedisClusterClient, withClusterRetry } from './client.js'
export type { AnyRedisClient, NativeRedisClusterClient, RedisClusterConnectOptions, ClusterRetryOptions } from './client.js'
export type { RedisKeyLayout } from './layout.js'
// Key-layout internals: their home is `@botmesh/redis-store/internal` (no semver).
export {
  /** @deprecated Import from '@botmesh/redis-store/internal' (no semver); removed from the main entry in the next major. */
  INDEX_BUCKETS,
  /** @deprecated Import from '@botmesh/redis-store/internal' (no semver); removed from the main entry in the next major. */
  LAYOUT_MARKER,
  /** @deprecated Import from '@botmesh/redis-store/internal' (no semver); removed from the main entry in the next major. */
  bucketOf,
  /** @deprecated Import from '@botmesh/redis-store/internal' (no semver); removed from the main entry in the next major. */
  encodeSegment,
} from './layout.js'
export {
  /** @deprecated Import from '@botmesh/redis-store/internal' (no semver); removed from the main entry in the next major. */
  hashSlot,
} from './slot.js'
export { migrateToClusterLayout, inspectKeyspace } from './migrate.js'
export type { MigrateKeyspaceOptions, MigrationReport, KeyspaceNamespace, KeyspaceInspection } from './migrate.js'
