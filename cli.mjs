#!/usr/bin/env node
// Brello CLI — query your team's work.
//   brello login <token>   (one time)   then:
//   brello stats | team | overdue | workload | active | leaves
//   brello comments | reactions | search "<text>" | card <id> | shoots | help
import { callRoster, QUERIES, saveToken, clearToken, getToken } from './lib/client.mjs'

const [, , cmd, ...rest] = process.argv

// ── terminal style kit: ANSI palette + box-drawing (no-ops when piped) ──
const TTY = process.stdout.isTTY
const wrap = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s)
const c = {
  bold: wrap(1), dim: wrap(2), cyan: wrap(36), green: wrap(32),
  amber: wrap(33), red: wrap(31), magenta: wrap(35), grey: wrap(90),
}
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '')
const vlen = (s) => stripAnsi(s).length
const padEndV = (s, w) => s + ' '.repeat(Math.max(0, w - vlen(s)))
const trunc = (s, w) => { s = String(s ?? ''); return s.length > w ? s.slice(0, Math.max(1, w - 1)) + '…' : s }
const MAXW = 46
// Semantic cell colour: status / thread-count / booleans light up.
function paint(col, val) {
  const s = String(val ?? '')
  if (!s) return c.dim('·')
  if (col === 'status') return s === 'live' ? c.green(s) : s === 'done' ? c.cyan(s) : s === 'archived' ? c.grey(s) : s
  if (col === 'open_threads' || col === 'overdue') return (+s > 0) ? c.amber(s) : c.dim(s)
  if (col === 'done') return s === 'true' ? c.green('✓') : s === 'false' ? c.dim('·') : s
  return s
}

// ── auth: interactive, prompts for the token + a little terminal theatre ──
if (cmd === 'auth') { const { runAuth } = await import('./lib/auth.mjs'); await runAuth(); process.exit(0) }

// ── login / logout: save the token once so you never re-export it ──
if (cmd === 'login') {
  const t = (rest[0] || '').trim()
  if (!t) { console.error('Paste your token:  brello login <token from your admin>'); process.exit(1) }
  saveToken(t)
  console.log(c.green('✓') + ' token saved' + c.dim('  ·  try:  ') + c.cyan('brello stats'))
  process.exit(0)
}
if (cmd === 'logout') { clearToken(); console.log(c.green('✓') + ' token removed'); process.exit(0) }
if (cmd === 'whoami') { console.log(getToken() ? c.green('✓') + ' a token is set' : c.red('✗') + ' no token  ' + c.dim('· run:  ') + c.cyan('brello auth')); process.exit(0) }

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
  user:        { q: 'user', arg: '<name>' },
  card:        { q: 'card', arg: '<id>' },
  stages:      { q: 'stages' },
  departments: { q: 'departments' },
  shoots:      { q: 'shoots' },
  markup:      { q: 'markup', arg: '[filter]' },
  'ps-issues': { q: 'ps_issues', admin: true },
  audit:       { q: 'audit', admin: true },
}

function table(rows) {
  if (!rows || !rows.length) { console.log(c.dim('  · nothing here right now')); return }
  if (typeof rows[0] !== 'object') { rows.forEach(r => console.log('  ' + c.cyan('›') + ' ' + r)); return }
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const w = Object.fromEntries(cols.map(col => [col, Math.min(MAXW, Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)))]))
  const bar = (l, m, rt) => c.dim('  ' + l + cols.map(col => '─'.repeat(w[col] + 2)).join(m) + rt)
  const row = (cells, fn) => '  ' + c.dim('│') + cols.map(col => ' ' + padEndV(fn(col, cells[col]), w[col]) + ' ').join(c.dim('│')) + c.dim('│')
  console.log(bar('┌', '┬', '┐'))
  console.log(row(Object.fromEntries(cols.map(col => [col, col])), (col) => c.bold(c.cyan(trunc(col.toUpperCase().replace(/_/g, ' '), w[col])))))
  console.log(bar('├', '┼', '┤'))
  rows.forEach(r => console.log(row(r, (col, v) => paint(col, trunc(v, w[col])))))
  console.log(bar('└', '┴', '┘'))
}

