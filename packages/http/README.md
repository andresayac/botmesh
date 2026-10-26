# @botmesh/http

Defensive HTTP client for outbound provider downloads. It requires HTTPS, blocks private/loopback destinations and unsafe DNS, validates every redirect, caps the response and enforces a timeout.

```ts
import { fetchBuffer } from '@botmesh/http'

const image = await fetchBuffer('https://cdn.example/image.png', {
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 10_000,
})
```

Never enable `allowHttp` or `allowPrivateHosts` outside a network you control.

Every request (and every redirect hop) is validated before it is sent: the URL, the host and its DNS answer.
With the default `fetch`, the connection is also pinned to the validated address, so a DNS answer that changes
between the check and the connect (DNS rebinding) cannot reach a private host. You can pass your own `fetch`
(Node's global `fetch`, an instrumented one, a test double): the validation still runs, but a custom `fetch`
gets no pinned connection, so rebinding protection is then up to it.

## Options

`secureFetch(url, options)` and `fetchBuffer(url, options)` take the request fields the client honours plus its policy:

| Option | Default | What it does |
| --- | --- | --- |
| `method`, `headers`, `body`, `signal` | `GET` | Passed to `fetch`. Credential headers are dropped when a redirect changes origin; a 303 (or a 301/302 after a POST) continues as a body-less `GET`. |
| `allowHttp` | `false` | Accept plain `http:`. |
| `allowPrivateHosts` | `false` | Accept loopback/private/link-local destinations (tests, controlled networks). |
| `timeoutMs` | `15000` | Deadline for the whole request: DNS, every hop, headers and body. |
| `maxBytes` | 16 MiB | Largest accepted body. |
| `maxRedirects` | `3` | Redirect hops followed (`0` refuses any redirect). |
| `resolver` | `resolveHost` | DNS resolution (tests, egress gateways). |
| `fetch` | undici's `fetch` | Custom fetch (see above). |

`SecureFetchOptions` no longer extends `RequestInit`: `redirect` is not an option (the client always follows
redirects itself; use `maxRedirects`). Other `RequestInit` fields (`cache`, `keepalive`...) still go through a
deprecated overload until stable. A `ReadableStream` (or async iterable) `body` is sent as a streaming upload: the
client sets the `duplex: 'half'` fetch requires, so no `duplex` option is needed (a 307/308 redirect cannot replay it). `resolvePublicHost` is a deprecated alias of `resolveHost`, which resolves any
host and leaves the verdict to `assertSafeTarget`.

`@botmesh/http` is public and covered by semver.

## Errors

Every policy rejection is a `SecureHttpError` with a stable `code`:

| `code` | When |
| --- | --- |
| `INVALID_URL` | The URL (or a redirect's `Location`) cannot be parsed. |
| `INVALID_OPTIONS` | `timeoutMs`, `maxBytes` or `maxRedirects` out of range. No request is made. |
| `UNSAFE_URL` | Scheme other than HTTPS (without `allowHttp`), credentials in the URL, or no hostname. |
| `UNSAFE_HOST` | The host or its DNS answer points at a private, loopback or link-local address. |
| `TIMEOUT` | The whole request exceeded `timeoutMs`. |
| `RESPONSE_TOO_LARGE` | The body exceeded `maxBytes`. |
| `TOO_MANY_REDIRECTS` | More hops than `maxRedirects`. |
| `HTTP_STATUS` | `fetchBuffer` got a non-2xx response; the code is in `error.status`. `secureFetch` does not reject on status: it returns the `response`. |

Network failures that are not a policy decision (DNS `ENOTFOUND`, connection refused, TLS errors) reject with the
underlying error, and an aborted `signal` rejects with its `reason`.

```ts
import { fetchBuffer, SecureHttpError } from '@botmesh/http'

try {
  await fetchBuffer(url)
} catch (error) {
  if (error instanceof SecureHttpError && error.code === 'HTTP_STATUS' && error.status === 404) {
    // the resource no longer exists
  }
}
```
