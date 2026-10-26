/**
 * The body of the `Bot` constructor: config defaults, logger, store + namespace and every
 * subsystem, built in the same order as always (it fixes the order of the provider
 * listeners and of the bot's own listeners), then the pipeline modules over them.
 *
 * Cycles (the dispatcher's handoff gate reads `handoffs`; `handoffs.hasCommand` reads the
 * dispatcher; the ledger persists chats through `persistence`) are kept as lazy closures
 * over the kernel, never as eager reads.
 */
import type { Logger } from 'pino'

import { HookSystem } from '../../hooks/HookSystem.js'
import { MemoryStore } from '../../store/MemoryStore.js'
import { NamespacedStore, type StoreNamespace } from '../../store/NamespacedStore.js'
import type { IStore } from '../../store/IStore.js'
import { ConversationRuntime, type CheckpointStore, type RuntimeMessage } from '../../conversations/ConversationRuntime.js'
import { BotCoordination } from '../../coordination/botCoordination.js'
import { createDurability } from '../../durability/bind.js'
import { createControls } from '../../conversations/controls.js'
import { FlowRouteLog } from '../../flows/inventory.js'
import type { AccessList, Whitelist } from '../../gates/accessList.js'
import { HANDOFF_INDEX_KEY, HandoffRegistry, type HandoffEvent, type HandoffOptions, type ResumeEvent } from '../../gates/handoff.js'
import { I18n } from '../../i18n/I18n.js'
import type { ConversationEndedEvent, MetricsCollector } from '../../ops/metrics.js'
import type { Scheduler } from '../../scheduler/Scheduler.js'
import { createBotScheduler } from '../../scheduler/botScheduler.js'
import { UserDataService } from '../../user/UserDataService.js'
import { KeyedQueue } from '../../utils/keyedQueue.js'
import { parseTimerDuration } from '../../utils/timers.js'
import { moreSpecificTag, validateConfig } from '../../utils/validateConfig.js'
import { Dispatcher } from '../Dispatcher.js'
import { createInboundDeduper } from '../dedupe.js'
import { createEchoFilter } from '../echo.js'
import { DynamicFlowRegistry } from '../flowRegistry.js'
import type { ChatIdleWatchers } from '../idle.js'
import { MessageLog } from '../ledger.js'
import { logIdPolicy, toBotLogger } from './logger.js'
import { ExternalSendClock, createPacer, normalizeTypingConfig } from '../messaging.js'
import type { BotConfig, ChatId, MessageContext, Trigger } from '../types.js'
import { WelcomeTracker } from '../welcome.js'
import { createTracing } from '../../telemetry/tracing.js'
import { ConversationTracing } from '../../telemetry/conversation.js'
import { createTaskTracing } from '../../telemetry/tasks.js'
import { createContextFactory } from './contextFactory.js'
import { createHandoverBridge, runtimeHandover } from './handover.js'
import { createEventSink, dispatcherEmit, type EventHost } from './events.js'
import { InboundPipeline } from './inbound.js'
import { admitHandoff } from './gates.js'
import { assertCoordinated, DisposableList, type BotKernel, type LifecycleState } from './kernel.js'
import { createLangSeams } from './lang.js'
import { Lifecycle, defaultLifecycleSteps } from './lifecycle.js'
import { BotOps } from './ops.js'
import { OutboundPipeline } from './outbound.js'
import { presenceAllowed } from './presence.js'
import { Persistence } from './persistence.js'
import { PluginHost } from './pluginHost.js'
import { RouteRegistrar } from './routes.js'

/** What `composeBot` needs from the real bot: its events plus the late-bound seams. */
export interface ComposeHost extends EventHost {
  /** Private `Bot.registerEnterMatcher`, called through the bot at call time. */
  registerEnterMatcher(trigger: Trigger, target: string): () => void
  /** Private `Bot.isChatHandedOff`. */
  isChatHandedOff(chatId: ChatId): boolean
  handoff(chatId: ChatId, opts?: HandoffOptions): Promise<boolean>
}

