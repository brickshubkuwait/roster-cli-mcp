// Shared core for the Roster CLI + MCP. Holds NO database key — it only sends your
// key to the roster-query gateway, which resolves what you can see.
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROSTER_URL = process.env.ROSTER_URL || 'https://sfmdwoxlyvajiutdmqok.supabase.co/functions/v1/roster-query'
// Public publishable key (already shipped in the web app; RLS-protected) — only the
// gateway needs it. The real access control is your key.
const APIKEY = process.env.ROSTER_APIKEY || 'sb_publishable_GLPRkt0_28FOmSuLPqqTHw_6SxNletR'

export const CONNECT_URL = 'roster.bricks.com.kw/connect'
const ROSTER_DIR = join(homedir(), '.roster')
const TOKEN_FILE = join(ROSTER_DIR, 'token')

export function ensureRosterDir({ create = true } = {}) {
  try {
    if (create) mkdirSync(ROSTER_DIR, { recursive: true, mode: 0o700 })
    const st = statSync(ROSTER_DIR)
    if (st.isDirectory() && (st.mode & 0o077)) chmodSync(ROSTER_DIR, 0o700)
  } catch { /* missing dir on read, or a filesystem without modes */ }
}

// Key resolution: env wins, else the file brello auth saved.
export function getToken() {
  const env = process.env.BRELLO_TOKEN || process.env.ROSTER_TOKEN
  if (env) return env.trim()
  ensureRosterDir({ create: false })
  try {
    const st = statSync(TOKEN_FILE)
    if (st.mode & 0o077) chmodSync(TOKEN_FILE, 0o600)
  } catch { /* no saved key yet */ }
  try { return readFileSync(TOKEN_FILE, 'utf8').trim() } catch { return '' }
}
export function saveToken(t) {
  ensureRosterDir()
  writeFileSync(TOKEN_FILE, String(t).trim() + '\n', { mode: 0o600 })
  try { chmodSync(TOKEN_FILE, 0o600) } catch {}
}
export function clearToken() { try { rmSync(TOKEN_FILE) } catch {} }

export const isLegacyKey = (t) => String(t || '').trim().split('.').length === 3
export const LEGACY_HINT = `This key type is retired. Get a new key at ${CONNECT_URL}, then run  brello auth`

const clean = (s, max = 500) => String(s ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const sentence = (s) => (/[.!?]$/.test(s) ? s : s + '.')

let pendingNotice = null
export const noticeOf = (r) => (r && typeof r.notice === 'string' && clean(r.notice)) || null
export function takeNotice() { const n = pendingNotice; pendingNotice = null; return n }

export async function callRoster(query, params = {}, tokenOverride) {
  const token = tokenOverride || getToken()
  if (!token) throw new Error('NO_TOKEN')
  let res
  try {
    res = await fetch(ROSTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: APIKEY, Authorization: `Bearer ${APIKEY}` },
      body: JSON.stringify({ token, query, params }),
    })
  } catch (e) {
    throw new Error(`Network error reaching roster-query: ${e.message}`)
  }
  let j
  try { j = await res.json() } catch { j = null }
  if (!res.ok || !j || j.error) {
    const server = j && typeof j.error === 'string' ? clean(j.error) : ''
    const code = /^[A-Z][A-Z_]{2,40}$/.test(server) ? server : null
    const detail = code && typeof j.message === 'string' ? clean(j.message) : ''
    const err = new Error(detail || server || `HTTP ${res.status}${j ? '' : ' (non-JSON response)'}`)
    err.status = res.status
    err.serverMessage = detail || server
    err.code = code
    err.hint = code && typeof j.hint === 'string' ? clean(j.hint) : ''
    err.retryAfter = res.headers?.get?.('retry-after') || null
    throw err
  }
  const n = noticeOf(j)
  if (n) pendingNotice = n
  return j
}

