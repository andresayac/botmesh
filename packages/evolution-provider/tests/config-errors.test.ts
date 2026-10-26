import { describe, expect, it } from 'vitest'
import { EvolutionProvider } from '../src/index.js'
import type { EvolutionProviderConfig } from '../src/index.js'

const OK: EvolutionProviderConfig = { baseUrl: 'http://127.0.0.1:8080', apiKey: 'k', instance: 'i', webhookSecret: 's' }

describe('EvolutionProvider configuration errors', () => {
  it.each([
    ['baseUrl', { ...OK, baseUrl: '' }, /baseUrl/],
    ['apiKey', { ...OK, apiKey: '' }, /apiKey/],
    ['instance', { ...OK, instance: '' }, /instance/],
    ['webhook auth', { ...OK, webhookSecret: undefined }, /webhookSecret/],
    ['scheme-less baseUrl', { ...OK, baseUrl: 'localhost:8080' }, /absolute http\(s\) URL/],
  ])('a missing or invalid %s throws a TypeError', (_name, config, message) => {
    expect(() => new EvolutionProvider(config as EvolutionProviderConfig)).toThrow(TypeError)
    expect(() => new EvolutionProvider(config as EvolutionProviderConfig)).toThrow(message)
  })
})
