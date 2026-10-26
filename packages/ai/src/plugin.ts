/**
 * aiPlugin — installs a multi-provider AI autoresponder + `ctx.tools.ai` into a Bot.
 *
 * `install` is **synchronous**: it wires a {@link ContextManager} on top of the
 * bot's store, builds an {@link AIClient} on a {@link LazyProvider} and injects
 * it as `ctx.tools.ai` immediately (so `unplug()` is honoured and `ctx.tools.ai`
 * is never briefly undefined). The real provider is resolved lazily on first use
 * and, at startup, warmed up eagerly: a misconfiguration (missing SDK, unknown
 * provider, bad api key) is **logged as an error** and then degrades to the
 * configured `errorMessage` on each message — the process never crashes. A
 * pre-built provider (`MockAIProvider`, your own `AIProvider`) is used as is through
 * the `instance` option.
 *
 * Unless disabled it also registers a catch-all autoresponder (`onMessage`,
 * text-only) and a `/reset` command that clears the chat's AI context.
 *
 * With `tools`, the model can call bot functions natively (multi-step loop with
 * `maxSteps`, per-tool timeout, errors fed back to the model, audit events on
 * `bot.on('ai.tool')`). `confirm: true` tools ask the user first through a
 * runtime conversation, so the chat's FIFO queue is never blocked while waiting.
 *
 * @example
 * ```ts
 * import { aiPlugin } from '@botmesh/ai'
 *
 * bot.plug(aiPlugin({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY }))
 * ```
 */

import { CORE_MESSAGES, definePlugin, type MessageContext, type PluginContext, type PluginSpec } from '@botmesh/core'
import type { AIConfig, AIProvider, AIStreamConfig } from './types.js'
import { ContextManager } from './ContextManager.js'
import { AIClient } from './AIClient.js'
import { resolveProvider } from './providers/resolve.js'
import { assertThinking } from './providers/anthropicModels.js'
import { assertAIConfig } from './config.js'
import { LazyProvider } from './providers/LazyProvider.js'
import { chatKeyOf } from './chatKey.js'
import { createMemory } from './memory/createMemory.js'
import { toRagConfig } from './rag.js'
import { AIToolCancelledError, type AIToolEvent } from './tools/types.js'
import { editsMessages, isConfirmButtonId, isLiveConfirmButton, suspendingConfirmer } from './tools/autoreplyConfirm.js'
import { AI_MESSAGES, aiText } from './i18n.js'
import { formatMarkdown, formatMarkdownStream, type TextFormat } from './format.js'
import type { BotTracing } from '@botmesh/core'

/** `bot.tracing` when the core has it and it is enabled (an older core has no `tracing`). */
function tracingOf(bot: unknown): BotTracing | undefined {
  const tracing = (bot as { tracing?: BotTracing }).tracing
  return tracing?.enabled ? tracing : undefined
}

/** Public config for {@link aiPlugin}. */
export type AIPluginConfig = AIConfig & {
  /**
   * A ready-built provider used as is (`MockAIProvider` in tests, or your own `AIProvider`).
   * Skips the `provider`/`apiKey`/`model` resolution and the lazy SDK load.
   */
  instance?: AIProvider
  /** @internal Old name of `instance` (stripped from the published types; still honoured). */
  __provider?: AIProvider
}

const DEFAULT_CONFIRM_TIMEOUT = '2m'

interface InflightTurn {
  done: Promise<void>
  waiting: () => boolean
  abort: () => void
}

