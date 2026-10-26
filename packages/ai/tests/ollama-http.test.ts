/**
 * The Ollama provider over real HTTP: a small fake `/api/chat` server on 127.0.0.1
 * (random port) driven through `aiPlugin({ provider: 'ollama', baseUrl })`, the way a
 * user wires it — one-shot answers, NDJSON streaming, tool calls, server errors, a hung
 * server cut by `timeoutMs` (its socket closed), and `bot.stop()` closing a live stream.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTestBot } from '@botmesh/core/testing'
import { aiPlugin } from '../src/plugin.js'
import type { AIToolSet } from '../src/tools/types.js'

type Handler = (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) => void

let server: Server
let baseUrl = ''
let handler: Handler = (_b, _q, res) => { res.end('{}') }
const requests: Array<Record<string, unknown>> = []
let closedSockets = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>
      requests.push(body)
      res.on('close', () => { if (!res.writableFinished) closedSockets++ })
      handler(body, req, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}
const lastUser = (body: Record<string, unknown>) => {
  const msgs = body.messages as Array<{ role: string; content: string }>
  return msgs.filter((m) => m.role === 'user').at(-1)?.content ?? ''
}

describe('Ollama over HTTP (fake server)', () => {
  it('answers through the autoresponder, sending the persona, history and model', async () => {
    requests.length = 0
    handler = (body, _q, res) => json(res, 200, { model: body.model, message: { role: 'assistant', content: `**eco**: ${lastUser(body)}` }, done: true, done_reason: 'stop' })
    const t = await createTestBot({}, { provider: { textFormat: 'whatsapp' } })
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', persona: 'Panadería' }))
    await t.chat.send('hola 🥐')
    await t.chat.expectReply('*eco*: hola 🥐', 3000)
    await t.chat.send('segunda')
    await t.chat.expectReply('*eco*: segunda', 3000)
    const last = requests.at(-1)!
    expect(last.model).toBe('tiny')
    expect(last.stream).toBe(false)
    expect(last).not.toHaveProperty('options') // no num_predict unless maxTokens is set
    expect((last.messages as unknown[])).toHaveLength(4) // system + user + assistant + user
    await t.bot.stop()
  })

  it('sends aiPlugin({ apiKey }) as a Bearer token (Ollama Cloud, authenticated proxies), and none without it', async () => {
    const auth: Array<string | undefined> = []
    handler = (body, req, res) => { auth.push(req.headers.authorization); json(res, 200, { model: body.model, message: { content: 'ok' }, done: true }) }
    const withKey = await createTestBot()
    withKey.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', apiKey: 'sk-ollama-test' }))
    await withKey.chat.send('hola')
    await withKey.chat.expectReply('ok', 3000)
    await withKey.bot.stop()
    const without = await createTestBot()
    without.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny' }))
    await without.chat.send('hola')
    await without.chat.expectReply('ok', 3000)
    await without.bot.stop()
    expect(auth).toEqual(['Bearer sk-ollama-test', undefined])
  })

  it('streams NDJSON chunks with ctx.stream()', async () => {
    handler = (_body, _q, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      const parts = ['Hola', ', ', 'mundo', ' 🌍']
      let i = 0
      const tickOnce = () => {
        if (i < parts.length) { res.write(JSON.stringify({ message: { content: parts[i++] }, done: false }) + '\n'); setTimeout(tickOnce, 5) }
        else res.end(JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }))
      }
      tickOnce()
    }
    const t = await createTestBot({}, { provider: { streaming: 'edit' } })
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', stream: true }))
    await t.chat.send('saluda')
    await new Promise((r) => setTimeout(r, 300))
    const shown = [...t.chat.replies(), ...t.provider.edits.map((e) => (e.content as { text?: string }).text ?? '')]
    expect(shown.some((s) => s.includes('Hola, mundo 🌍'))).toBe(true)
    await t.bot.stop()
  })

  it('runs native tool calls and feeds the result back', async () => {
    requests.length = 0
    handler = (body, _q, res) => {
      const msgs = body.messages as Array<{ role: string; content: string }>
      if (msgs.at(-1)?.role === 'tool') return json(res, 200, { model: 'tiny', message: { content: `Hay: ${msgs.at(-1)!.content}` }, done: true, done_reason: 'stop' })
      json(res, 200, { model: 'tiny', message: { content: '', tool_calls: [{ function: { name: 'stock', arguments: { producto: 'pan' } } }] }, done: true, done_reason: 'stop' })
    }
    const tools: AIToolSet = {
      stock: {
        description: 'Stock de un producto',
        schema: { type: 'object', properties: { producto: { type: 'string' } }, required: ['producto'] },
        handler: ({ producto }: { producto: string }) => `${producto}: 12`,
      },
    }
    const t = await createTestBot()
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', tools }))
    await t.chat.send('¿hay pan?')
    await t.chat.expectReply('Hay: pan: 12', 3000)
    expect((requests[0]!.tools as unknown[])).toHaveLength(1)
    await t.bot.stop()
  })

  it('a server error (model not found) answers errorMessage and logs the server text', async () => {
    handler = (_b, _q, res) => json(res, 404, { error: 'model "tiny" not found, try pulling it first' })
    const errors: unknown[] = []
    const logger = { debug() {}, info() {}, error() {}, warn: (o: unknown) => { errors.push(o) }, child() { return logger } }
    const t = await createTestBot({ logger })
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', errorMessage: 'sin IA' }))
    await t.chat.send('hola')
    await t.chat.expectReply('sin IA', 3000)
    expect(errors.map((e) => String((e as { err?: Error }).err?.message)).join()).toMatch(/HTTP 404.*not found, try pulling it first/)
    await t.bot.stop()
  })

  it('a hung server is cut by timeoutMs and its socket is closed', async () => {
    handler = () => { /* never answers */ }
    closedSockets = 0
    const t = await createTestBot()
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', timeoutMs: 100, errorMessage: 'tarda' }))
    await t.chat.send('hola')
    await t.chat.expectReply('tarda', 3000)
    await new Promise((r) => setTimeout(r, 50))
    expect(closedSockets).toBe(1)
    await t.bot.stop()
  })

  it('bot.stop() closes a stream that is still running', async () => {
    handler = (_b, _q, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content: 'empieza…' }, done: false }) + '\n')
      // …and never ends.
    }
    closedSockets = 0
    const t = await createTestBot({}, { provider: { streaming: 'edit' } })
    t.bot.plug(aiPlugin({ provider: 'ollama', baseUrl, model: 'tiny', stream: true, timeoutMs: 0 }))
    await t.chat.send('cuenta algo largo')
    await new Promise((r) => setTimeout(r, 100))
    await t.bot.stop()
    await new Promise((r) => setTimeout(r, 100))
    expect(closedSockets).toBe(1)
  })
})
