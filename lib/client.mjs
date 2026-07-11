// Shared core for the Roster CLI + MCP. Holds NO database key — it only sends your
// token to the roster-query gateway, which resolves what you can see.
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

const ROSTER_URL = process.env.ROSTER_URL || 'https://sfmdwoxlyvajiutdmqok.supabase.co/functions/v1/roster-query'
// Public publishable key (already shipped in the web app; RLS-protected) — only the
// gateway needs it. The real access control is your token.
const APIKEY = process.env.ROSTER_APIKEY || 'sb_publishable_GLPRkt0_28FOmSuLPqqTHw_6SxNletR'

const TOKEN_FILE = join(homedir(), '.roster', 'token')

// Token resolution: ROSTER_TOKEN env wins (handy for CI / MCP), else the saved file.
export function getToken() {
  const env = process.env.BRELLO_TOKEN || process.env.ROSTER_TOKEN
  if (env) return env.trim()
  try { return readFileSync(TOKEN_FILE, 'utf8').trim() } catch { return '' }
}
export function saveToken(t) {
  mkdirSync(join(homedir(), '.roster'), { recursive: true })
  writeFileSync(TOKEN_FILE, String(t).trim() + '\n', { mode: 0o600 })
  try { chmodSync(TOKEN_FILE, 0o600) } catch {}
}
export function clearToken() { try { rmSync(TOKEN_FILE) } catch {} }

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
  try { j = await res.json() } catch { throw new Error(`HTTP ${res.status} (non-JSON response)`) }
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`)
  return j
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
  card:        { desc: 'Full card detail — description, stage, subtasks, split, collaborators, links', params: ['id'] },
  stages:      { desc: 'Board stages with open card counts — team scope by default, --board for board totals' },
  cards:       { desc: 'Every card in a stage (or matching filters) — brello cards "Ready for Sprint" --board [--unassigned]', params: ['stage', 'scope', 'assignee'] },
  stage_stats: { desc: 'Stage usage over the board\'s whole history — cards ever entered, median/p90 dwell hours, and skip-rate per stage' },
  departments: { desc: 'The roster’s departments and headcount' },
  shoots:      { desc: 'The whole shoot schedule — recent + upcoming (company-wide)' },
  markup:      { desc: 'Markup.io review feed — videos/images submitted for review, with open comment-thread counts + links', params: ['q'] },
  ps_issues: { desc: 'Open Product Support issues (admin only)' },
  audit:     { desc: 'Access log — who queried what, when (admin only)' },
}
