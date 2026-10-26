---
'@botmesh/ai': patch
---

`fromGoogleGenAI(new GoogleGenAI(...))` compiles without a cast. `GoogleGenAILike` did not accept a real `@google/genai` client: its `config` parameter was a `Record` (the SDK's `GenerateContentConfig` is an interface) and its responses required `functionCall.name` / `functionResponse.name` (the SDK marks every field optional). The contract now takes `config?: object` and optional names; a function call without a name is dropped, since it cannot be run.