export function aiPlugin(config: AIPluginConfig = {}): PluginSpec<AIPluginConfig> {
  // Fail at config time (the caller's own stack), never inside the lazy provider.
  assertThinking(config.thinking)
  assertAIConfig(config)
  return definePlugin<AIPluginConfig>({
    name: 'ai',
    version: '0.1.0',
    description: 'Multi-provider AI autoresponder + ctx.tools.ai',
    install(ctx: PluginContext, cfg: AIPluginConfig = config) {
      // A config given to `bot.plug(aiPlugin(), cfg)` is checked here (a throw reverts the plug).
      if (cfg !== config) { assertThinking(cfg.thinking); assertAIConfig(cfg) }
      const bot = ctx.bot
      // Resolve lazily so install stays sync: a bad config can't crash the process.
      const injected = cfg.instance ?? cfg.__provider
      const lazy = injected ? undefined : new LazyProvider(() => resolveProvider(cfg))
      if (lazy && !cfg.model && (cfg.provider === 'openai' || cfg.provider === 'ollama')) {
        // Not fatal (a call may pass its own `model`), but the autoresponder would fail on every message.
        ctx.logger.warn(`ai provider "${cfg.provider}" has no default model: set aiPlugin({ model: '...' }) or every call without its own model fails`)
      }
      const provider: AIProvider = injected ?? lazy!
      const ctxMgr = new ContextManager(bot.getStore(), { maxMessages: cfg.context?.maxMessages })
      const rag = toRagConfig(cfg.rag)
      const client = new AIClient(provider, ctxMgr, {
        persona: cfg.persona,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        effort: cfg.effort,
        refusalMessage: cfg.refusalMessage,
        timeoutMs: cfg.timeoutMs,
        memory: createMemory((userId) => bot.user(userId), cfg.memory),
        ...(rag ? { rag } : {}),
        onError: (err, stage) => ctx.logger.warn({ err, stage }, 'ai augmentation failed'),
        tools: cfg.tools,
        maxSteps: cfg.maxSteps,
        toolTimeoutMs: cfg.toolTimeoutMs,
        maxStepsMessage: cfg.maxStepsMessage,
        ...(cfg.toolConfirm?.systemNote !== undefined ? { toolNote: cfg.toolConfirm.systemNote } : {}),
        // Tracing: model/tool spans join the bot's trace (no-op unless BotConfig.telemetry is set).
        ...(tracingOf(bot) ? { tracing: tracingOf(bot) } : {}),
        providerName: injected?.name ?? cfg.provider ?? 'anthropic',
        onToolEvent: (event: AIToolEvent) => {
          // Audit trail: metadata only in the log (no args / results), full event to sinks.
          ctx.logger.debug({ tool: event.tool, type: event.type, step: event.step, durationMs: event.durationMs }, 'ai tool event')
          if (event.type === 'tool.truncated') {
            ctx.logger.warn({ tool: event.tool, step: event.step }, 'ai tool call cut off by the output token limit: not run (raise maxTokens)')
          }
          bot.emit('ai.tool', event)
          cfg.onToolEvent?.(event)
        },
      })
      bot.provide('ai', client)
      // Remove the injected tool on unplug so `ctx.tools.ai` doesn't outlive the plugin.
      // (Reflect: the DefaultTools augmentation types `ai` as required, so `delete` won't type-check.)
      ctx.onDispose(() => { Reflect.deleteProperty(ctx.tools, 'ai') })

      // `errorMessage`, else the localized `ai.error` text of the chat (Spanish by default).
      const errorText = (mctx: MessageContext): string => cfg.errorMessage ?? aiText(mctx, AI_MESSAGES.error)
      const streamCfg = resolveStreamConfig(cfg.stream)

      // Tool turns that may outlive their handler (detached after a confirmation), per chat key.
      const inflight = new Map<string, InflightTurn>()
      // Latest autoreply turn per chat key: an older detached turn must not ask again.
      const generation = new Map<string, number>()
      // Global, monotonic turn counter: ids are never reused, even after `/reset` drops a key.
      let turnSeq = 0
      // Every autoreply turn still talking to the model: `bot.stop()` aborts them, so a slow
      // or hung provider neither answers into a stopped bot nor keeps the process alive.
      const running = new Set<AbortController>()
      const abortRunning = (): void => {
        for (const turn of [...running]) turn.abort()
        client.abortBackground()
      }
      bot.on('stopped', abortRunning)
      ctx.onDispose(() => { bot.off('stopped', abortRunning) })

      if (cfg.autoReply !== false) {

        bot.onMessage(async (mctx: MessageContext) => {
          // Blank text (only whitespace) is not a question: no model call, no empty history turn.
          if (mctx.type !== 'text' || !mctx.body?.trim()) return
          const key = chatKeyOf(mctx)
          // Markdown from the model → this chat's own markup (or none): `ctx.textFormat` is the
          // provider's per-chat format (Twilio WhatsApp vs SMS), else `capabilities.textFormat`.
          const textFormat = resolveTextFormat(cfg.format, mctx.textFormat ?? mctx.capabilities?.textFormat)
          const shown = (text: string): string => (textFormat ? formatMarkdown(text, textFormat) : text)
          // Tool turns (loop + confirmations) are not streamed: they take the one-shot path below.
          if (streamCfg && !client.hasTools && typeof mctx.stream === 'function') {
            const stop = new AbortController()
            running.add(stop)
            try {
              // A discarded (cancelled) answer was never shown in full: keep it out of the context too.
              const keepPartial = streamCfg.onCancel !== 'discard'
              const source = client.streamReplyInChat(key, mctx.body, {
                keepPartial, userId: mctx.sender, isGroup: mctx.isGroup, ctx: mctx, signal: stop.signal,
              })
              const result = await mctx.stream(textFormat ? formatMarkdownStream(source, textFormat) : source, {
                typing: cfg.humanizeTyping !== false,
                ...streamCfg,
              })
              // The model ended without a single character: never leave the user in silence.
              if (!result.cancelled && !stop.signal.aborted && !result.text.trim()) await mctx.reply(errorText(mctx))
            } catch (err) {
              // Stopped with the bot: nothing to say (and nowhere to say it).
              if (stop.signal.aborted) return
              ctx.logger.warn({ err }, 'ai streamed autoreply failed')
              await mctx.reply(errorText(mctx))
            } finally {
              running.delete(stop)
            }
            return
          }
          const body = mctx.body
          const gen = ++turnSeq
          if (client.hasTools) generation.set(key, gen)
          // Serialise turns per chat: let a detached turn finish before starting a new one
          // on the same history. It cannot deadlock: once superseded it no longer asks for
          // confirmations (and one already waiting would have received this message).
          const prev = inflight.get(key)
          if (prev && !prev.waiting()) await prev.done
          // With tools, a `confirm: true` call must wait for the user's answer. That wait
          // happens in a runtime conversation, so the turn may outlive this handler: race
          // the turn against "suspended" and return as soon as a confirmation is pending,
          // releasing the chat's FIFO queue (awaiting here would deadlock it).
          const confirmer = client.hasTools
            ? suspendingConfirmer(bot, mctx, {
                yes: cfg.toolConfirm?.yes,
                no: cfg.toolConfirm?.no,
                timeout: cfg.toolConfirm?.timeout ?? DEFAULT_CONFIRM_TIMEOUT,
                canAsk: () => generation.get(key) === gen,
                ...(cfg.toolConfirm?.buttons !== undefined ? { buttons: cfg.toolConfirm.buttons } : {}),
                ...(cfg.toolConfirm?.answeredNotice !== undefined ? { answeredNotice: cfg.toolConfirm.answeredNotice } : {}),
              })
            : undefined
          // Lets `/reset` (and `bot.stop()`) cancel the turn, even after its confirmation was answered.
          const abort = new AbortController()
          running.add(abort)
          // `humanizeTyping` shows the indicator while the model generates; the reply then
          // skips the BotConfig.typing pacer so the user never sees a second typing round.
          const typedAhead = cfg.humanizeTyping !== false
          const replyOpts = typedAhead ? { typing: false } : undefined
          const turn = (async () => {
            try {
              // Best-effort: a failing indicator (e.g. a channel answering 4xx) must not cost the reply.
              if (typedAhead) {
                try { await mctx.typing() } catch (err) { ctx.logger.debug({ err }, 'ai typing indicator failed (ignored)') }
              }
              const text = await client.replyInChat(key, body, {
                userId: mctx.sender,
                isGroup: mctx.isGroup,
                ctx: mctx,
                confirm: confirmer?.confirm,
                signal: abort.signal,
              })
              // A detached turn must not talk over a flow the user started meanwhile.
              if (confirmer?.isDetached() && bot.inspectConversation(mctx) !== undefined) {
                ctx.logger.debug('ai autoreply dropped: a conversation is active on the chat')
                return
              }
              // The model ended without a single character: never leave the user in silence
              // (nor send a blank message, which several channels reject).
              if (!text.trim()) {
                ctx.logger.warn('ai autoreply: the model returned an empty answer (if it was cut off, raise maxTokens)')
                await mctx.reply(errorText(mctx), replyOpts)
                return
              }
              await mctx.reply(shown(text), replyOpts)
            } catch (err) {
              // Cancelled confirmation or turn (/reset, timeout, superseded turn): nothing to say.
              if (err instanceof AIToolCancelledError || abort.signal.aborted) return
              ctx.logger.warn({ err }, 'ai autoreply failed')
              await mctx.reply(errorText(mctx), replyOpts).catch(() => {})
            } finally {
              running.delete(abort)
            }
          })()
          if (!confirmer) return turn
          const entry: InflightTurn = {
            done: turn.finally(() => {
              if (inflight.get(key) === entry) inflight.delete(key)
              if (generation.get(key) === gen) generation.delete(key)
            }),
            waiting: () => confirmer.isWaiting(),
            abort: () => abort.abort(),
          }
          inflight.set(key, entry)
          await Promise.race([entry.done, confirmer.suspended])
        })
      }

      if (client.hasTools) {
        // A press on a confirmation that is no longer pending (answered, superseded, timed
        // out, /reset) is acknowledged (stops the Telegram spinner, meets Discord's deadline)
        // and dropped BEFORE routing, so it never answers a later question of a conversation
        // (`confirmWith(c)`). Where the buttons stay on screen (no edit), a short notice tells
        // the user why nothing happens. Before-hooks run ahead of the handoff gate, so a chat
        // handed off to a human gets the acknowledge only: the bot says nothing there.
        const expiredNotice = cfg.toolConfirm?.expiredNotice !== false
        bot.before('message', async (mctx: MessageContext, next: () => Promise<void>) => {
          if (mctx.type !== 'buttons' || !isConfirmButtonId(mctx.body) || isLiveConfirmButton(mctx.body)) return next()
          ctx.logger.debug('ai confirmation button pressed after it was answered (ignored)')
          try { await mctx.acknowledge?.() } catch { /* best effort */ }
          if (expiredNotice && !editsMessages(mctx) && !bot.isHandedOff(mctx.from)) {
            await mctx.reply(aiText(mctx, AI_MESSAGES.confirmExpired)).catch(() => {})
          }
        })
        // A pending confirmation's press that no conversation took (e.g. another group
        // participant pressed it): acknowledge it and drop it.
        bot.when((m) => (m as { type?: string }).type === 'buttons' && isConfirmButtonId(m.body), async (mctx) => {
          ctx.logger.debug('ai confirmation button pressed after it was answered (ignored)')
          try { await mctx.acknowledge?.() } catch { /* best effort */ }
        })
      }

      if (cfg.resetCommand !== false) {
        bot.command('reset', async (mctx: MessageContext) => {
          const key = chatKeyOf(mctx)
          // Cancel a detached tool turn first, so it neither asks again, nor writes the
          // stale turn into the history cleared below, nor replies.
          inflight.get(key)?.abort()
          generation.delete(key)
          client.clearToolHistory(key)
          await ctxMgr.clear(key)
          bot.abortConversation(mctx)
          // Localized like the core slash command (es default, en when the chat resolves to English).
          await mctx.reply(mctx.t(CORE_MESSAGES.commandsReset))
        })
      }

      // Surface a misconfigured provider loudly-but-non-fatally at startup: warm
      // the lazy provider so a missing SDK / unknown provider / failing SDK ctor
      // is logged now instead of silently waiting for the first message. It stays
      // non-fatal — the autoreply try/catch replies `errorMessage` per message.
      if (lazy) {
        void lazy.warmup().catch((err) => ctx.logger.error({ err }, 'ai provider failed to resolve'))
      }
      // Same for the RAG index (load + embed the corpus now, not on the first question).
      const warmRag = rag?.retriever.warmup
      if (warmRag) {
        void Promise.resolve()
          .then(() => warmRag.call(rag.retriever))
          .catch((err) => ctx.logger.error({ err }, 'ai rag index failed to load'))
      }
    },
  })
}

/** `format` option + the chat's text format (`ctx.textFormat`) → the dialect to convert to, or undefined (send as is). */
function resolveTextFormat(option: AIConfig['format'], capability: TextFormat | undefined): TextFormat | undefined {
  if (option === false) return undefined
  if (option === undefined || option === 'auto') return capability
  return option
}

/** `stream` option → the StreamOptions to use, or `undefined` when streaming is off. */
function resolveStreamConfig(stream: AIConfig['stream']): Omit<AIStreamConfig, 'enabled'> | undefined {
  if (!stream) return undefined
  if (stream === true) return {}
  const { enabled, ...opts } = stream
  return enabled === false ? undefined : opts
}
