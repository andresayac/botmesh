---
"@botmesh/chatwoot": patch
---

Fixes found testing against a self-hosted Chatwoot 4.7:

- Contacts are looked up by exact `identifier` through the contacts filter API. The paginated substring search could miss the chat's contact (15 per page), and recreating it failed with 422 "Identifier has already been taken" for every message of that chat.
- A lost mapping (new store, restart on `MemoryStore`) re-links the chat to its contact's existing contact inbox and newest conversation in the inbox, instead of opening a second one where agent replies went nowhere.
- A message refused with 422 because Chatwoot is still deleting the contact's conversation is re-sent to a new conversation instead of being lost.
- An agent reply the channel refuses is marked `failed` in Chatwoot, with the error name, so the agent sees it.
- Clearer mistakes: an `http://` `baseUrl` without `http.allowHttp` throws at construction, a blocked private host names `http.allowPrivateHosts`, a parsed (non-raw) webhook body reports how to fix it, and plugging one instance into two bots throws.
- `ChatwootApiError` no longer carries the query string (which held the chat id) in its message or `path`.
- New client methods `listContactConversations`, `getConversation` and `updateMessageStatus`, and the types `ChatwootConversationRef` and `ChatwootMessageStatus`.
