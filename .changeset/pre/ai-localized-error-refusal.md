---
'@botmesh/ai': patch
---

The autoreply's fallback replies follow the chat language like the other built-in texts: when `errorMessage` / `refusalMessage` are not set, the plugin answers the new `ai.error` / `ai.refusal` messages (`AI_MESSAGES.error` / `AI_MESSAGES.refusal`), translatable with `bot.locale()`. The Spanish defaults are unchanged (`'⚠️ Ahora no puedo responder, intenta luego.'` / `'No puedo ayudar con eso.'`), so a bot without i18n behaves as before; an English chat now gets `"⚠️ I can't answer right now, please try again later."` / `"I can't help with that."`.
