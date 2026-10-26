# @botmesh/http

Defensive HTTP client for outbound requests to URLs you do not fully trust: media downloads, callbacks, user-supplied links. It requires HTTPS, refuses private and loopback destinations (also through DNS), validates every redirect hop, caps the response size and enforces one deadline for the whole request.

Every botmesh transport downloads media through it. Install it yourself only to make your own requests with the same protection.

## Install

```bash
pnpm add @botmesh/http
```

Node.js 22 or later, ESM only. Its only dependency is [undici](https://github.com/nodejs/undici).

> **Prerelease.** Until the stable release, botmesh packages are published under a prerelease dist-tag instead of `latest`: add it to the command (`pnpm add @botmesh/http@alpha`, or `@beta` during the beta).

## Quick start

```ts
import { fetchBuffer, secureFetch } from '@botmesh/http'

// Download a body into memory: at most 8 MiB, within 10 s, rejects on a non-2xx status
const image = await fetchBuffer('https://cdn.example.com/image.png', {
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 10_000,
})

// Or get the response and decide yourself (secureFetch does not reject on 4xx/5xx)
const { response, body } = await secureFetch('https://api.example.com/items', {
  headers: { accept: 'application/json' },
})
if (response.ok) console.log(JSON.parse(body.toString('utf8')))
```

`secureFetch` resolves to `{ url, response, body }`: the final URL after redirects, the `Response` (status and headers) and the body, already read into a `Buffer` under the `maxBytes` cap.

## How it protects you

- **Before each request and each redirect hop** it checks the URL (scheme, no credentials), the host and every address its name resolves to. Private, loopback, link-local and other non-public ranges are refused.
- **DNS rebinding:** with the default `fetch`, the connection is pinned to the address that was checked, so a DNS answer that changes between the check and the connect cannot reach a private host. A custom `fetch` (your own, an instrumented one, a test double) still gets every check, but not the pinned connection: rebinding protection is then up to it.
- **Redirects** are followed by the client itself, at most `maxRedirects` hops. Credential headers are dropped when a redirect changes origin, and a 303 (or a 301/302 after a `POST`) continues as a body-less `GET`.
- **Limits:** the body is capped at `maxBytes`, and `timeoutMs` covers DNS, every hop, the headers and the body.

Never enable `allowHttp` or `allowPrivateHosts` outside a network you control: they switch those checks off for that request.

## Options

`secureFetch(url, options)` and `fetchBuffer(url, options)` take the same options:

| Option | Default | What it does |
| --- | --- | --- |
| `method`, `headers`, `body`, `signal` | `GET` | Passed to `fetch`. A `ReadableStream` or async-iterable `body` is streamed (the client sets `duplex: 'half'`); a 307/308 redirect cannot replay it. |
| `allowHttp` | `false` | Accept plain `http:`. |
| `allowPrivateHosts` | `false` | Accept private, loopback and link-local destinations (tests, internal services). |
| `timeoutMs` | `15000` | Deadline for the whole request. |
| `maxBytes` | 16 MiB | Largest accepted body. |
| `maxRedirects` | `3` | Redirect hops followed (`0` refuses any redirect). |
| `resolver` | `resolveHost` | DNS resolution, `(hostname) => Promise<readonly string[]>` (tests, egress gateways). |
| `fetch` | undici's `fetch` | Custom `fetch` (see above). |

There is no `redirect` option: use `maxRedirects`. Other `RequestInit` fields (`cache`, `keepalive`…) are still accepted through a deprecated overload.

## Other exports

| Export | What it is for |
| --- | --- |
| `assertSafeTarget(url, { allowHttp?, allowPrivateHosts?, resolver? })` | The check `secureFetch` runs before each hop. Resolves to the validated addresses or rejects with a `SecureHttpError`. |
| `isAllowedHostUrl(url, { hosts, allowHttp?, maxLength? })` | Synchronous allow-list check for a URL read back from storage. A listed name also allows its subdomains. It does not resolve DNS: still fetch the URL with `secureFetch`. |
| `resolveHost(hostname)` | The default resolver: every address `dns.lookup` returns, without judging them. |
| `isPrivateAddress(address)` | Whether an IP literal (or a `localhost` name) is in a non-public range. No DNS lookup. |
| `resolvePublicHost` | Deprecated alias of `resolveHost`. |

## Errors

Every policy rejection is a `SecureHttpError` with a stable `code`:

| `code` | When |
| --- | --- |
| `INVALID_URL` | The URL (or a redirect's `Location`) cannot be parsed. |
| `INVALID_OPTIONS` | `timeoutMs`, `maxBytes` or `maxRedirects` is out of range. No request is made. |
| `UNSAFE_URL` | A scheme other than HTTPS (without `allowHttp`), credentials in the URL, or no hostname. |
| `UNSAFE_HOST` | The host or its DNS answer points at a private, loopback or link-local address. |
| `TIMEOUT` | The whole request took longer than `timeoutMs`. |
| `RESPONSE_TOO_LARGE` | The body is larger than `maxBytes`. |
| `TOO_MANY_REDIRECTS` | More hops than `maxRedirects`. |
| `HTTP_STATUS` | `fetchBuffer` got a non-2xx response; the status is in `error.status`. |

Network failures that are not a policy decision (DNS `ENOTFOUND`, connection refused, TLS errors) reject with the underlying error, and an aborted `signal` rejects with its `reason`.

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

## Links

- [Security guide](https://andresayac.github.io/botmesh/guide/security): how botmesh treats webhooks, untrusted input and outbound requests.
- [Troubleshooting](https://andresayac.github.io/botmesh/guide/troubleshooting) · [Changelog](https://github.com/andresayac/botmesh/blob/main/packages/http/CHANGELOG.md) · [Source](https://github.com/andresayac/botmesh/tree/main/packages/http) · [Issues](https://github.com/andresayac/botmesh/issues)

Public package, covered by semver.
