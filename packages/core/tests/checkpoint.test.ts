import { describe, it, expect, vi } from 'vitest'
import { ConversationRuntime } from '../src/conversations/ConversationRuntime.js'
import { createControls } from '../src/conversations/controls.js'
import { flow } from '../src/flows/FlowBuilder.js'
import { MemoryStore } from '../src/store/MemoryStore.js'

/** Texts passed to a `reply` mock (controls also pass pacing options as a 2nd argument). */
const texts = (fn: { mock: { calls: unknown[][] } }): unknown[] => fn.mock.calls.map((c) => c[0])


function makeMsg(body: string) {
  return { from: 'a@s.whatsapp.net', sender: 'a@s.whatsapp.net', body, type: 'text', isGroup: false, reply: vi.fn(async () => {}) }
}
const persistentFlow = () => flow('registrar').persistent()
  .say('bienvenido')
  .ask('¿nombre?', 'name')
  .ask('¿email?', 'email')
  .say((_c, c) => `fin ${c.state.name}/${c.state.email}`)
  .compile()

function makeRt(store: MemoryStore) {
  const rt = new ConversationRuntime({ controlsFactory: (r, handle, c) => createControls(r, handle, c) })
  rt.attachStore(store)
  rt.registerCompiled(persistentFlow())
  return rt
}

describe('checkpoints', () => {
  it('saves checkpoint after each completed step and clears at end', async () => {
    const store = new MemoryStore({})
    const rt = makeRt(store)
    const start = makeMsg('registrar')
    const entry = rt.enter('registrar', start)
    await vi.waitFor(() => expect(texts(start.reply)).toContain('¿nombre?'))
    const key = rt.keyFor(start)
    const cp1 = await store.getCheckpoint(key)
    expect(cp1?.step).toBe(1)                       // 'say' completado; siguiente = ask nombre
    rt.deliver(makeMsg('Andres'))
    await vi.waitFor(() => expect(texts(start.reply)).toContain('¿email?'))
    rt.deliver(makeMsg('a@b.co'))
    await entry
    expect(await store.getCheckpoint(key)).toBeUndefined()   // limpio al terminar
  })

  it('resumes from checkpoint after restart: re-asks pending question', async () => {
    const store = new MemoryStore({})
    const rt1 = makeRt(store)
    const start = makeMsg('registrar')
    void rt1.enter('registrar', start)
    await vi.waitFor(() => expect(texts(start.reply)).toContain('¿nombre?'))
    rt1.deliver(makeMsg('Andres'))
    await vi.waitFor(() => expect(texts(start.reply)).toContain('¿email?'))
    // "reinicio": nuevo runtime, mismo store
    const rt2 = makeRt(store)
    await rt2.loadDormant()
    const wake = makeMsg('hola?')
    expect(await rt2.resumeDormant(wake)).toBe(true)
    await vi.waitFor(() => expect(texts(wake.reply)).toContain('¿email?'))  // re-ask
    rt2.deliver(makeMsg('a@b.co'))
    await vi.waitFor(() => expect(texts(wake.reply)).toContain('fin Andres/a@b.co')) // state restaurado
  })

  it('checkpoints a flow whose FIRST step is an ask, so a restart while it waits resumes it', async () => {
    const store = new MemoryStore({})
    const askFirst = () => flow('encuesta').persistent()
      .ask('¿nombre?', 'name')
      .say((_c, c) => `gracias ${c.state.name}`)
      .compile()
    const rt1 = new ConversationRuntime({ controlsFactory: (r, handle, c) => createControls(r, handle, c) })
    rt1.attachStore(store)
    rt1.registerCompiled(askFirst())
    const start = makeMsg('encuesta')
    void rt1.enter('encuesta', start)
    await vi.waitFor(() => expect(texts(start.reply)).toContain('¿nombre?'))
    const key = rt1.keyFor(start)
    expect((await store.getCheckpoint(key))?.step).toBe(0)   // the pending ask itself
    // "restart": a new runtime over the same store
    const rt2 = new ConversationRuntime({ controlsFactory: (r, handle, c) => createControls(r, handle, c) })
    rt2.attachStore(store)
    rt2.registerCompiled(askFirst())
    await rt2.loadDormant()
    const wake = makeMsg('hola?')
    expect(await rt2.resumeDormant(wake)).toBe(true)
    await vi.waitFor(() => expect(texts(wake.reply)).toContain('¿nombre?'))   // re-asked
    rt2.deliver(makeMsg('Ana'))
    await vi.waitFor(() => expect(texts(wake.reply)).toContain('gracias Ana'))
    await vi.waitFor(async () => expect(await store.getCheckpoint(key)).toBeUndefined())
  })

  it('a non-persistent flow still writes no checkpoint at its first ask', async () => {
    const store = new MemoryStore({})
    const rt = new ConversationRuntime({ controlsFactory: (r, handle, c) => createControls(r, handle, c) })
    rt.attachStore(store)
    rt.registerCompiled(flow('libre').ask('¿algo?', 'x').compile())
    const start = makeMsg('libre')
    void rt.enter('libre', start)
    await vi.waitFor(() => expect(texts(start.reply)).toContain('¿algo?'))
    expect(await store.getCheckpoint(rt.keyFor(start))).toBeUndefined()
  })
})