function printObject(o) {
  // Left-bar key/value list (used for stats + a single card) instead of raw JSON.
  if (o == null) { console.log(c.dim('  · nothing here right now')); return }
  const w = Math.max(...Object.keys(o).map(k => k.length))
  for (const [k, v] of Object.entries(o)) console.log('  ' + c.dim('┃ ') + c.cyan((k.replace(/_/g, ' ')).padEnd(w)) + '  ' + (v == null ? c.dim('—') : String(v)))
}

function help() {
  const tty = process.stdout.isTTY
  const B = tty ? '\x1b[1m' : '', D = tty ? '\x1b[2m' : '', C = tty ? '\x1b[36m' : '', R = tty ? '\x1b[0m' : ''
  const SECTIONS = [
    { title: 'Get started', rows: [
      ['auth', '', 'Sign in — paste the token your admin gave you'],
      ['whoami', '', 'Check whether a token is set'],
      ['logout', '', 'Remove your saved token'],
    ] },
    { title: 'Your team',        cmds: ['stats', 'team', 'workload', 'overdue', 'active', 'leaves', 'departments'] },
    { title: 'Cards & people',   cmds: ['search', 'user', 'card', 'activity', 'comments', 'reactions'] },
    { title: 'Board & production', cmds: ['stages', 'shoots', 'markup'] },
    { title: 'Admin',            cmds: ['ps-issues', 'audit'] },
  ]
  const groups = SECTIONS.map(s => ({
    title: s.title,
    items: s.rows || s.cmds.map(k => [k, COMMANDS[k]?.arg || '', QUERIES[COMMANDS[k]?.q]?.desc || '']),
  }))
  const w = Math.max(...groups.flatMap(g => g.items.map(([n, a]) => (n + (a ? ' ' + a : '')).length)))
  console.log(`\n${B}brello${R} ${D}— your team's work, from the terminal${R}\n`)
  for (const g of groups) {
    console.log(`${B}${g.title}${R}`)
    for (const [n, a, desc] of g.items) {
      console.log(`  ${C}${(n + (a ? ' ' + a : '')).padEnd(w)}${R}  ${D}${desc}${R}`)
    }
    console.log('')
  }
  console.log(`${D}  examples:  brello user Samer   ·   brello markup reel   ·   brello card 1c11685c${R}`)
  console.log(`${D}  new here?  run  ${R}${C}brello auth${R}${D}  first, then  ${R}${C}brello stats${R}\n`)
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
if (def.q === 'user') {
  params.who = rest.join(' ').trim()
  if (!params.who) { console.error('Add a name, e.g.   brello user Samer'); process.exit(1) }
}
if (def.q === 'markup') {
  const f = rest.join(' ').trim()
  if (f) params.q = f   // optional name filter, e.g.  brello markup reel
}

try {
  const r = await callRoster(def.q, params)
  if (r.person) {
    const p = r.person, t = r.totals || {}
    const sub = [p.role ? p.role.replace(/_/g, ' ') : '', p.department].filter(Boolean).join(' · ')
    console.log(`\n${c.cyan('❯')} ${c.bold(p.name)}${sub ? '  ' + c.dim(sub) : ''}`)
    console.log(`  ${c.green((t.live ?? 0) + ' live')}${c.dim(' · ')}${c.cyan((t.done ?? 0) + ' done')}${c.dim(' · ')}${c.grey((t.archived ?? 0) + ' archived')}${c.dim('   (' + (t.cards ?? r.count) + ' total)')}`)
    if (r.active_on) console.log(`  ${c.amber('● tracking now')}${c.dim(' → ')}${r.active_on}`)
    console.log('')
  } else {
    console.log(`\n${c.cyan('❯')} ${c.bold(cmd)}${c.dim(` · ${r.count} result${r.count === 1 ? '' : 's'}`)}\n`)
  }
  if (Array.isArray(r.data)) table(r.data)
  else printObject(r.data)
  if (r.note) console.log('\n  ' + c.dim('▸ ') + c.amber(r.note))
  console.log(c.dim(`\n  ↳ brello help  ·  for everything you can ask\n`))
} catch (e) {
  const m = e.message || String(e)
  if (/NO_TOKEN/.test(m)) console.error('✖ No token yet. Get one from your admin, then run:  brello auth')
  else if (/invalid or expired/.test(m)) console.error('✖ Your token is invalid or has expired — ask your admin for a fresh one.')
  else if (/admin-scope only/.test(m)) console.error('✖ That one is admin-only — your token does not have access.')
  else console.error('✖ ' + m)
  process.exit(1)
}
