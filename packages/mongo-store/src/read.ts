/**
 * Driver read options shared by MongoStore and its `ctx.user` collection.
 */

/**
 * Read options: return BSON Binary as Node Buffers, not the driver's `Binary` class, and an
 * empty null-prototype `fieldsAsRaw`. js-bson looks every field name up in that map with a
 * plain `map[name]`, and the driver's default is an ordinary object, so an array named after
 * an `Object.prototype` member (`c.state.constructor = [{…}]`, a `toString` key in a raw
 * payload or in AI tool arguments) would read back with its documents as raw BSON Buffers.
 */
export const READ = { promoteBuffers: true, fieldsAsRaw: Object.freeze(Object.create(null) as Record<string, never>) } as const
