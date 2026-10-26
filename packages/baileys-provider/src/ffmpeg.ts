/**
 * ffmpeg — locate and run the ffmpeg binary used to transcode voice notes.
 *
 * No wrapper library and no bundled binary: the provider spawns ffmpeg itself. The
 * binary is, in order, `FFMPEG_PATH`, the optional `ffmpeg-static` package (only when
 * its downloaded binary is actually on disk: pnpm skips its install script unless the
 * build is allowed), and finally `ffmpeg` on the PATH.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Loads the path exported by the optional `ffmpeg-static` package (throws when it is not installed). */
export type FfmpegStaticLoader = () => Promise<string | null | undefined>

const loadFfmpegStatic: FfmpegStaticLoader = async () => {
  // A variable specifier keeps TypeScript and bundlers from resolving the optional peer.
  const name = 'ffmpeg-static'
  const mod = (await import(/* @vite-ignore */ name)) as { default?: unknown }
  const path = mod.default ?? mod
  return typeof path === 'string' ? path : null
}

/** Which ffmpeg binary to run, and why the optional `ffmpeg-static` package was skipped. */
export interface FfmpegResolution {
  /** The binary to spawn. */
  bin: string
  /**
   * The path `ffmpeg-static` exported when the package is installed but that file does not
   * exist (its install script, which downloads the binary, did not run). Absent otherwise.
   */
  staticBinaryMissing?: string
}

/** The ffmpeg binary to run (see the module doc for the lookup order). */
export async function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env, loadStatic: FfmpegStaticLoader = loadFfmpegStatic): Promise<FfmpegResolution> {
  const fromEnv = env.FFMPEG_PATH?.trim()
  if (fromEnv) return { bin: fromEnv }
  let path: string | null | undefined
  try {
    path = await loadStatic()
  } catch {
    // ffmpeg-static is an optional peer: not installed is the normal case.
    return { bin: 'ffmpeg' }
  }
  if (path && existsSync(path)) return { bin: path }
  return path ? { bin: 'ffmpeg', staticBinaryMissing: path } : { bin: 'ffmpeg' }
}

/** The ffmpeg binary to run (see the module doc for the lookup order). */
export async function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env, loadStatic: FfmpegStaticLoader = loadFfmpegStatic): Promise<string> {
  return (await resolveFfmpeg(env, loadStatic)).bin
}

/** ffmpeg could not be started at all (missing binary, no permission): nothing was transcoded. */
export class FfmpegNotFoundError extends Error {
  constructor(readonly bin: string, cause: unknown) {
    super(`ffmpeg could not be started (${bin}: ${cause instanceof Error ? cause.message : String(cause)})`)
    this.name = 'FfmpegNotFoundError'
    ;(this as { cause?: unknown }).cause = cause
  }
}

/** Longest stderr tail kept for the error message of a failed run. */
const STDERR_TAIL = 2_000

/**
 * Run `bin args…` and resolve when it exits with code 0. Rejects with
 * {@link FfmpegNotFoundError} when the process cannot be spawned, and with an Error carrying
 * the exit code (or signal) and the tail of stderr otherwise. The process is killed after
 * `timeoutMs`.
 */
export function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let stderr = ''
    let timedOut = false
    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    timer.unref?.()
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') finish(new FfmpegNotFoundError(bin, err))
      else finish(err)
    })
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) return finish()
      const why = timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : code !== null ? `exited with code ${code}` : `was killed by ${signal ?? 'a signal'}`
      const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
      finish(new Error(`ffmpeg ${why}${tail ? `: ${tail}` : ''}`))
    })
  })
}
