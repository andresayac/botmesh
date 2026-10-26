import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createMcpServer } from '../src/server.js'
import { serveStdioStreams } from '../src/stdio.js'

const request = (id: number, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })

/** A stdout double: records writes, can report backpressure and emit errors like a broken pipe. */
class FakeStdout extends EventEmitter {
  readonly lines: string[] = []
  full = false
  writableLength = 0
  write(chunk: string): boolean {
    this.lines.push(chunk)
    return !this.full
  }
}

class FakeStderr {
  readonly out: string[] = []
  write(chunk: string): boolean {
    this.out.push(chunk)
    return true
  }
}

/** An input stream fed by hand; `end()` finishes it. */
function controlledInput(): { input: AsyncIterable<string>; push(line: string): void; end(): void } {
  const queue: string[] = []
  let done = false
  let notify: (() => void) | undefined
  return {
    push(line) { queue.push(line); notify?.() },
    end() { done = true; notify?.() },
    input: (async function* stream() {
      for (;;) {
        if (queue.length > 0) { yield queue.shift()!; continue }
        if (done) return
        await new Promise<void>((resolve) => { notify = () => { notify = undefined; resolve() } })
      }
    })(),
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('serveStdioStreams (broken stdout)', () => {
  it('stops writing and keeps serving when stdout emits EPIPE', async () => {
    const stdout = new FakeStdout()
    const stderr = new FakeStderr()
    const feed = controlledInput()
    const done = serveStdioStreams(createMcpServer(), { stdin: feed.input, stdout, stderr })
    feed.push(`${request(1, 'ping')}\n`)
    await tick()
    expect(stdout.lines).toHaveLength(1)

    stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    feed.push(`${request(2, 'ping')}\n${request(3, 'tools/list')}\n`)
    feed.end()
    await done
    expect(stdout.lines).toHaveLength(1)
    expect(stderr.out.filter((line) => line.includes('stdout closed: write EPIPE'))).toHaveLength(1)
  })

  it('waits for drain under backpressure and resumes', async () => {
    const stdout = new FakeStdout()
    const feed = controlledInput()
    stdout.full = true
    const done = serveStdioStreams(createMcpServer(), { stdin: feed.input, stdout, stderr: new FakeStderr() })
    feed.push(`${request(1, 'ping')}\n${request(2, 'ping')}\n`)
    feed.end()
    await tick()
    expect(stdout.lines).toHaveLength(1)
    stdout.full = false
    stdout.emit('drain')
    await done
    expect(stdout.lines.map((line) => JSON.parse(line).id)).toEqual([1, 2])
    expect(stdout.listenerCount('drain')).toBe(0)
  })

  it('does not hang when the pipe breaks while waiting for drain', async () => {
    const stdout = new FakeStdout()
    const feed = controlledInput()
    stdout.full = true
    const done = serveStdioStreams(createMcpServer(), { stdin: feed.input, stdout, stderr: new FakeStderr() })
    feed.push(`${request(1, 'ping')}\n${request(2, 'ping')}\n`)
    feed.end()
    await tick()
    stdout.emit('error', new Error('write EPIPE'))
    await done
    expect(stdout.lines).toHaveLength(1)
    expect(stdout.listenerCount('drain')).toBe(0)
  })

  it('does not hang when stdout closes without an error while waiting for drain', async () => {
    const stdout = new FakeStdout()
    const feed = controlledInput()
    stdout.full = true
    const done = serveStdioStreams(createMcpServer(), { stdin: feed.input, stdout, stderr: new FakeStderr() })
    feed.push(`${request(1, 'ping')}\n${request(2, 'ping')}\n`)
    feed.end()
    await tick()
    stdout.emit('close')
    await done
    expect(stdout.lines).toHaveLength(1)
  })

  it('removes its listeners once the output is flushed', async () => {
    const stdout = new FakeStdout()
    const feed = controlledInput()
    const done = serveStdioStreams(createMcpServer(), { stdin: feed.input, stdout, stderr: new FakeStderr() })
    feed.push(`${request(1, 'ping')}\n`)
    feed.end()
    await done
    expect(stdout.listenerCount('error')).toBe(0)
    expect(stdout.listenerCount('close')).toBe(0)
  })

  it('still absorbs an EPIPE that arrives after the input ended with output pending', async () => {
    const stdout = new FakeStdout()
    const stderr = new FakeStderr()
    const feed = controlledInput()
    const done = serveStdioStreams(createMcpServer(), { stdin: feed.input, stdout, stderr })
    feed.push(`${request(1, 'ping')}\n`)
    feed.end()
    stdout.writableLength = 64 // the last response is still queued in the pipe
    await done
    // Without a listener, EventEmitter would throw this error (an uncaught exception in the bin).
    expect(() => stdout.emit('error', new Error('write EPIPE'))).not.toThrow()
    expect(stderr.out.some((line) => line.includes('stdout closed'))).toBe(true)
  })
})

const bin = fileURLToPath(new URL('../lib/bin.js', import.meta.url))

describe.skipIf(!existsSync(bin))('botmesh-mcp binary with a closed stdout', () => {
  it('exits cleanly instead of crashing on EPIPE', async () => {
    const child = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.stdout.destroy()
    const lines: string[] = []
    for (let id = 1; id <= 2000; id++) lines.push(request(id, 'tools/call', { name: 'flow_example', arguments: {} }))
    child.stdin.on('error', () => { /* the child may exit first */ })
    child.stdin.end(`${lines.join('\n')}\n`)
    const code = await new Promise<number | null>((resolve) => child.on('exit', (exitCode) => resolve(exitCode)))
    expect(stderr).not.toContain('Unhandled')
    expect(code).toBe(0)
    expect(stderr).toContain('stdout closed')
  }, 30_000)
})
