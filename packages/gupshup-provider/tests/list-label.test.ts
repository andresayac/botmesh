/** The list button label of a 4-10 button menu was hard-coded to 'Opciones'. */
import { describe, expect, it } from 'vitest'
import { toOutbound } from '../src/toOutbound.js'

const buttons = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, title: `Option ${i}` }))
const labelOf = (out: unknown) => JSON.stringify(out).match(/"globalButtons":\[\{"type":"text","title":"([^"]*)"/)?.[1]

describe('buttons sent as a list', () => {
  it('use the listButtonText option for the list button', () => {
    expect(labelOf(toOutbound({ kind: 'buttons', text: 'Pick one', buttons }, { listButtonText: 'Choose' }))).toBe('Choose')
  })
  it("keep 'Opciones' by default", () => {
    expect(labelOf(toOutbound({ kind: 'buttons', text: 'Pick one', buttons }))).toBe('Opciones')
  })
})
