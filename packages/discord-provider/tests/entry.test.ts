/**
 * Entry layout of `@botmesh/discord` (API freeze before its first npm release): the main entry holds
 * what an application needs and is covered by semver; the wire mappers and other building
 * blocks live in `@botmesh/discord/internal` (no semver). The runtime names of each entry are pinned
 * here so that growing the main entry is a deliberate change.
 */
import { describe, expect, it } from 'vitest'

import * as main from '../src/index.js'
import * as internal from '../src/internal.js'

/** Runtime exports of the main entry covered by semver. */
const MAIN_VALUES = ['DiscordProvider', 'DISCORD_MEDIA_HOSTS', 'toDiscordError', 'isEditedMessage', 'GatewayIntents', 'DEFAULT_INTENTS'] as const

/** Deprecated aliases kept on the main entry until v3. */
const MAIN_DEPRECATED_VALUES = ['toProviderError'] as const

/** Runtime exports of `/internal` (no semver). */
const INTERNAL_VALUES = ['GatewaySocket', 'defaultSocketFactory', 'gatewayConnectUrl', 'DiscordRestClient', 'DEFAULT_REST_TIMEOUT_MS', 'DEFAULT_UPLOAD_TIMEOUT_MS', 'toOutbound', 'parseDispatch', 'snowflakeTimestamp', 'GatewayOpcode', 'InteractionType', 'ComponentType', 'FATAL_CLOSE_CODES', 'FRESH_SESSION_CODES'] as const

describe('@botmesh/discord entries', () => {
  it('pins the runtime names of the main entry', () => {
    expect(Object.keys(main).sort()).toEqual([...MAIN_VALUES, ...MAIN_DEPRECATED_VALUES].sort())
  })

  it('pins the runtime names of /internal', () => {
    expect(Object.keys(internal).sort()).toEqual([...INTERNAL_VALUES].sort())
  })

  it('keeps the building blocks off the main entry', () => {
    for (const name of INTERNAL_VALUES) expect(main).not.toHaveProperty(name)
  })

  it('freezes the exported data', () => {
    expect(Object.isFrozen(main.GatewayIntents)).toBe(true)
    expect(Object.isFrozen(main.DISCORD_MEDIA_HOSTS)).toBe(true)
    expect(main.DEFAULT_INTENTS).toBe(main.GatewayIntents.Guilds | main.GatewayIntents.GuildMessages | main.GatewayIntents.MessageContent)
  })

  it('keeps the deprecated error mapper as an alias', () => {
    expect(main.toProviderError).toBe(main.toDiscordError)
  })
})
