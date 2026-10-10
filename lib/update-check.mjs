// New-version notice for the CLI (never the MCP server, never under --json).
//
// The CLI reads the cached result synchronously and prints one dim line when a
// newer brello is out. When the cache is a day old (or missing) it starts this
// file as a detached child (`node update-check.mjs --refresh`) that asks the
// npm registry, with a 1500 ms timeout, and writes ~/.roster/.version-check.
// Nothing here can block, slow down or fail a command: every error is silent.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REGISTRY_URL = 'https://registry.npmjs.org/brello/latest'
export const CHECK_FILE = join(homedir(), '.roster', '.version-check')
export const DAY_MS = 864e5
export const TIMEOUT_MS = 1500

const parts = (v) => String(v || '').replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => parseInt(n, 10))
// true when `latest` is a higher release than `current` (prerelease tags ignored)
export function isNewer(latest, current) {
  const a = parts(latest), b = parts(current)
  if (a.length < 3 || a.some((n) => !Number.isFinite(n))) return false
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0, y = Number.isFinite(b[i]) ? b[i] : 0
    if (x !== y) return x > y
  }
  return false
}

export const updateLine = (latest) => `brello ${latest} is out, update with: npm i -g brello`

export function readCache(file = CHECK_FILE) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return j && typeof j.checked_at === 'number' ? j : null
  } catch { return null }
}

// Ask the registry once and record the answer (or the failed attempt, so a
// broken network is retried tomorrow, not on every command).
export async function refreshLatest({ fetchImpl = globalThis.fetch, file = CHECK_FILE, timeoutMs = TIMEOUT_MS, now = Date.now() } = {}) {
  let latest = null
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      const res = await fetchImpl(REGISTRY_URL, { signal: ac.signal, headers: { accept: 'application/json' } })
      if (res && res.ok) {
        const j = await res.json()
        if (typeof j?.version === 'string' && /^\d+\.\d+\.\d+/.test(j.version)) latest = j.version
      }
    } finally { clearTimeout(timer) }
  } catch { latest = null }
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, JSON.stringify({ checked_at: now, latest }) + '\n', { mode: 0o600 })
  } catch { /* read-only home: stay quiet */ }
  return latest
}

// What to print now (from the cache) and whether a refresh is due.
export function versionNotice({ current, file = CHECK_FILE, now = Date.now() } = {}) {
  try {
    const cache = readCache(file)
    const stale = !cache || now - cache.checked_at >= DAY_MS || cache.checked_at > now
    const line = cache?.latest && isNewer(cache.latest, current) ? updateLine(cache.latest) : null
    return { line, stale }
  } catch { return { line: null, stale: false } }
}

// Fire and forget: a detached child does the network call, so the command
// never waits for it, even when it exits immediately.
export function refreshInBackground() {
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--refresh'], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch { /* never fail a command over this */ }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--refresh')) {
  await refreshLatest().catch(() => null)
}
