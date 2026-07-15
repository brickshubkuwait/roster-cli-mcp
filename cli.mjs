#!/usr/bin/env node
// Brello CLI — query your team's work.
//   brello login <token>   (one time)   then:
//   brello stats | team | overdue | workload | active | leaves
//   brello comments | reactions | search "<text>" | card <id> | shoots | help
import { callRoster, QUERIES, saveToken, clearToken, getToken } from './lib/client.mjs'
import { CHANGELOG, VERSION } from './lib/changelog.mjs'
import { homedir } from 'node:os'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [, , cmd, ...rest] = process.argv

// ── terminal style kit: ANSI palette + box-drawing (no-ops when piped) ──
const TTY = process.stdout.isTTY
const wrap = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s)
const c = {
  bold: wrap(1), dim: wrap(2), cyan: wrap(36), green: wrap(32),
  amber: wrap(33), red: wrap(31), magenta: wrap(35), grey: wrap(90),
}
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '')

// ── braille fetch shimmer: spins on stderr while we wait on the gateway, so
// piped/redirected stdout stays clean. No-op unless stderr is a real TTY. ──
const SPIN = process.stderr.isTTY
const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
function startSpinner(label = 'querying roster') {
  if (!SPIN) return () => {}
  process.stderr.write('\x1b[?25l') // hide cursor
  let i = 0
  const tick = () => process.stderr.write('\r  ' + c.cyan(BRAILLE[i = (i + 1) % BRAILLE.length]) + ' ' + c.dim(label) + ' …')
  tick()
  const id = setInterval(tick, 80)
  return () => { clearInterval(id); process.stderr.write('\r\x1b[2K\x1b[?25h') } // erase line + show cursor
}
async function withSpinner(label, fn) {
  const stop = startSpinner(label)
  try { return await fn() } finally { stop() }
}
const vlen = (s) => stripAnsi(s).length
const padEndV = (s, w) => s + ' '.repeat(Math.max(0, w - vlen(s)))
const trunc = (s, w) => { s = String(s ?? ''); return s.length > w ? s.slice(0, Math.max(1, w - 1)) + '…' : s }
// Auto-detect a Google Maps link in a location string (or build a maps SEARCH
// url for a plain address), and render it as an OSC-8 terminal hyperlink so the
// location is clickable in the terminal — same idea as SmartLocation on the web.
const MAPS_RE = /maps\.google\.|google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i
function mapsUrl(text) {
  const t = String(text || '').trim()
  const m = t.match(/(https?:\/\/\S+)/i)
  if (m) return m[1].replace(/[),.;]+$/, '')
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(t)
}
const osc8 = (url, label) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`
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

// ── first-run welcome theatre: guaranteed even when npm hides the postinstall
// output. Plays once (marker in ~/.roster/.welcomed), only in a real terminal,
// and not for `auth`/`login` (those have their own animation). ──
const MARK = join(homedir(), '.roster', '.welcomed')
if (TTY && !existsSync(MARK)) {
  try { mkdirSync(join(homedir(), '.roster'), { recursive: true }); writeFileSync(MARK, new Date().toISOString()) } catch { /* */ }
  if (cmd !== 'auth' && cmd !== 'login') {
    try { const { playBoot } = await import('./lib/banner.mjs'); await playBoot() } catch { /* */ }
  }
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
if (cmd === 'changelog' || cmd === 'whatsnew') {
  console.log('\n' + c.bold('brello changelog') + c.dim('  ·  current  ') + c.cyan('v' + VERSION) + '\n')
  for (const r of CHANGELOG) {
    console.log(c.bold(c.cyan('v' + r.version)) + c.dim('  ·  ' + r.date + '  ·  ') + c.bold(r.title))
    for (const it of r.items) console.log(c.dim('   • ') + it)
    console.log('')
  }
  console.log(c.dim('  update:  ') + c.cyan('npm i -g brello') + '\n')
  process.exit(0)
}

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
  client:      { q: 'client', arg: '"<name>"' },
  due:         { q: 'due', arg: '[days]' },
  done:        { q: 'done', arg: '[days]' },
  blocked:     { q: 'blocked' },
  recent:      { q: 'recent', arg: '[n]' },
  now:         { q: 'now' },
  stages:      { q: 'stages' },
  cards:       { q: 'cards', arg: '["<stage>"] [flags]' },
  'stage-stats': { q: 'stage_stats' },
  departments: { q: 'departments' },
  shoots:      { q: 'shoots' },
  markup:      { q: 'markup', arg: '[filter]' },
  'ps-issues': { q: 'ps_issues', admin: true },
  audit:       { q: 'audit', admin: true },
}

// write commands — act on a single card. <card> is a card id OR an exact,
// unique card name. `q` is the server action; `arg` is the usage hint.
const WRITES = {
  comment:  { q: 'comment',      arg: '<card> <text…>' },
  move:     { q: 'move',         arg: '<card> <list…>' },
  due:      { q: 'set_due',      arg: '<card> <date|clear>' },
  done:     { q: 'mark_done',    arg: '<card> [--undo]' },
  priority: { q: 'set_priority', arg: '<card> <top|high|medium|low|none>' },
  assign:   { q: 'assign',       arg: '<card> <name…|none>' },
  rename:   { q: 'rename',       arg: '<card> <new name…>' },
  describe: { q: 'describe',     arg: '<card> <text…>' },
  archive:  { q: 'archive',      arg: '<card> [--restore]' },
}
const isNumericArg = (s) => /^\d+$/.test(String(s || '').trim())
// due / done are ALSO read commands. Route to the write path only when it clearly
// means "act on a card": a first argument that isn't a bare number of days.
function wantsWrite(name, args) {
  if (!WRITES[name]) return false
  if (!COMMANDS[name]) return true
  return args.length > 0 && !isNumericArg(args[0])
}
async function runWrite(name, args, flags) {
  const card = (args[0] || '').trim()
  if (!card) { console.error(`Add a card id or name, e.g.   brello ${name} 1c11685c …`); process.exit(1) }
  const tail = args.slice(1)
  const params = { card }
  if (name === 'comment') {
    params.body = tail.join(' ').trim()
    if (!params.body) { console.error('Add the comment text, e.g.   brello comment 1c11685c "final cut is up"'); process.exit(1) }
  } else if (name === 'move') {
    params.to = tail.join(' ').trim()
    if (!params.to) { console.error('Add the list to move it to, e.g.   brello move 1c11685c In Progress'); process.exit(1) }
  } else if (name === 'due') {
    const v = tail.join(' ').trim()
    params.due = (v === '' || /^(clear|none)$/i.test(v)) ? null : v
  } else if (name === 'done') {
    params.done = !flags.has('--undo')
  } else if (name === 'priority') {
    const v = (tail[0] || '').trim().toLowerCase()
    params.priority = /^(none|clear)$/.test(v) ? '' : v
  } else if (name === 'assign') {
    const v = tail.join(' ').trim()
    params.to = /^(none|unassign|unassigned)$/i.test(v) ? '' : v
  } else if (name === 'rename') {
    params.name = tail.join(' ').trim()
    if (!params.name) { console.error('Add the new name, e.g.   brello rename 1c11685c New title'); process.exit(1) }
  } else if (name === 'describe') {
    params.description = tail.join(' ').trim()
    if (!params.description) { console.error('Add the description text, e.g.   brello describe 1c11685c "the full brief"'); process.exit(1) }
  } else if (name === 'archive') {
    if (flags.has('--restore')) params.restore = true
  }
  try {
    const r = await withSpinner(`${name} · ${card}`, () => callRoster(WRITES[name].q, params))
    const detail = r.detail || (r.comment_id ? 'comment added' : 'done')
    console.log('  ' + c.green('✓') + ' ' + detail)
  } catch (e) {
    console.error('  ' + c.red('✗') + ' ' + (e.message || String(e)))
    process.exit(1)
  }
}

function table(rows, ctx) {
  if (!rows || !rows.length) { console.log(emptyLine(ctx)); return }
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
  // numeric values get a tiny sparkbar scaled to the largest number in this object.
  const nums = Object.values(o).map(Number).filter(n => Number.isFinite(n))
  const peak = nums.length ? Math.max(...nums, 1) : 0
  const BLK = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] // 0..8 eighths
  const sparkbar = (n) => {
    if (!peak || !Number.isFinite(n) || n <= 0) return ''
    const eighths = Math.max(1, Math.round((n / peak) * 64)) // up to 8 full blocks
    return '█'.repeat(Math.floor(eighths / 8)) + BLK[eighths % 8]
  }
  for (const [k, v] of Object.entries(o)) {
    const n = Number(v)
    const isNum = v !== '' && v != null && Number.isFinite(n)
    let val = v == null ? c.dim('—') : String(v)
    if (k === 'location' && v && TTY) val = osc8(mapsUrl(String(v)), c.cyan(String(v))) + c.dim(' ↗')
    const bar = isNum ? '  ' + c.cyan(sparkbar(n)) : ''
    console.log('  ' + c.dim('┃ ') + c.cyan((k.replace(/_/g, ' ')).padEnd(w)) + '  ' + val + bar)
  }
}

// ── per-command clarity: a focused detail panel ( brello help <command> ),
// a shared one-line column legend, and friendlier empty-state copy. One source
// of truth keyed by command NAME (aliases resolved below). ──
const DETAIL = {
  stats:       { sum: 'A live dashboard for your whole team in one glance.', extra: 'No argument. Shows team size, open / done / overdue counts, what is due this week, cards with no due date, and how many people are tracking time right now.' },
  team:        { sum: 'Your team members — names, departments and roles.', extra: 'No argument. A ● now marker means that person has a live Hubstaff timer.' },
  overdue:     { sum: 'Cards that are past their due date and not yet done.', extra: 'No argument. Sorted oldest-first; the LATE column shows how many days each one has slipped.' },
  workload:    { sum: 'How loaded each person is — open, overdue and done counts.', extra: 'No argument. Sorted by who has the most open cards; NEXT DUE is their soonest upcoming deadline.' },
  active:      { sum: 'Who is tracking time right this second (live Hubstaff timers).', extra: 'No argument. FOR is how long the timer has been running; SINCE is when it started.' },
  leaves:      { sum: 'Upcoming approved time off for your team (Vacation Tracker).', extra: 'No argument. Sorted soonest-first; IN DAYS counts down to each day off.' },
  comments:    { sum: 'The latest comments left on your team’s cards.', extra: 'No argument. Newest first. Mentions of hidden people are redacted to [hidden].' },
  reactions:   { sum: 'Recent emoji reactions on your team’s cards.', extra: 'No argument. Newest first; only reactions left by your own team are shown.' },
  activity:    { sum: 'A feed of everything that happened on your team’s cards.', extra: 'No argument. Moves between stages, comments, reassignments, splits and edits — newest first.' },
  search:      { sum: 'Find cards by title or client name.', extra: 'Argument: the text to look for (quote it if it has spaces).  e.g.  brello search "reel"' },
  user:        { sum: 'A full dossier for one person — every card they own.', extra: 'Argument: a name (full or partial).  Shows live AND archived cards, their totals, and what they are tracking now.  e.g.  brello user Samer' },
  card:        { sum: 'Everything about a single card.', extra: 'Argument: a card id (the first 8 characters are enough).  Shows stage, description, subtasks, split, collaborators and linked cards.  e.g.  brello card 1c11685c' },
  stages:      { sum: 'The board’s workflow stages and how full each one is.', extra: 'No argument. CARDS = your team’s open cards in that stage; OVERDUE = how many of those are late.' },
  departments: { sum: 'The roster’s departments and their headcount.', extra: 'No argument. ACTIVE NOW = how many people in each department are tracking time.' },
  shoots:      { sum: 'The shoot schedule — recent and upcoming (company-wide).', extra: 'No argument. Not department-scoped: anyone can see when a shoot is and who is on the crew.' },
  markup:      { sum: 'The Markup.io review feed — what is out for review.', extra: 'Optional argument: filter by item name.  OPEN THREADS = unresolved comment threads.  e.g.  brello markup reel' },
  client:      { sum: 'All of your team’s cards for one client.', extra: 'Argument: a client name (full or partial).  e.g.  brello client Foodhall' },
  due:         { sum: 'Cards coming due soon — or set one card’s due date.', extra: 'With a number (or nothing): your team’s cards due in the next N days (default 7).  With a card id/name + a date: sets that card’s due date; pass "clear" to remove it.  e.g.  brello due 3   ·   brello due 1c11685c 2026-07-20' },
  done:        { sum: 'Cards your team finished recently — or mark one done.', extra: 'With a number (or nothing): cards completed in the last N days (default 7).  With a card id/name: marks that card done; add --undo to reopen it.  e.g.  brello done 14   ·   brello done 1c11685c' },
  comment:     { sum: 'Add a comment to a card.', extra: 'Arguments: a card (id or exact name) then the comment text.  e.g.  brello comment 1c11685c "final cut is up"' },
  move:        { sum: 'Move a card to another list.', extra: 'Arguments: a card (id or exact name) then the list name.  e.g.  brello move 1c11685c In Progress' },
  priority:    { sum: 'Set or clear a card’s priority.', extra: 'Arguments: a card (id or exact name) then top / high / medium / low — or "none" to clear it.  e.g.  brello priority 1c11685c high' },
  assign:      { sum: 'Assign a card to someone — or unassign it.', extra: 'Arguments: a card (id or exact name) then a name (or Uxxxx slack id) — or "none" to unassign.  e.g.  brello assign 1c11685c Samer' },
  rename:      { sum: 'Rename a card.', extra: 'Arguments: a card (id or exact name) then the new title.  e.g.  brello rename 1c11685c New title' },
  describe:    { sum: 'Set a card’s description.', extra: 'Arguments: a card (id or exact name) then the description text.  e.g.  brello describe 1c11685c "the full brief"' },
  archive:     { sum: 'Archive a card — or restore it.', extra: 'Argument: a card (id or exact name).  Add --restore to bring it back.  e.g.  brello archive 1c11685c' },
  blocked:     { sum: 'Cards that are stuck waiting on something else.', extra: 'No argument. Shows what each card is blocked by.' },
  recent:      { sum: 'The newest cards and changes across your team.', extra: 'No argument. A quick "what’s new" since you last looked.' },
  now:         { sum: 'A live snapshot of who is working on what right now.', extra: 'No argument. Like active, focused on the current moment.' },
  'ps-issues': { sum: 'Open Product Support issues (admin only).', extra: 'No argument. Requires an admin-scope token.' },
  audit:       { sum: 'The access log — who queried what, and when (admin only).', extra: 'No argument. Requires an admin-scope token.' },
}
// One-line legend of the columns each command returns (shown under wide tables
// and inside  brello help <command>  ). Keep these short.
const LEGENDS = {
  overdue:     'LATE = days past due',
  workload:    'OPEN = not done · OVERDUE = late · NEXT DUE = soonest deadline · TRACKING = live timer',
  active:      'FOR = timer running time · SINCE = when it started',
  leaves:      'IN DAYS = days until the day off · HALF = half-day portion',
  comments:    'BY = author · AT = when it was posted',
  reactions:   'BY = who reacted · AT = when',
  activity:    'DID = what happened · WHO = who did it · WHEN = timestamp',
  search:      'STAGE = board list · DUE = due date · DONE = ✓ complete',
  user:        'STATUS = live / done / archived · STARTED→ENDED→DONE = work timeline',
  stages:      'CARDS = open cards here · OVERDUE = how many are late',
  departments: 'PEOPLE = headcount · ACTIVE NOW = tracking time',
  shoots:      'TIME = start time · CREW = who’s on it (first few)',
  markup:      'OPEN THREADS = unresolved comments · LINK = open in Markup.io',
  client:      'STAGE = board list · ASSIGNEE = owner · DUE = due date',
  due:         'DUE = due date · IN = days until due',
  done:        'DONE = when it was completed',
  blocked:     'BLOCKED BY = what it’s waiting on',
  recent:      'WHEN = when it changed · WHAT = the change',
  'ps-issues': 'STATUS = support stage · TYPE = report type · REPORTED = when',
  audit:       'WHO = token label · SCOPE = departments · WHEN = timestamp',
}
// Context-aware empty-state lines (the generic fallback is kept for anything not listed).
const EMPTY_HINTS = {
  overdue:  'no overdue cards — your team is all caught up',
  leaves:   'no upcoming time off on the calendar',
  active:   'no one is tracking time right now',
  now:      'no one is tracking time right now',
  comments: 'no comments yet on your team’s cards',
  reactions:'no reactions yet',
  activity: 'no recent activity',
  blocked:  'nothing is blocked right now',
  due:      'nothing due in that window',
  done:     'nothing completed in that window',
  search:   'nothing matched — try a shorter or different word',
  client:   'no cards for that client in your scope',
  markup:   'nothing in the review feed',
  shoots:   'no shoots scheduled in that range',
}
const aliasName = (name) => name === 'ps_issues' ? 'ps-issues' : name
function emptyLine(ctx) {
  const hint = ctx && EMPTY_HINTS[aliasName(ctx)]
  return c.dim('  · ' + (hint || 'nothing here right now'))
}
function legendFor(ctx) { return ctx ? LEGENDS[aliasName(ctx)] : null }
// Focused panel for a single command — what it does, its argument, the columns.
function helpFor(name) {
  const key = aliasName(name)
  const def = COMMANDS[key] || COMMANDS[name] || WRITES[key]
  const d = DETAIL[key]
  if (!def && !d) { console.error(`I don't have a help page for "${name}".`); help(); return }
  const usage = 'brello ' + key + (def?.arg ? ' ' + def.arg : '')
  console.log(`\n${c.cyan('❯')} ${c.bold(usage)}${def?.admin ? '  ' + c.amber('· admin only') : ''}`)
  if (d?.sum) console.log('  ' + d.sum)
  if (d?.extra) console.log('\n  ' + c.dim(d.extra))
  const leg = LEGENDS[key]
  if (leg) console.log('\n  ' + c.dim('columns:  ') + c.dim(leg))
  console.log(c.dim(`\n  ↳ brello help  ·  to see every command\n`))
}


