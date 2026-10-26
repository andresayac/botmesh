/**
 * Manifest validation: id, semver, entry path and runtime compatibility. Pure (no I/O),
 * shared by the registry and re-exported for hosts that validate before installing.
 */

import { parseRange, parseVersion, satisfies } from './semver.js'
import { PluginManifestError, type PluginManifest, type PluginPermission } from './types.js'

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,62}$/

/** Every {@link PluginPermission}; a manifest declaring anything else is rejected. */
export const PLUGIN_PERMISSIONS: readonly PluginPermission[] = Object.freeze([
  'messages:read',
  'messages:send',
  'contacts:read',
  'contacts:write',
  'network:egress',
  'secrets:read',
])

/**
 * Validate a manifest against the running BotWA version and return a copy holding only
 * the known fields, with deduplicated permissions. The input is treated as untrusted
 * (e.g. parsed JSON): every field is type-checked. Throws {@link PluginManifestError} on
 * the first failing check.
 */
export function validateManifest(manifest: PluginManifest, runtimeVersion: string): PluginManifest {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new PluginManifestError('manifest must be an object')
  }
  if (typeof manifest.id !== 'string' || !PLUGIN_ID.test(manifest.id)) {
    throw new PluginManifestError('plugin id must be lowercase kebab-case')
  }
  if (typeof manifest.version !== 'string' || !parseVersion(manifest.version)) {
    throw new PluginManifestError('plugin version must be semver')
  }
  if (!isRelativeEntry(manifest.entry)) {
    throw new PluginManifestError('plugin entry must be a relative path')
  }
  const runtime = typeof runtimeVersion === 'string' ? parseVersion(runtimeVersion) : undefined
  if (!runtime) {
    throw new PluginManifestError('runtime version must be semver')
  }
  const range = typeof manifest.botwa === 'string' ? parseRange(manifest.botwa) : undefined
  if (!range) {
    throw new PluginManifestError('invalid botwa range')
  }
  if (!satisfies(runtime, range)) {
    throw new PluginManifestError('plugin is incompatible with this BotWA runtime')
  }
  const permissions: unknown = manifest.permissions
  if (!Array.isArray(permissions) || !permissions.every((permission) => typeof permission === 'string')) {
    throw new PluginManifestError('plugin permissions must be an array of strings')
  }
  const unknown = permissions.filter((permission) => !(PLUGIN_PERMISSIONS as readonly string[]).includes(permission))
  if (unknown.length) {
    throw new PluginManifestError(`unknown permission(s): ${[...new Set(unknown)].map((p) => JSON.stringify(p.slice(0, 64))).join(', ')}`)
  }
  for (const field of ['name', 'description'] as const) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'string') {
      throw new PluginManifestError(`plugin ${field} must be a string`)
    }
  }
  return {
    id: manifest.id,
    version: manifest.version,
    botwa: manifest.botwa,
    entry: manifest.entry,
    permissions: [...new Set(permissions as PluginPermission[])],
    ...(manifest.name !== undefined ? { name: manifest.name } : {}),
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
  }
}

/**
 * `true` for a POSIX relative path that stays inside the plugin package: no
 * absolute or drive/UNC paths, URLs, backslashes, control characters, empty
 * segments or `..` segments. Names merely containing dots (`a..b.js`) are fine.
 */
export function isRelativeEntry(entry: unknown): boolean {
  if (typeof entry !== 'string' || !entry.trim()) return false
  // Backslashes, colons (drive letters, URL schemes, NTFS streams) and control characters.
  if (/[\\:\u0000-\u001f\u007f]/.test(entry)) return false
  if (entry.startsWith('/')) return false
  const segments = entry.split('/')
  if (segments.some((segment) => segment === '' || segment === '..')) return false
  return segments[segments.length - 1] !== '.'
}
