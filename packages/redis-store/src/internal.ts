/**
 * `@botmesh/redis-store/internal` — the key-layout internals.
 *
 * Key builders of both layouts (`storeKeys`, `coordKeys`, `scheduleKeys`, `userDataKeys`),
 * the cluster layout's bucket and segment encoding (`bucketOf`, `encodeSegment`,
 * `INDEX_BUCKETS`, `LAYOUT_MARKER`) and the CRC16 hash-slot helpers (`hashSlot`,
 * `hashTagOf`, `assertOneSlot`). They are exported for tooling that inspects or repairs a
 * keyspace and for the monorepo's own tests. **No semver guarantee:** any of them may change
 * or disappear in a minor release. Applications pick the layout with the `layout` option and
 * move a keyspace with `migrateToClusterLayout()` from `@botmesh/redis-store`.
 *
 * @example
 * ```ts
 * import { bucketOf, hashSlot, storeKeys } from '@botmesh/redis-store/internal'
 * ```
 *
 * @packageDocumentation
 */

export {
  INDEX_BUCKETS,
  LAYOUT_MARKER,
  assertLayoutPrefix,
  bucketOf,
  coordKeys,
  encodeSegment,
  scheduleKeys,
  storeKeys,
  userDataKeys,
} from './layout.js'
export type { CoordKeys, IndexedKind, ScheduleKeys, StoreKeys, UserDataKeys } from './layout.js'
export { assertOneSlot, hashSlot, hashTagOf } from './slot.js'
