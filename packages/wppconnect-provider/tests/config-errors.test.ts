import { describe, expect, it } from 'vitest'
import { WPPConnectProvider } from '../src/index.js'
import type { WPPConnectProviderConfig } from '../src/index.js'

const OK: WPPConnectProviderConfig = { baseUrl: 'http://127.0.0.1:21465', session: 's', token: 't', webhookToken: 'w' }

describe('WPPConnectProvider configuration errors', () => {
  it.each([
    ['session', { ...OK, session: '' }, /session/],
    ['credentials', { ...OK, token: undefined }, /token/],
    ['webhook auth', { ...OK, webhookToken: undefined }, /webhookToken/],
    ['scheme-less baseUrl', { ...OK, baseUrl: 'localhost:21465' }, /absolute http\(s\) URL/],
  ])('a missing or invalid %s throws a TypeError', (_name, config, message) => {
    expect(() => new WPPConnectProvider(config as WPPConnectProviderConfig)).toThrow(TypeError)
    expect(() => new WPPConnectProvider(config as WPPConnectProviderConfig)).toThrow(message)
  })
})