function help() {
  const tty = process.stdout.isTTY
  const B = tty ? '\x1b[1m' : '', D = tty ? '\x1b[2m' : '', C = tty ? '\x1b[36m' : '', R = tty ? '\x1b[0m' : ''
  const SECTIONS = [
    { title: 'Get started', rows: [
      ['auth', '', 'Sign in — paste the token your admin gave you'],
      ['whoami', '', 'Check whether a token is set'],
      ['logout', '', 'Remove your saved token'],
      ['changelog', '', "What's new — every release"],
    ] },
    { title: 'Your team',        cmds: ['stats', 'team', 'now', 'workload', 'overdue', 'active', 'leaves', 'departments'] },
    { title: 'Cards & people',   cmds: ['search', 'user', 'client', 'card', 'due', 'done', 'blocked', 'recent', 'activity', 'comments', 'reactions'] },
    { title: 'Board & production', cmds: ['stages', 'cards', 'stage-stats', 'shoots', 'markup'] },
    { title: 'Act on cards', rows: [
      ['comment', '<card> <text>', 'Add a comment to a card'],
      ['move', '<card> <list>', 'Move a card to another list'],
      ['due', '<card> <date>', 'Set or clear a card’s due date'],
      ['done', '<card>', 'Mark a card done (--undo reopens)'],
      ['priority', '<card> <level>', 'Set or clear a card’s priority'],
      ['assign', '<card> <who>', 'Assign a card (none unassigns)'],
      ['rename', '<card> <name>', 'Rename a card'],
      ['describe', '<card> <text>', 'Set a card’s description'],
      ['archive', '<card>', 'Archive a card (--restore brings it back)'],
    ] },
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

if (!cmd || cmd === '--help' || cmd === '-h' || (cmd === 'help' && !rest.length)) { help(); process.exit(0) }
if (cmd === 'help') { helpFor((rest[0] || '').trim()); process.exit(0) }
// also support  brello <command> --help / -h  → the focused panel for that command
if (rest.includes('--help') || rest.includes('-h')) { helpFor(cmd); process.exit(0) }

// global flags: --board widens card queries to the whole board; --unassigned filters
// to no-assignee; --undo / --restore feed the write commands.
const flags = new Set(rest.filter(a => a.startsWith('--')))
const args = rest.filter(a => !a.startsWith('--'))

// write commands act on one card (comment/move/due/done/priority/assign/rename/
// describe/archive). due & done double as read commands: a non-numeric first arg
// ("brello due 1c11685c 2026-07-20") acts on that card; a number or nothing reads.
if (wantsWrite(cmd, args)) { await runWrite(cmd, args, flags); process.exit(0) }

const def = COMMANDS[cmd]
if (!def) { console.error(`I don't know "${cmd}".`); help(); process.exit(1) }

const params = {}
if (flags.has('--board')) params.scope = 'board'
if (def.q === 'cards') {
  if (args.length) params.stage = args.join(' ').trim()
  if (flags.has('--unassigned')) params.assignee = 'none'
}
if (def.q === 'search') {
  params.q = args.join(' ').trim()
  if (!params.q) { console.error('Add what to search for, e.g.   brello search "reel"'); process.exit(1) }
}
if (def.q === 'card') {
  params.id = (args[0] || '').trim()
  if (!params.id) { console.error('Add a card id (first 8 chars are fine), e.g.   brello card 1c11685c'); process.exit(1) }
}
if (def.q === 'user') {
  params.who = args.join(' ').trim()
  if (!params.who) { console.error('Add a name, e.g.   brello user Samer'); process.exit(1) }
}
if (def.q === 'markup') {
  const f = rest.join(' ').trim()
  if (f) params.q = f   // optional name filter, e.g.  brello markup reel
}
if (def.q === 'client') {
  params.client = args.join(' ').trim()
  if (!params.client) { console.error('Add a client name, e.g.   brello client "Foodhall"'); process.exit(1) }
}
if (def.q === 'due')    { const n = parseInt(args[0], 10); if (Number.isFinite(n)) params.days = n; }
if (def.q === 'done')   { const n = parseInt(args[0], 10); if (Number.isFinite(n)) params.days = n; }
if (def.q === 'recent') { const n = parseInt(args[0], 10); if (Number.isFinite(n)) params.n = n; }

try {
  const r = await withSpinner(`querying · ${cmd}`, () => callRoster(def.q, params))
  if (r.person) {
    const p = r.person, t = r.totals || {}
    const sub = [p.role ? p.role.replace(/_/g, ' ') : '', p.department].filter(Boolean).join(' · ')
    console.log(`\n${c.cyan('❯')} ${c.bold(p.name)}${sub ? '  ' + c.dim(sub) : ''}`)
    console.log(`  ${c.green((t.live ?? 0) + ' live')}${c.dim(' · ')}${c.cyan((t.done ?? 0) + ' done')}${c.dim(' · ')}${c.grey((t.archived ?? 0) + ' archived')}${c.dim('   (' + (t.cards ?? r.count) + ' total)')}`)
    if (r.active_on) console.log(`  ${c.amber('● tracking now')}${c.dim(' → ')}${r.active_on}`)
    console.log('  ' + c.dim('─'.repeat(Math.max(12, vlen(`❯ ${p.name}`) + 6))))
    console.log('')
  } else if (r.client) {
    const t = r.totals || {}
    console.log(`\n${c.cyan('❯')} ${c.bold(r.client)}${c.dim('  client')}`)
    console.log(`  ${c.green((t.open ?? 0) + ' open')}${c.dim(' · ')}${c.cyan((t.done ?? 0) + ' done')}${c.dim(' · ')}${(t.overdue ?? 0) > 0 ? c.amber((t.overdue ?? 0) + ' overdue') : c.grey('0 overdue')}${c.dim('   (' + (t.cards ?? r.count) + ' total)')}`)
    if (r.people && r.people !== '—') console.log(`  ${c.dim('on it → ')}${r.people}`)
    console.log('')
  } else {
    const head = `❯ ${cmd} · ${r.count} result${r.count === 1 ? '' : 's'}`
    console.log(`\n${c.cyan('❯')} ${c.bold(cmd)}${c.dim(` · ${r.count} result${r.count === 1 ? '' : 's'}`)}`)
    console.log('  ' + c.dim('─'.repeat(vlen(head))) + '\n')
  }
  if (Array.isArray(r.data)) {
    table(r.data, cmd)
    const leg = legendFor(cmd)
    if (leg && r.data.length && typeof r.data[0] === 'object' && Object.keys(r.data[0]).length >= 4) {
      console.log('  ' + c.dim('legend:  ') + c.dim(leg))
    }
  } else printObject(r.data)
  if (r.note) console.log('\n  ' + c.dim('▸ ') + c.amber(r.note))
  console.log(c.dim(`\n  ↳ brello help  ·  for everything you can ask\n`))
} catch (e) {
  const m = e.message || String(e)
  if (/NO_TOKEN/.test(m)) console.error('✖ No token yet. Get one from your admin, then run:  brello auth')
  else if (/invalid or expired/.test(m)) console.error('✖ Your token is invalid or has expired — ask your admin for a fresh one.')
  else if (/no scope|token has no scope/.test(m)) console.error('✖ Your token has no department scope — ask your admin to mint a fresh one.')
  else if (/admin-scope only|admin only/.test(m)) console.error('✖ That one is admin-only — your token does not have access.')
  else if (/rate limit/i.test(m)) console.error('✖ Easy there — too many requests in a minute. Wait a moment and try again.')
  else if (/Network error|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(m)) console.error('✖ Could not reach the roster — check your internet and try again.')
  else if (/not configured/i.test(m)) console.error('✖ That feature is not set up yet on the server — ask your admin.')
  else console.error('✖ Something went wrong: ' + m + '\n  ' + (process.stdout.isTTY ? '\x1b[2m' : '') + '↳ if this keeps happening, run  brello whoami  and share it with your admin.' + (process.stdout.isTTY ? '\x1b[0m' : ''))
  process.exit(1)
}