export function describeError(e, { hints = {} } = {}) {
  try {
    const status = e?.status
    const msg = clean(e?.serverMessage || e?.message || e || 'unknown error')
    if (e?.code && status !== 401 && status !== 429) {
      const hint = clean(hints[e.code] || e.hint || '')
      return `${sentence(msg)}${hint ? ' ' + sentence(hint) : ''} (${e.code})`
    }
    const connect = msg.includes(CONNECT_URL) ? '' : ` Manage your keys at ${CONNECT_URL}.`
    if (msg === 'NO_TOKEN') return `No key yet. Get one at ${CONNECT_URL}, then run  brello auth`
    if (status === 401 || (!status && /invalid or expired/i.test(msg))) {
      if (/retired/i.test(msg)) return `${sentence(msg)} Then run  brello auth`
      return `Your key was refused (${msg}). It may be revoked or expired. Get a new key at ${CONNECT_URL}, then run  brello auth`
    }
    if (status === 429 || /rate limit|too many requests/i.test(msg)) {
      const wait = /^\d+$/.test(String(e?.retryAfter || '')) ? ` Try again in ${e.retryAfter}s.` : ' Wait a moment and try again.'
      const server = clean(e?.serverMessage || (status ? '' : msg))
      return `Too many requests${server ? ': ' + sentence(server) : '.'}${wait}`
    }
    if (/admin-scope only|admin only/i.test(msg)) return 'That one is admin only. Your key does not have access.'
    if (status === 403) {
      if (/paused/i.test(msg)) return `${sentence(msg)}${connect}`
      return `Access refused: ${sentence(msg)}${connect}`
    }
    if (/no scope|token has no scope/i.test(msg)) return `Your key has no department set. Get a new key at ${CONNECT_URL}.`
    if (/Network error|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) return 'Could not reach the roster. Check your internet and try again.'
    if (/not configured/i.test(msg)) return 'That feature is not set up yet on the server.'
    return msg
  } catch {
    return 'Something went wrong.'
  }
}

export const QUERIES = {
  stats:     { desc: 'Team dashboard: team size, open/done/overdue cards, who is active now' },
  team:      { desc: 'Your team members' },
  overdue:   { desc: 'Overdue cards for your team (past due, not done)' },
  workload:  { desc: 'Open + overdue card counts per person' },
  active:      { desc: 'Who is tracking time right now (live Hubstaff timers)' },
  leaves:      { desc: 'Upcoming time off for your team (Vacation Tracker)' },
  comments:    { desc: 'Recent comments on your team’s cards' },
  reactions:   { desc: 'Recent emoji reactions on your team’s cards' },
  activity:    { desc: 'Recent activity on your team’s cards — moves, comments, edits' },
  search:      { desc: 'Search cards by title/client — team scope by default, --board for the whole board', params: ['q', 'scope'] },
  user:        { desc: 'Everything for one person — every card, live AND archived, with their open/done/archived totals', params: ['who'] },
  client:      { desc: 'Everything for one client — every in-scope card (live + done), who is on it, with open/done/overdue totals', params: ['client'] },
  due:         { desc: 'Cards due soon — the next N days (default 7), soonest first', params: ['days'] },
  done:        { desc: 'Recently completed cards — the last N days (default 14)', params: ['days'] },
  blocked:     { desc: 'Blocked or stuck cards — explicit blockers, or overdue by 3+ days' },
  recent:      { desc: 'Recently touched cards across your team (default 20)', params: ['n'] },
  now:         { desc: 'Live pulse — who is tracking now, what is due today, and the latest card moves' },
  card:        { desc: 'Full card detail — workflow, Studio, Salesforce, send/view receipt, Slack thread, sizes and approved copy', params: ['id'] },
  stages:      { desc: 'Board stages with open card counts — team scope by default, --board for board totals' },
  cards:       { desc: 'Every card in a stage (or matching filters) — brello cards "Ready for Sprint" --board [--unassigned]', params: ['stage', 'scope', 'assignee'] },
  stage_stats: { desc: 'Stage usage over the board\'s whole history — cards ever entered, median/p90 dwell hours, and skip-rate per stage' },
  departments: { desc: 'The roster’s departments and headcount' },
  shoots:      { desc: 'The whole shoot schedule — recent + upcoming (company-wide)' },
  studio:      { desc: 'Bricks Studio review feed — submissions, status/version, comments, client views and links', params: ['q', 'scope'] },
  ps_issues: { desc: 'Open Product Support issues (admin only)' },
  audit:     { desc: 'Access log — who queried what, when (admin only)' },
}
