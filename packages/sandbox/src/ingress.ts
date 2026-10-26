/**
 * Serve bot webhooks for the simulators: one node:http server on 127.0.0.1
 * with an `@botmesh/server` ingress (raw body, limits, health) and one route
 * per channel.
 */

import { createIngress, createNodeHandler, type IngressRoute } from '@botmesh/server'
import { listen } from './sim/http.js'

export interface BotIngress {
  /** `http://127.0.0.1:<port>` */
  url: string
  port: number
  /** Full URL of a route path. */
  webhook(path: string): string
  close(): Promise<void>
}

export async function serveWebhooks(routes: IngressRoute[], opts: { port?: number; host?: string } = {}): Promise<BotIngress> {
  const ingress = createIngress({ routes, maxBodyBytes: 32 * 1024 * 1024 })
  const handler = createNodeHandler(ingress)
  const l = await listen(handler, opts)
  return {
    url: l.url,
    port: l.port,
    webhook: (path) => `${l.url}${path}`,
    close: async () => {
      await ingress.close({ timeoutMs: 2_000 })
      await l.close()
    },
  }
}
