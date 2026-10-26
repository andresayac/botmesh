/**
 * Concrete node-redis client types for the real-server suites. The package only declares a
 * minimal shape for the clients it accepts (`NativeRedisClient`); the suites also call
 * commands directly. At run time the major comes from BOTWA_TEST_REDIS_CLIENT (see
 * vitest.config.ts); the types are those of the `redis` devDependency.
 */
import { createClient, createCluster } from 'redis'

const makeClient = (url: string) => createClient({ url })
const makeCluster = (options: Parameters<typeof createCluster>[0]) => createCluster(options)

/** A node-redis single-node client, as the suites use it. */
export type NodeRedisClient = ReturnType<typeof makeClient>
/** A node-redis cluster client, as the suites use it. */
export type NodeRedisCluster = ReturnType<typeof makeCluster>

/** The node-redis major the suites run with (`BOTWA_TEST_REDIS_CLIENT`, default v6). */
export const REDIS_CLIENT_MAJOR = process.env.BOTWA_TEST_REDIS_CLIENT ?? 'v6'
