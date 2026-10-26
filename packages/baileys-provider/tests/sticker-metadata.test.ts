/**
 * `ctx.sticker(media, { pack, author })` is documented to set the sticker's
 * pack name and author. WhatsApp reads them from an EXIF chunk in the WebP
 * (tag 0x5741 holding a JSON blob); without it the options were dropped.
 */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { makeSticker } from '../src/MediaProcessor.js'

function chunks(webp: Buffer): Array<{ id: string; data: Buffer }> {
  expect(webp.toString('ascii', 0, 4)).toBe('RIFF')
  expect(webp.readUInt32LE(4)).toBe(webp.length - 8)
  expect(webp.toString('ascii', 8, 12)).toBe('WEBP')
  const out: Array<{ id: string; data: Buffer }> = []
  let o = 12
  while (o < webp.length) {
    const size = webp.readUInt32LE(o + 4)
    out.push({ id: webp.toString('ascii', o, o + 4), data: webp.subarray(o + 8, o + 8 + size) })
    o += 8 + size + (size & 1)
  }
  expect(o).toBe(webp.length)
  return out
}

function stickerJson(webp: Buffer): Record<string, unknown> {
  const exif = chunks(webp).find((c) => c.id === 'EXIF')!.data
  expect(exif.subarray(0, 4)).toEqual(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
  expect(exif.readUInt16LE(10)).toBe(0x5741)
  const length = exif.readUInt32LE(14)
  return JSON.parse(exif.subarray(22, 22 + length).toString('utf8')) as Record<string, unknown>
}

const image = (width: number, height: number, alpha: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 30, b: 30, alpha } } }).png().toBuffer()

describe('sticker pack metadata', () => {
  it('embeds pack and author in an EXIF chunk WhatsApp reads, keeping the image decodable', async () => {
    for (const input of [await image(30, 10, 1), await image(512, 512, 1), await image(64, 64, 0.5)]) {
      const webp = await makeSticker(input, { pack: 'Mi Pack 🍕', author: 'Ñandú "bot"' })
      const ids = chunks(webp).map((c) => c.id)
      expect(ids[0]).toBe('VP8X')
      expect(chunks(webp)[0]!.data[0]! & 0x08).toBe(0x08) // EXIF flag
      const json = stickerJson(webp)
      expect(json['sticker-pack-name']).toBe('Mi Pack 🍕')
      expect(json['sticker-pack-publisher']).toBe('Ñandú "bot"')
      expect(typeof json['sticker-pack-id']).toBe('string')
      const meta = await sharp(webp).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512])
    }
  })

  it('leaves the WebP untouched without pack or author', async () => {
    const webp = await makeSticker(await image(30, 10, 1))
    expect(chunks(webp).map((c) => c.id)).not.toContain('EXIF')
  })
})
