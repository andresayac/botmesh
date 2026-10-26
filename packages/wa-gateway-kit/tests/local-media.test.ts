/** A local media path that cannot be read rejects with a typed, actionable error, not a raw ENOENT. */
import { describe, expect, it } from 'vitest'
import { UnsupportedContentError } from '@botmesh/core'
import { resolveMedia } from '../src/index.js'

describe('resolveMedia with an unreadable local path', () => {
  it('rejects with UnsupportedContentError naming the path and the cause (string or { path })', async () => {
    for (const source of ['./no/such/file.png', { path: './no/such/file.png' }]) {
      const err = await resolveMedia('image', source).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(UnsupportedContentError)
      expect((err as Error).message).toMatch(/a readable file \(ENOENT\)/)
      expect((err as Error).message).toContain('file.png')
      expect((err as { cause?: { code?: string } }).cause?.code).toBe('ENOENT')
    }
  })
})
