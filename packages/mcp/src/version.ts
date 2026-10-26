/**
 * Identity reported in the MCP `initialize` handshake and by `botmesh-mcp --version`, read
 * from this package's own `package.json` (shipped in the tarball), so a version bump can
 * never leave a stale number behind.
 */
import { readFileSync } from 'node:fs'

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string }

/** The package name, `@botmesh/mcp`. */
export const MCP_SERVER_NAME: string = PACKAGE.name

/** The package version (the `version` field of its `package.json`). */
export const MCP_SERVER_VERSION: string = PACKAGE.version
