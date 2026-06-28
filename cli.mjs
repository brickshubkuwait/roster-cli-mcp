#!/usr/bin/env node
// Brello CLI — query your team's work.
//   brello login <token>   (one time)   then:
//   brello stats | team | overdue | workload | active | leaves
//   brello comments | reactions | search "<text>" | card <id> | shoots | help
import { callRoster, QUERIES, saveToken, clearToken, getToken } from './lib/client.mjs'

const [, , cmd, ...rest] = process.argv

// ── auth: interactive, prompts for the token + a little terminal theatre ──
if (cmd === 'auth') { const { runAuth } = await import('./lib/auth.mjs'); await runAuth(); process.exit(0) }

// ── login / logout: save the token once so you never re-export it ──
if (cmd === 'login') {
  const t = (rest[0] || '').trim()
  if (!t) { console.error('Paste your token:  brello login <token from your admin>'); process.exit(1) }
  saveToken(t)
  console.log('✓ Token saved. Try:  brello stats')
  process.exit(0)
}
if (cmd === 'logout') { clearToken(); console.log('✓ Token removed.'); process.exit(0) }
if (cmd === 'whoami') { console.log(getToken() ? '✓ A token is set.' : '✗ No token. Run: brello auth'); process.exit(0) }

// command -> { q: query name, arg: hint, admin: bool }
const COMMANDS = {
  stats:       { q: 'stats' },
  team:        { q: 'team' },
  overdue:     { q: 'overdue' },
  workload:    { q: 'workload' },
  active:      { q: 'active' },
  leaves:      { q: 'leaves' },
  comments:    { q: 'comments' },
  reactions:   { q: 'reactions' },
  activity:    { q: 'activity' },
  search:      { q: 'search', arg: '"<text>"' },
  card:        { q: 'card', arg: '<id>' },
  stages:      { q: 'stages' },
  departments: { q: 'departments' },
  shoots:      { q: 'shoots' },
  'ps-issues': { q: 'ps_issues', admin: true },
  audit:       { q: 'audit', admin: true },
}

function table(rows) {
  if (!rows || !rows.length) { console.log('  (nothing here right now)'); return }
  if (typeof rows[0] !== 'object') { rows.forEach(r => console.log('  ' + r)); return }
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const w = Object.fromEntries(cols.map(c => [c, Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))]))
  const line = cells => cols.map(c => String(cells[c] ?? '').padEnd(w[c])).join('  ')
  console.log('  ' + line(Object.fromEntries(cols.map(c => [c, c.toUpperCase()]))))
  console.log('  ' + cols.map(c => '-'.repeat(w[c])).join('  '))
  rows.forEach(r => console.log('  ' + line(r)))
}

function printObject(o) {
  // A clean key: value list (used for stats + a single card) instead of raw JSON.
  if (o == null) { console.log('  (nothing here right now)'); return }
  const w = Math.max(...Object.keys(o).map(k => k.length))
  for (const [k, v] of Object.entries(o)) console.log('  ' + (k.replace(/_/g, ' ') + ':').padEnd(w + 2) + (v ?? '—'))
}

function help() {
  console.log('\nBrello CLI\n')
  for (const [c, def] of Object.entries(COMMANDS)) {
    const label = (c + (def.arg ? ' ' + def.arg : '')).padEnd(20)
    console.log('  brello ' + label + (QUERIES[def.q]?.desc || '') + (def.admin ? '  (admin only)' : ''))
  }
  console.log('\n  First, sign in:  brello auth   (paste the token your admin gave you)')
  console.log('  Then try:        brello stats\n')
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(); process.exit(0) }
const def = COMMANDS[cmd]
if (!def) { console.error(`I don't know "${cmd}".`); help(); process.exit(1) }

const params = {}
if (def.q === 'search') {
  params.q = rest.join(' ').trim()
  if (!params.q) { console.error('Add what to search for, e.g.   brello search "reel"'); process.exit(1) }
}
if (def.q === 'card') {
  params.id = (rest[0] || '').trim()
  if (!params.id) { console.error('Add a card id (first 8 chars are fine), e.g.   brello card 1c11685c'); process.exit(1) }
}

try {
  const r = await callRoster(def.q, params)
  console.log(`\n${cmd.toUpperCase()}  —  ${r.count} result${r.count === 1 ? '' : 's'}\n`)
  if (Array.isArray(r.data)) table(r.data)
  else printObject(r.data)
  if (r.note) console.log('\n  note: ' + r.note)
  console.log('\n  (run `brello help` to see everything you can ask)\n')
} catch (e) {
  const m = e.message || String(e)
  if (/NO_TOKEN/.test(m)) console.error('✖ No token yet. Get one from your admin, then run:  brello auth')
  else if (/invalid or expired/.test(m)) console.error('✖ Your token is invalid or has expired — ask your admin for a fresh one.')
  else if (/admin-scope only/.test(m)) console.error('✖ That one is admin-only — your token does not have access.')
  else console.error('✖ ' + m)
  process.exit(1)
}
