---
'@botmesh/ai': minor
---

The `ollama` provider sends `aiPlugin({ apiKey })` as `Authorization: Bearer <key>` (Ollama Cloud at `https://ollama.com`, or an Ollama behind an authenticated proxy). Without `apiKey` no header is sent, as before. The key is never logged nor included in error messages. New exported type `OllamaProviderConfig` (`AIProviderConfig` plus `apiKey`) for `new OllamaProvider(config, fetch?)`.
