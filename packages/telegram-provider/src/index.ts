/**
 * @botmesh/telegram — Telegram Bot API transport for @botmesh/core.
 * Long-poll or webhook ingress, inline keyboards, native polls/reactions/edit.
 */

export { TelegramProvider, toTelegramError, toProviderError } from './TelegramProvider.js'
export type { TelegramWebhookHeaders } from './TelegramProvider.js'
export { parseUpdate, parsePollAnswer, isEditedMessage } from './parseInbound.js'
export type { TelegramPollAnswerInfo } from './parseInbound.js'
export { toOutbound, MEDIA_UPLOAD } from './toOutbound.js'
export type { ResolvedTelegramMedia, TelegramOutbound } from './toOutbound.js'
export type {
  TelegramProviderConfig,
  TelegramResponse,
  TelegramUpdate,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramUser,
  TelegramFile,
  TelegramMessageEntity,
  TelegramPhotoSize,
  TelegramLocation,
  TelegramVenue,
  TelegramContact,
  TelegramPoll,
  TelegramPollAnswer,
} from './types.js'
