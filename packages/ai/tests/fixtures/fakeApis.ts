/**
 * A tiny local stand-in for the Anthropic Messages, OpenAI Chat Completions and Gemini
 * generateContent HTTP APIs (127.0.0.1, random port), so the REAL SDKs can be driven
 * end to end without network or credentials. It answers text, one `stock` tool call
 * when tools are offered, the tool result echoed back, and SSE streams.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeApis {
  base: string
  /** Every request body received, with its URL and headers. */
  requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, unknown> }>
  close(): Promise<void>
}

type Json = Record<string, unknown>

export async function startFakeApis(): Promise<FakeApis> {
  const requests: FakeApis['requests'] = []
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const url = req.url ?? ''
      const body = (raw ? JSON.parse(raw) : {}) as Json
      requests.push({ url, body, headers: req.headers })
      const json = (value: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
      const sse = (events: string[]) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write(e); res.end() }

      if (url.startsWith('/v1/messages')) {
        const last = (body.messages as Json[]).at(-1)!
        const result = Array.isArray(last.content) ? (last.content as Json[]).find((b) => b.type === 'tool_result') : undefined
        if (body.stream) {
          const ev = (type: string, data: Json) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
          return sse([
            ev('message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } }),
            ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
            ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hola ' } }),
            ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'stream' } }),
            ev('content_block_stop', { index: 0 }),
            ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }),
            ev('message_stop', {}),
          ])
        }
        const content = body.tools && !result
          ? [{ type: 'tool_use', id: 'toolu_1', name: 'stock', input: { q: 'pan' } }]
          : [{ type: 'text', text: result ? `tool said ${String(result.content)}` : 'hola anthropic' }]
        return json({ id: 'm1', type: 'message', role: 'assistant', model: body.model, content, stop_reason: content[0]!.type === 'tool_use' ? 'tool_use' : 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } })
      }

      if (url.startsWith('/v1/chat/completions')) {
        const last = (body.messages as Json[]).at(-1)!
        if (body.stream) {
          const chunk = (delta: Json, fin: string | null = null) =>
            `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`
          return sse([chunk({ role: 'assistant', content: 'Hola ' }), chunk({ content: 'openai' }), chunk({}, 'stop'), 'data: [DONE]\n\n'])
        }
        const message = body.tools && last.role !== 'tool'
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'stock', arguments: '{"q":"pan"}' } }] }
          : { role: 'assistant', content: last.role === 'tool' ? `tool said ${String(last.content)}` : 'hola openai' }
        return json({ id: 'c', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })
      }

      if (url.includes(':generateContent') || url.includes(':streamGenerateContent')) {
        const last = (body.contents as Json[]).at(-1)!
        const response = ((last.parts as Json[] | undefined)?.[0]?.functionResponse as Json | undefined)?.response
        const parts = body.tools && !response
          ? [{ functionCall: { name: 'stock', args: { q: 'pan' } } }]
          : [{ text: response ? `tool said ${JSON.stringify(response)}` : 'hola gemini' }]
        const usageMetadata = { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 }
        if (url.includes(':streamGenerateContent')) {
          return sse([
            `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Hola ' }] }, index: 0 }] })}\r\n\r\n`,
            `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'gemini' }] }, finishReason: 'STOP', index: 0 }], usageMetadata })}\r\n\r\n`,
          ])
        }
        return json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }], usageMetadata })
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"not found"}}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(() => r())) },
  }
}
