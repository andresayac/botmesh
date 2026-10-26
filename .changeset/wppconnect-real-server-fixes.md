---
"@botmesh/wppconnect": patch
---

Fixes found against a real wppconnect-server (`server-cli:1.3.50`):

- An unpaired session no longer reports `ready`: the `status-find` value `inChat` (which WA-JS also sends before `notLogged` on a fresh session) is ignored; `isLogged` and `qrReadSuccess` still mean ready.
- Unlinking the device from the phone (`disconnectedMobile`, the current spelling) now closes the connection with `sessionInvalid`, and `phoneNotConnected` closes it as `transient`. Before, only the old `desconnectedMobile` spelling was recognized.
- A contact first seen by its LID is no longer looked up through `contact/pn-lid` on every message once the lookup linked it to its number.
- Calls to a session that is not started, not paired or closed (`404 { status: 'Disconnected' }`) reject with "WPPConnect session is not connected: start it … and pair it" instead of the server's Portuguese message alone, and an HTML error page is reduced to its text (`Cannot POST /api/…`).
- A `contact` whose `phone` has no digits and a `location` with coordinates outside ±90/±180 reject with `UnsupportedContentError` before any request.
