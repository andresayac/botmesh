/** A local image path that cannot be read rejects with a typed, actionable error, not a raw ENOENT. */
import { describe, expect, it } from 'vitest'
import { UnsupportedContentError } from '@botmesh/core'
import { TikTokProvider } from '../src/TikTokProvider.js'

describe('an unreadable local image path', () => {
  it('rejects with UnsupportedContentError naming the cause', async () => {
    const provider = new TikTokProvider({ accessToken: 't', businessId: 'b', appSecret: 's', selfUniqueIdentifier: 'u' })
    const mediaId = (provider as unknown as { mediaId(source: unknown): Promise<string> }).mediaId.bind(provider)
    const err = await mediaId({ path: './no/such/photo.png' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnsupportedContentError)
    expect((err as Error).message).toMatch(/a readable file \(ENOENT\)/)
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('ENOENT')
  })
})