/** State the bot creates in its field initializers (they run before the constructor body). */
export interface ComposeFields {
  state: LifecycleState
  scheduler: Scheduler
  idle: ChatIdleWatchers
  counters: MetricsCollector
  blacklist: AccessList
  whitelist: Whitelist
}

/** What the `Bot` facade keeps: the kernel and the modules it delegates to. */
export interface BotParts {
  kernel: BotKernel
  ready: Promise<void>
  lifecycle: Lifecycle
  outbound: OutboundPipeline
  routes: RouteRegistrar
  plugins: PluginHost
  ops: BotOps
}

type Mutable<T> = { -readonly [P in keyof T]: T[P] }

export function composeBot(host: ComposeHost, inputConfig: BotConfig, fields: ComposeFields): BotParts {
  validateConfig(inputConfig)
  if (!inputConfig.provider) {
    throw new Error(
      'Bot requires a transport provider. Construct one and pass it: ' +
        "new Bot({ provider: new BaileysProvider({ session: 'demo' }) }). " +
        'See @botmesh/baileys for the WhatsApp transport.',
    )
  }
  assertProviderShape(inputConfig.provider)
  const k = {} as Mutable<BotKernel>
  const config: BotConfig = { commandPrefix: '/', ...inputConfig }
  const provider = inputConfig.provider
  k.config = config
  k.provider = provider
  k.inboundDedupe = createInboundDeduper(inputConfig.dedupe)
  k.echoes = createEchoFilter(inputConfig.echoFilter)
  if (k.echoes) fields.counters.trackEchoes = true

  // Any `LoggerLike` (pino, `console`, a custom object): a pino-shaped one passes through
  // and the rest is adapted (see `toBotLogger`). 'warn' by default so plugin/handler
  // failures logged at warn stay visible.
  const logger: Logger = toBotLogger(inputConfig.logger, { debug: inputConfig.debug === true })
  k.logger = logger
  k.state = fields.state
  k.scheduler = fields.scheduler
  k.idle = fields.idle
  k.counters = fields.counters
  k.access = { blacklist: fields.blacklist, whitelist: fields.whitelist }
  k.tools = {}
  k.disposables = new DisposableList()
  k.flowRoutes = new FlowRouteLog()
  k.chatWrites = new KeyedQueue()
  k.externalSends = new ExternalSendClock()
  k.inflightSends = new Set()
  k.ledgerWrites = new Set()
  k.inflightEvents = new Set()
  // Tracing (opt-in): `null` without `config.telemetry`, and every site then runs its original code.
  k.tracing = createTracing(inputConfig.telemetry, logger.child({ module: 'telemetry' }))
  k.events = createEventSink(host, fields.counters, () => logger, k.tracing ? () => k.tracing : undefined)
  k.logId = logIdPolicy(inputConfig, k.tracing)
  k.isHandedOff = (chatId) => host.isChatHandedOff(chatId)

  k.hooks = new HookSystem(logger.child({ module: 'hooks' }), { report: (error) => k.events.error({ error }) })
  k.pacer = createPacer({
    provider,
    typing: normalizeTypingConfig(inputConfig.typing),
    logger,
    logId: k.logId,
    signal: () => k.state.sendsAbort.signal,
    allowTyping: (chatId) => presenceAllowed(k, 'typing', chatId),
  })

  // Store — injected instance, or the built-in MemoryStore. Every key is
  // namespaced so sharing one backend across bots cannot collide.
  // `storeConfig` (deprecated) configures the built-in MemoryStore only.
  const storeConfig = config.storeConfig
  if (storeConfig !== undefined) {
    if (typeof config.store === 'object' && config.store !== null) {
      logger.warn('BotConfig.storeConfig is ignored: it only configures the built-in MemoryStore, and an IStore was passed as store')
    } else {
      logger.warn('BotConfig.storeConfig is deprecated: pass store: new MemoryStore({ file, maxMessagesPerChat, autoSaveInterval }) instead')
    }
  }
  // `rateLimit` (deprecated) is a v1 leftover: pacing moved to the transports in v2 and
  // nothing in the core ever read it, so say so instead of silently ignoring it.
  if (config.rateLimit !== undefined) {
    logger.warn(
      'BotConfig.rateLimit is ignored (nothing in the core reads it): configure pacing on the provider ' +
        '(e.g. new BaileysProvider({ rateLimit })) and the retry of rate-limited replies with BotConfig.rateLimitRetry',
    )
  }
  const baseStore =
    (typeof config.store === 'object' && config.store !== null
      ? (config.store as IStore)
      : null) ??
    new MemoryStore({
      file: storeConfig?.file,
      maxMessagesPerChat: storeConfig?.maxMessagesPerChat,
      autoSaveInterval: storeConfig?.autoSaveInterval,
      logger: logger.child({ module: 'store' }),
    })
  let namespace: StoreNamespace = {
    tenantId: config.tenantId ?? 'local',
    environmentId: config.environmentId ?? 'default',
    botId: config.botId ?? config.session ?? provider.id,
    providerId: provider.id,
    connectionId: config.connectionId ?? config.session ?? 'default',
  }
  let store: IStore
  if (baseStore instanceof NamespacedStore) {
    store = baseStore
    namespace = baseStore.namespace
  } else {
    store = new NamespacedStore(baseStore, namespace)
  }
  k.store = store
  k.namespace = namespace
  // Durable scheduler tasks (opt-in): only replaced when `BotConfig.scheduler` is set. Its
  // leadership defaults to the multi-replica coordinator (`BotConfig.coordination`).
  if (config.scheduler) k.scheduler = createBotScheduler(config.scheduler, namespace, config.coordination?.coordinator)
  // Tracing: every task run is a root `bot.task` span (plain runs and durable occurrences).
  if (k.tracing) k.scheduler.trace(createTaskTracing(k.tracing))
  const persistence = new Persistence(store, k.chatWrites)
  k.messageLog = new MessageLog({
    store,
    namespace,
    selfId: () => provider.selfId ?? undefined,
    persistChat: (chat) => persistence.persistChat(chat),
    reportError: (error) => k.events.error({ error }),
    // Echo filter: every successful send (direct, durable outbox, sweeper) is remembered here.
    ...(k.echoes ? { echoes: k.echoes } : {}),
  })
  k.users = new UserDataService(store, { logger: logger.child({ module: 'user-data' }) })
  k.i18n = new I18n({ logger: logger.child({ module: 'i18n' }) })
  if (config.lang !== undefined) k.i18n.setDefaultLocale(config.lang)
  if (config.i18n !== undefined) k.i18n.configure(config.i18n)
  // `lang: 'es-MX'` with `i18n.defaultLocale: 'es'`: the more specific tag is the default.
  if (config.lang !== undefined && config.i18n?.defaultLocale !== undefined && moreSpecificTag(config.lang, String(config.i18n.defaultLocale))) {
    k.i18n.setDefaultLocale(config.lang)
  }

  const conv = config.conversation ?? {}
  const conversationTimeoutMs = conv.timeout !== undefined ? parseTimerDuration(conv.timeout, 'conversation.timeout') : undefined
  // Multi-replica: checkpoint writes use the store's compare-and-set when it offers one.
  const casCheckpoints = typeof (store as Partial<CheckpointStore>).setCheckpointIf === 'function'
    && typeof (store as Partial<CheckpointStore>).clearCheckpointIf === 'function'
  // Built below; late-bound by the closures that need it (durability replays, hand-over answers).
  let inbound!: InboundPipeline
  // Multi-replica: conversation hand-over between replicas (answers of cut-short steps, coordination.handover).
  const handover = config.coordination ? createHandoverBridge(k, config.coordination.handover, () => inbound) : undefined
  const handoverPolicy = config.coordination
    ? runtimeHandover(config.coordination.handover, conversationTimeoutMs, (event) => { k.events.emit('coordination:handover', event) })
    : undefined
  k.runtime = new ConversationRuntime({
    controlsFactory: createControls,
    defaultTimeoutMs: conversationTimeoutMs,
    timeoutMessage: conv.timeoutMessage,
    retriesMessage: conv.retriesMessage,
    errorMessage: conv.errorMessage,
    cancelledMessage: conv.cancelledMessage,
    scope: config.conversationScope === 'chat' ? 'chat' : 'participant',
    logger: logger.child({ module: 'conversations' }),
    logId: k.logId,
    onError: (error, ctx) => k.events.error({ error, ctx: ctx as unknown as MessageContext }),
    onConversationStart: ({ id, name, key, ctx }) => {
      k.counters.conversationStarted(name)
      k.events.safely('conversation:started', { id, name, key, chatId: ctx.from, userId: ctx.sender })
    },
    onConversationEnd: ({ id, name, key, ctx, outcome, durationMs, goto }) => {
      k.counters.conversationEnded(name, outcome, durationMs)
      const event: ConversationEndedEvent = {
        id, name, key, chatId: ctx.from, userId: ctx.sender, outcome, completed: outcome === 'completed', durationMs,
      }
      if (goto !== undefined) event.goto = goto
      k.events.safely('conversation:ended', event)
    },
    // Multi-replica: timers of a conversation act only under the chat's turn (a stale
    // replica's timer refreshes instead of messaging the user or clearing the checkpoint).
    ...(config.coordination
      ? {
          trackParked: true,
          timerGate: (_key: string, ctx: RuntimeMessage, fire: () => unknown) => {
            void k.dispatcher.runExclusive(ctx, async () => { await fire() }).catch(() => {})
          },
          // A replica that lost the chat never writes the checkpoint of the one that took it.
          fence: (key: string) => { k.coordination?.assertTurn(key) },
          // ...and, with a store that can, a replica that lost it WITHOUT knowing yet cannot either.
          casCheckpoints,
          onFenced: (key: string) => { k.coordination?.markLost(key) },
          fenceOf: (key: string) => k.coordination?.fenceOf(key),
          answers: handover!.answers,
          ...(handoverPolicy ? { handover: handoverPolicy } : {}),
        }
      : {}),
    ...(k.tracing ? { tracing: new ConversationTracing(k.tracing) } : {}),
  })
  if (typeof (store as Partial<CheckpointStore>).setCheckpoint === 'function') {
    k.runtime.attachStore(store as CheckpointStore)
  }

  k.flowRegistry = new DynamicFlowRegistry({
    runtime: k.runtime,
    enterMatcher: (trigger, target) => host.registerEnterMatcher(trigger, target),
  })

  k.welcome = new WelcomeTracker({ store, onError: (error) => k.events.error({ error }) })

  if (config.coordination) {
    k.coordination = new BotCoordination({
      config: config.coordination,
      provider,
      runtime: k.runtime,
      logger: logger.child({ module: 'coordination' }),
      logId: k.logId,
      emit: (event, payload) => { k.events.emit(event, payload) },
      reportError: (error, ctx) => k.events.error({ error, ctx: ctx as unknown as MessageContext | undefined }),
      casCheckpoints,
    })
  }

  k.dispatcher = new Dispatcher({
    hooks: k.hooks,
    runtime: k.runtime,
    commandPrefix: config.commandPrefix,
    firstContact: (ctx) => k.welcome.isFirstContact(ctx),
    // A message queued before stop() is dropped when its turn comes after it.
    isOpen: () => k.state.acceptingInbound,
    turns: k.coordination?.turns,
    ...(k.tracing ? { tracing: k.tracing } : {}),
    logger: logger.child({ module: 'dispatcher' }),
    emit: dispatcherEmit(k.events),
    // Human handoff (read lazily: the registry is built below).
    gate: (ctx) => admitHandoff(k, ctx),
    ...createLangSeams(k),
  })

  // The handoff index lives under a store cursor key; a backend without cursor support
  // makes the registry fall back to scanning listChats() on start.
  const backing = baseStore instanceof NamespacedStore ? baseStore.innerStore : baseStore
  const hasCursors = typeof backing.getCursor === 'function' && typeof backing.setCursor === 'function'
  k.handoffs = new HandoffRegistry({
    store: {
      writeHandoff: (chatId, handoff) => persistence.writeHandoff(chatId, handoff),
      getChat: (chatId) => store.getChat(chatId),
      listChats: () => store.listChats(),
    },
    index: hasCursors
      ? {
          get: async () => store.getCursor?.(HANDOFF_INDEX_KEY),
          set: async (value) => { await store.setCursor?.(HANDOFF_INDEX_KEY, value) },
        }
      : undefined,
    config: config.handoff,
    commandPrefix: config.commandPrefix,
    hasCommand: (name) => k.dispatcher.hasCommand(name),
    abortChat: (chatId) => { k.runtime.abortChat(chatId) },
    emit: (event: 'handoff' | 'resume', payload: HandoffEvent | ResumeEvent) => { k.events.emit(event, payload) },
    reportError: (error) => k.events.error({ error }),
    logger: logger.child({ module: 'handoff' }),
    logId: k.logId,
  })

  // Durable inbox/outbox (opt-in). Replays go through the inbound pipeline (built below:
  // the closures only read it at call time) and background sends through the transport,
  // fenced like any send when coordination is on.
  k.durable = createDurability(config.durability, {
    logger: logger.child({ module: 'durability' }),
    logId: k.logId,
    namespace,
    hooks: k.hooks,
    messageLog: k.messageLog,
    provider,
    // Multi-replica: a background send needs this replica to hold the provider session.
    assertSend: k.coordination ? () => assertCoordinated(k) : undefined,
    persistRaw: config.persistRaw === true,
    admits: (ids) => inbound.admitsSender(ids),
    handleInbound: (m) => inbound.handleInbound(m),
    handleInteraction: (i) => inbound.handleInteraction(i),
    emit: (event, payload) => { k.events.emit(event, payload) },
    reportError: (error) => k.events.error({ error }),
    // Late-bound: the outbound pipeline is built below (called only once the bot runs).
    split: (chatId, content) => outbound.textParts(chatId, content),
  })

  const ready = new Promise<void>((resolve) => {
    const off = provider.onEvent((e) => {
      if (e.kind === 'connection' && e.update.state === 'ready') { off(); resolve() }
    })
  })

  const kernel: BotKernel = k
  const outbound = new OutboundPipeline(kernel)
  const baseContextFor = createContextFactory(kernel, outbound, (chatId, opts) => host.handoff(chatId, opts))
  const contextFor = handover ? handover.track(baseContextFor) : baseContextFor
  inbound = new InboundPipeline(kernel, contextFor, persistence)
  // Subscribed after the `ready` listener: the `ready` promise resolves before 'ready' handlers run.
  kernel.disposables.add(inbound.attach())

  return {
    kernel,
    ready,
    lifecycle: new Lifecycle(kernel, defaultLifecycleSteps(kernel)),
    outbound,
    routes: new RouteRegistrar(kernel),
    plugins: new PluginHost(kernel),
    ops: new BotOps(kernel, contextFor),
  }
}

/**
 * The usual wiring mistakes with `BotConfig.provider` (the class instead of an instance, an
 * un-awaited async factory, a plain object) used to surface later as an unrelated error
 * (an invalid store namespace, `provider.onEvent is not a function`). Name them here.
 */
function assertProviderShape(provider: unknown): void {
  if (typeof provider === 'function') {
    const name = (provider as { name?: string }).name || 'Provider'
    throw new TypeError(`BotConfig.provider must be a provider instance, not a class or function: use new ${name}(...)`)
  }
  if (typeof (provider as { then?: unknown }).then === 'function') {
    throw new TypeError('BotConfig.provider is a Promise: await the provider (or its factory) before passing it to new Bot()')
  }
  const missing = (['start', 'stop', 'send', 'onEvent'] as const)
    .filter((m) => typeof (provider as Record<string, unknown>)[m] !== 'function')
  if (missing.length > 0) {
    throw new TypeError(
      `BotConfig.provider is not an IProvider: it lacks the method(s) ${missing.join(', ')} ` +
        '(every provider implements start, stop, send, onEvent)',
    )
  }
}
