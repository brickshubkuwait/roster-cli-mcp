#!/usr/bin/env node
// Brello CLI — query your team's work.
//   brello auth   (one time, or  pbpaste | brello login)   then:
//   brello stats | team | overdue | workload | active
//   brello comments | reactions | search "<text>" | card <id> | shoots | meetings | readiness | help
//   Add --json to any command for machine output (raw JSON, no banner, no colour).
import { callRoster, QUERIES, clearToken, getToken, ensureRosterDir, describeError, isLegacyKey, CONNECT_URL } from './lib/client.mjs'
import { printNotice, printLegacyHint } from './lib/auth.mjs'
import { CHANGELOG, VERSION } from './lib/changelog.mjs'
import { DOCS_URL, KEYS_URL, KEY_GUIDE } from './lib/docs.mjs'
import { parseScopeArgs, deliverableRows, extraRows, entryHeading } from './lib/scope.mjs'
import { homedir } from 'node:os'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// --json anywhere on the line: machine output. The raw JSON response goes to
// stdout, with no banner, spinner, colour or notice line (the notice stays in
// the JSON). Errors print as {"ok":false,"error":...} with exit code 1.
const ARGV = process.argv.slice(2)
const JSON_OUT = ARGV.includes('--json')
const [cmd, ...rest] = ARGV.filter(a => a !== '--json')
// Pipes are async in Node, and the many process.exit() calls below would cut
// piped output at 64 KB (brello clients --json | jq). Blocking writes flush first.
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true)
const emit = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n')
function emitError(e, extra = {}) {
  emit({ ok: false, error: describeError(e, extra), code: e?.code || null, status: e?.status || null })
  process.exit(1)
}

// ── terminal style kit: ANSI palette + box-drawing (no-ops when piped) ──
const TTY = process.stdout.isTTY && !JSON_OUT
const wrap = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : String(s)
const c = {
  bold: wrap(1), dim: wrap(2), cyan: wrap(36), green: wrap(32),
  amber: wrap(33), red: wrap(31), magenta: wrap(35), grey: wrap(90),
}
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '')

// ── braille fetch shimmer: spins on stderr while we wait on the gateway, so
// piped/redirected stdout stays clean. No-op unless stderr is a real TTY. ──
const SPIN = process.stderr.isTTY && !JSON_OUT
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
  if (col === 'missing') return s === 'ready' ? c.green('✓ ready') : c.amber(s)
  return s
}

// ── first-run welcome theatre: guaranteed even when npm hides the postinstall
// output. Plays once (marker in ~/.roster/.welcomed), only in a real terminal,
// and not for `auth`/`login` (those have their own animation). ──
const MARK = join(homedir(), '.roster', '.welcomed')
if (TTY && !existsSync(MARK)) {
  try { ensureRosterDir(); writeFileSync(MARK, new Date().toISOString()) } catch { /* */ }
  if (cmd !== 'auth' && cmd !== 'login') {
    try { const { playBoot } = await import('./lib/banner.mjs'); await playBoot() } catch { /* */ }
  }
}

// ── new-version notice: real terminal only (TTY is already false under --json),
// at most one registry check a day, done by a detached child so no command ever
// waits on it or fails because of it. The MCP server never loads this. ──
if (TTY && !process.env.BRELLO_NO_UPDATE_CHECK) {
  try {
    const { versionNotice, refreshInBackground } = await import('./lib/update-check.mjs')
    const { line, stale } = versionNotice({ current: VERSION })
    if (line) process.stderr.write(c.dim('  ' + line) + '\n')
    if (stale) refreshInBackground()
  } catch { /* silent */ }
}

// ── auth: interactive, prompts for the token + a little terminal theatre ──
if (cmd === 'docs') {
  if (JSON_OUT) { emit({ ok: true, docs: DOCS_URL, keys: KEYS_URL, key_help: KEY_GUIDE }); process.exit(0) }
  console.log(`Developer hub: ${DOCS_URL}\nMy keys: ${KEYS_URL}\nKey help: brello help keys`)
  process.exit(0)
}
if (cmd === 'auth') { const { runAuth } = await import('./lib/auth.mjs'); await runAuth(); process.exit(0) }

if (cmd === 'logout') { clearToken(); JSON_OUT ? emit({ ok: true, key_removed: true }) : console.log(c.green('✓') + ' key removed'); process.exit(0) }
if (cmd === 'whoami') {
  const t = getToken()
  if (JSON_OUT) { emit({ ok: true, key_set: !!t, legacy_key: !!t && isLegacyKey(t) }); process.exit(0) }
  console.log(t ? c.green('✓') + ' a key is set' : c.red('✗') + ' no key  ' + c.dim('· run:  ') + c.cyan('brello auth'))
  if (t) printLegacyHint(t)
  process.exit(0)
}
if (cmd === 'changelog' || cmd === 'whatsnew') {
  if (JSON_OUT) { emit({ ok: true, installed: VERSION, releases: CHANGELOG }); process.exit(0) }
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
  comments:    { q: 'comments' },
  reactions:   { q: 'reactions' },
  activity:    { q: 'activity' },
  search:      { q: 'search', arg: '"<text>"' },
  user:        { q: 'user', arg: '<name>' },
  card:        { q: 'card', arg: '<id>' },
  client:      { q: 'client', arg: '"<name>"' },
  scope:       { q: 'scope', arg: '"<client>" --month YYYY-MM [--json]' },
  due:         { q: 'due', arg: '[days]' },
  done:        { q: 'done', arg: '[days]' },
  blocked:     { q: 'blocked' },
  recent:      { q: 'recent', arg: '[n]' },
  now:         { q: 'now' },
  stages:      { q: 'stages' },
  cards:       { q: 'cards', arg: '["<stage>"] [flags]' },
  'stage-stats': { q: 'stage_stats', arg: '[--department "<name>"] [--client "<name>"]' },
  departments: { q: 'departments' },
  shoots:      { q: 'shoots', arg: '[--from YYYY-MM-DD --to YYYY-MM-DD] [flags]' },
  meetings:    { q: 'meetings', arg: '[--from YYYY-MM-DD --to YYYY-MM-DD] [flags]' },
  clients:     { q: 'clients', arg: '["<name>"] [--all]' },
  readiness:   { q: 'readiness', arg: '[--days 7] [--json]' },
  studio:      { q: 'studio', arg: '[filter]' },
  'ps-issues': { q: 'ps_issues', admin: true },
  audit:       { q: 'audit', admin: true },
}

// write commands — act on a single card. <card> is a card id OR an exact,
// unique card name. `q` is the server action; `arg` is the usage hint.
const WRITES = {
  comment:  { q: 'comment',      arg: '<card> <text…>' },
  move:     { q: 'move',         arg: '<card> <list…> [--reason "<why>"]' },
  due:      { q: 'set_due',      arg: '<card> <date|clear> [--reason "<why>"]' },
  done:     { q: 'mark_done',    arg: '<card> [--undo]' },
  priority: { q: 'set_priority', arg: '<card> <top|high|medium|low|none>' },
  assign:   { q: 'assign',       arg: '<card> <name…|none> [--reason "<why>"]' },
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
const REASON_WRITES = new Set(['move', 'due', 'assign'])
const CLI_HINTS = {
  DUE_REQUIRED: 'Set one first with  brello due <card> YYYY-MM-DD, then move it again',
  REASON_REQUIRED: 'Run it again with  --reason "<why>"',
}
async function runWrite(name, args, flags, reason = null) {
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
  if (reason !== null) {
    if (!REASON_WRITES.has(name)) { console.error('--reason works with move, due and assign.'); process.exit(1) }
    if (!reason.trim()) { console.error('Add the reason text, e.g.   brello due 1c11685c 2026-10-20 --reason "client moved the shoot"'); process.exit(1) }
    params.reason = reason.trim()
  }
  try {
    const r = await withSpinner(`${name} · ${card}`, () => callRoster(WRITES[name].q, params))
    if (JSON_OUT) { emit(r); return }
    const detail = r.detail || (r.comment_id ? 'comment added' : 'done')
    console.log('  ' + c.green('✓') + ' ' + detail)
    printNotice()
  } catch (e) {
    if (JSON_OUT) emitError(e, { hints: CLI_HINTS })
    console.error('  ' + c.red('✗') + ' ' + describeError(e, { hints: CLI_HINTS }))
    process.exit(1)
  }
}

// create — mint a NEW card. The title is everything not behind a flag; the rest
// come as value flags:  brello create "Spirit Felice Bahrain artwork"
//   --assignee Abrar --due 2026-07-22 --client "Spirit Felice" --dept Design
//   --priority high --list "Ready for Sprint" --desc "the brief"
async function runCreate(rest) {
  const opts = {}
  const words = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = rest[i + 1]
      opts[key] = (next && !next.startsWith('--')) ? rest[++i] : ''
    } else words.push(a)
  }
  const name = (opts.name || words.join(' ')).trim()
  if (!name) { console.error('Add a card title, e.g.   brello create "Spirit Felice Bahrain artwork" --assignee Abrar --due 2026-07-22'); process.exit(1) }
  const params = { name }
  const list = opts.list || opts.stage
  const who = opts.assignee || opts.assign || opts.to
  const dept = opts.dept || opts.department
  const desc = opts.desc || opts.description
  if (list) params.list = list
  if (who) params.assignee = who
  if (opts.due) params.due = opts.due
  if (opts.client) params.client = opts.client
  if (dept) params.department = dept
  if (opts.priority) params.priority = opts.priority
  if (desc) params.description = desc
  try {
    const r = await withSpinner(`create · ${name}`, () => callRoster('create', params))
    if (JSON_OUT) { emit(r); return }
    const bits = [
      r.list && `in ${r.list}`, r.assignee && `→ ${r.assignee}`,
      r.due && `due ${r.due}`, r.priority && `${r.priority} priority`,
    ].filter(Boolean).join(c.dim(' · '))
    console.log('  ' + c.green('✓') + ' created ' + c.bold(r.card) + (bits ? '  ' + c.dim(bits) : '') + (r.id ? c.dim('  ·  ' + String(r.id).slice(0, 8)) : ''))
    printNotice()
  } catch (e) {
    if (JSON_OUT) emitError(e)
    console.error('  ' + c.red('✗') + ' ' + describeError(e))
    process.exit(1)
  }
}

// scope: contracted vs shot vs delivered for one client and month. --json
// prints the gateway response untouched; otherwise one table per contract.
async function runScope(rest) {
  const a = parseScopeArgs(rest)
  if (a.error) { console.error(a.error); process.exit(1) }
  const params = { client: a.client, ...(a.month ? { month: a.month } : {}) }
  let r
  try {
    r = await withSpinner(`scope · ${a.client}`, () => callRoster('scope', params))
  } catch (e) {
    if (JSON_OUT) emitError(e)
    console.error('✖ ' + describeError(e))
    process.exit(1)
  }
  // The global --json is taken off argv before commands see it, so honour JSON_OUT too.
  if (a.json || JSON_OUT) { emit(r); printNotice(); return }
  if (!r.client) {
    console.log('\n' + c.dim('  · ') + c.amber(r.note || 'no client matching that name in your scope') + '\n')
    printNotice()
    return
  }
  console.log(`\n${c.cyan('❯')} ${c.bold(r.client)}${c.dim('  scope · ' + r.month)}`)
  if (!r.data?.length) console.log(c.dim('  · no contract is live in that month'))
  for (const entry of r.data || []) {
    const h = entryHeading(entry)
    console.log(`\n  ${c.bold(h.title)}${h.sub ? c.dim('  ' + h.sub) : ''}`)
    table(deliverableRows(entry), 'scope')
    const extras = extraRows(entry.extras)
    if (extras.length) { console.log(c.dim('  extras')); table(extras, 'scope') }
    for (const n of entry.notes || []) console.log('  ' + c.dim('▸ ') + c.amber(n))
  }
  const loose = extraRows(r.extras_unlinked)
  if (loose.length) { console.log('\n' + c.dim('  extras with no matching contract')); table(loose, 'scope') }
  for (const n of r.notes || []) console.log('  ' + c.dim('▸ ' + n))
  console.log('  ' + c.dim('legend:  ' + LEGENDS.scope))
  console.log(c.dim(`\n  ↳ brello help scope  ·  what each column means\n`))
  printNotice('\n\n')
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

// Some reads return nested detail that does not fit a terminal table. Keep
// the table to the columns people scan; --json still has everything.
function displayRows(q, rows) {
  if (!Array.isArray(rows)) return rows
  if (q === 'shoots') return rows.map(({ checklist, ...row }) => row)
  if (q === 'readiness') {
    return rows.map(r => ({
      date: r.date,
      in: r.in_days === 0 ? 'today' : r.in_days === 1 ? '1 day' : `${r.in_days} days`,
      time: r.time || '',
      client: r.client || '',
      account: r.account || '',
      missing: r.ready ? 'ready' : r.missing,
    }))
  }
  return rows
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
    let val = v == null ? c.dim('—') : (typeof v === 'object' ? JSON.stringify(v) : String(v))
    if (k === 'location' && v && TTY) val = osc8(mapsUrl(String(v)), c.cyan(String(v))) + c.dim(' ↗')
    const bar = isNum ? '  ' + c.cyan(sparkbar(n)) : ''
    console.log('  ' + c.dim('┃ ') + c.cyan((k.replace(/_/g, ' ')).padEnd(w)) + '  ' + val + bar)
  }
}

// ── per-command clarity: a focused detail panel ( brello help <command> ),
// a shared one-line column legend, and friendlier empty-state copy. One source
// of truth keyed by command NAME (aliases resolved below). ──
const DETAIL = {
  docs: { sum: 'Developer hub, setup guides, commands and troubleshooting.', extra: DOCS_URL },
  keys: { sum: 'Request, use and renew your Brello key.', extra: KEY_GUIDE.join('\n\n') + '\n\nMy keys: ' + KEYS_URL },
  auth:        { sum: 'Sign in. Paste your key at a masked prompt; it is checked, then saved to ~/.roster.', extra: `Keys come from ${CONNECT_URL} (by invitation). Run this again any time you get a new key.` },
  login:       { sum: 'Sign in from a pipe, with no prompt.', extra: 'Reads the key from stdin, checks it like brello auth, then saves it.  e.g.  pbpaste | brello login   Passing the key as an argument is not supported, so it never lands in your shell history.' },
  stats:       { sum: 'A live dashboard for your whole team in one glance.', extra: 'No argument. Shows team size, open / done / overdue counts, what is due this week, cards with no due date, and how many people are tracking time right now.' },
  team:        { sum: 'Your team members — names, departments and roles.', extra: 'No argument. A ● now marker means that person has a live Hubstaff timer.' },
  overdue:     { sum: 'Cards that are past their due date and not yet done.', extra: 'No argument. Sorted oldest-first; the LATE column shows how many days each one has slipped.' },
  workload:    { sum: 'How loaded each person is — open, overdue and done counts.', extra: 'No argument. Sorted by who has the most open cards; NEXT DUE is their soonest upcoming deadline.' },
  active:      { sum: 'Who is tracking time right this second (live Hubstaff timers).', extra: 'No argument. FOR is how long the timer has been running; SINCE is when it started.' },
  comments:    { sum: 'The latest comments left on your team’s cards.', extra: 'No argument. Newest first. Mentions of hidden people are redacted to [hidden].' },
  reactions:   { sum: 'Recent emoji reactions on your team’s cards.', extra: 'No argument. Newest first; only reactions left by your own team are shown.' },
  activity:    { sum: 'A feed of everything that happened on your team’s cards.', extra: 'No argument. Moves between stages, comments, reassignments, splits and edits — newest first.' },
  search:      { sum: 'Find cards by title or client name.', extra: 'Argument: the text to look for (quote it if it has spaces).  e.g.  brello search "reel"' },
  user:        { sum: 'A full dossier for one person — every card they own.', extra: 'Argument: a name (full or partial).  Shows live AND archived cards, their totals, and what they are tracking now.  e.g.  brello user Samer' },
  card:        { sum: 'Everything about a single card.', extra: 'Argument: a card id (the first 8 characters are enough). Shows workflow, tracked effort, Studio submissions, review context, Slack thread, deliverable sizes and approved EN/AR copy. Self-service keys omit share/open URLs, invoices and delivery recipients. e.g. brello card 1c11685c' },
  stages:      { sum: 'The board’s workflow stages and how full each one is.', extra: 'No argument. CARDS = your team’s open cards in that stage; OVERDUE = how many of those are late.' },
  departments: { sum: 'The roster’s departments and their headcount.', extra: 'No argument. ACTIVE NOW = how many people in each department are tracking time.' },
  shoots:      { sum: 'The shoot schedule, recent and upcoming (company-wide).', extra: 'With no flags: the last 7 days onward. --from YYYY-MM-DD --to YYYY-MM-DD (both together) sets a range. Filters: --client "<name>" (partial), --type "<shoot type>", --status <Confirmed|Pending|Canceled...>. --include-removed adds removed shoots with when and why. --json returns every field: id, code, client_id, account, contract_month, extended, session (2 of 4), scope, outputs (what the session is for, with quantities), models and models_arranged, prep (props, casting, wardrobe, setup, permit), drone_pilot, production_assistant, end_time, reel times, completed, feedback_session, jida_project_id, created_at, updated_at, removed_at, removed_reason. Money and HR fields are never returned. Each shoot also carries a readiness line (what is still missing).  e.g.  brello shoots --from 2026-10-01 --to 2026-10-31 --client Foodhall' },
  meetings:    { sum: 'Meetings with owner, attendees and minutes status.', extra: 'With no flags: 7 days back to 60 days ahead. --from YYYY-MM-DD --to YYYY-MM-DD, --client "<name>", --owner "<name>". Shows meetings your team organises or attends; --board shows the whole board. MINUTES is none, draft or submitted. The notes link opens the calendar event, where Gemini notes attach; the Roster does not store Gemini notes.  e.g.  brello meetings --from 2026-10-01 --to 2026-10-31 --owner Melani' },
  clients:     { sum: 'The client directory: logo, Instagram handle and open cards.', extra: 'Optional argument: part of a client name. Active clients only unless you add --all. OPEN CARDS counts cards in your team (--board for the whole board). --json adds the logo URL, industry, account people and ids.  e.g.  brello clients food --json' },
  cards:       { sum: 'Every card in a stage, or matching your filters.', extra: 'Optional argument: a stage name. --board for the whole board, --unassigned for cards with no assignee, --client "<name>" to narrow by client, --history to add each card’s stage history (stage, entered and exited), --created-after / --created-before YYYY-MM-DD for cards made in a date range (Kuwait days). Returns 200 cards a page by default: --limit up to 1000, and --offset N for the next page (the response says which offset is next).  e.g.  brello cards "Ready for Sprint" --board --history   ·   brello cards --board --created-after 2026-10-01 --limit 1000' },
  'stage-stats': { sum: 'How each stage is used over the board’s history.', extra: 'No argument needed. --department "<name>" and --client "<name>" narrow it to matching cards; a family such as Design covers its departments.  e.g.  brello stage-stats --department "Video Edit"' },
  readiness:   { sum: 'Upcoming shoots and what is still missing before the day.', extra: 'Optional: --days N (default 7, up to 31). Lists every shoot in the next N days with what is not settled yet: plan, budget, models, props and call time. A 9:00 AM start counts as missing until someone confirms it. Add --json for the full detail, including each item\'s status and the plan and approval links.  e.g.  brello readiness --days 5' },
  studio:      { sum: 'The Bricks Studio review feed — what is out for review.', extra: 'Optional argument: filter by submission, card or client name. Shows status, version, comments and client-view receipt. Self-service keys stay with your team and omit share/open URLs, even with --board. e.g. brello studio reel' },
  scope:       { sum: 'One client in one month: what the contract sold vs what was shot, delivered and approved.', extra: 'Argument: a client name (full or partial), then --month YYYY-MM (default: this month). One block per contract live in that month. CONTRACTED comes from the Salesforce quote, SHOT from completed shoot days, DELIVERED from cards sent to the client or completed, APPROVED from client approvals in Bricks Studio. ? means the number is unknown, and the notes under the table say why. Add --json for the raw response.  e.g.  brello scope "Sedra" --month 2026-10' },
  client:      { sum: 'All of your team’s cards for one client.', extra: 'Argument: a client name (full or partial).  e.g.  brello client Foodhall' },
  due:         { sum: 'Cards coming due soon — or set one card’s due date.', extra: 'With a number (or nothing): your team’s cards due in the next N days (default 7).  With a card id/name + a date: sets that card’s due date; pass "clear" to remove it. Moving a missed due date later needs  --reason "<why>"  (REASON_REQUIRED).  e.g.  brello due 3   ·   brello due 1c11685c 2026-07-20 --reason "client moved the shoot"' },
  done:        { sum: 'Cards your team finished recently — or mark one done.', extra: 'With a number (or nothing): cards completed in the last N days (default 14).  With a card id/name: marks that card done; add --undo to reopen it.  e.g.  brello done 14   ·   brello done 1c11685c' },
  create:      { sum: 'Create a new card on the board.', extra: 'Argument: the card title in quotes. Everything else is an optional value flag: --list "<stage>" (default: the board’s first list), --assignee <name|id>, --due YYYY-MM-DD, --client "<tag>", --dept <department>, --priority <top|high|medium|low>, --desc "<brief>".  e.g.  brello create "Spirit Felice Bahrain artwork" --assignee Abrar --due 2026-07-22 --dept Design' },
  comment:     { sum: 'Add a comment to a card.', extra: 'Arguments: a card (id or exact name) then the comment text.  e.g.  brello comment 1c11685c "final cut is up"' },
  move:        { sum: 'Move a card to another list.', extra: 'Arguments: a card (id or exact name) then the list name. Leaving Backlog needs a due date first (DUE_REQUIRED). Optional  --reason "<why>"  is recorded on the card.  e.g.  brello move 1c11685c In Progress' },
  priority:    { sum: 'Set or clear a card’s priority.', extra: 'Arguments: a card (id or exact name) then top / high / medium / low — or "none" to clear it.  e.g.  brello priority 1c11685c high' },
  assign:      { sum: 'Assign a card to someone — or unassign it.', extra: 'Arguments: a card (id or exact name) then a name (or Uxxxx slack id) — or "none" to unassign. Optional  --reason "<why>"  is recorded on the card.  e.g.  brello assign 1c11685c Samer' },
  rename:      { sum: 'Rename a card.', extra: 'Arguments: a card (id or exact name) then the new title.  e.g.  brello rename 1c11685c New title' },
  describe:    { sum: 'Set a card’s description.', extra: 'Arguments: a card (id or exact name) then the description text.  e.g.  brello describe 1c11685c "the full brief"' },
  archive:     { sum: 'Archive a card — or restore it.', extra: 'Unavailable to self-service keys. Requires an administrator-issued key with archive access. Argument: a card (id or exact name). Add --restore to bring it back.  e.g.  brello archive 1c11685c' },
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
  comments:    'BY = author · AT = when it was posted',
  reactions:   'BY = who reacted · AT = when',
  activity:    'DID = what happened · WHO = who did it · WHEN = timestamp',
  search:      'STAGE = board list · DUE = due date · DONE = ✓ complete',
  user:        'STATUS = live / done / archived · STARTED→ENDED→DONE = work timeline',
  stages:      'CARDS = open cards here · OVERDUE = how many are late',
  departments: 'PEOPLE = headcount · ACTIVE NOW = tracking time',
  shoots:      'TIME = start time · CREW = who’s on it · ACCOUNT = account owner · MONTH = contract month · MODELS = models needed (✓ = arranged) · READINESS = what is still missing',
  meetings:    'START = Kuwait time · OWNER = organiser · MINUTES = none / draft / submitted',
  clients:     'HANDLE = Instagram handle · OPEN CARDS = in your card scope · LOGO = has a logo',
  cards:       'STAGE = board list · HISTORY = stages it passed through, oldest first',
  readiness:   'IN = days until the shoot · MISSING = plan, budget, models, props or call time not settled yet',
  studio:      'VERSION = latest Studio version · COMMENTS = review comments · CLIENT VIEWED = qualifying client share open',
  client:      'STAGE = board list · ASSIGNEE = owner · DUE = due date',
  scope:       'CONTRACTED = sold on the quote · SHOT = completed shoot days · DELIVERED = sent or completed · APPROVED = client approved in Studio · ? = unknown',
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
  studio:   'nothing in the Studio review feed',
  shoots:   'no shoots scheduled in that range',
  meetings: 'no meetings in that range',
  clients:  'no clients matched that name',
  readiness:'no shoots in that window',
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
  const usage = 'brello ' + (key === 'keys' ? 'help keys' : key) + (def?.arg ? ' ' + def.arg : '')
  if (JSON_OUT) { emit({ ok: true, command: key, usage, admin: !!def?.admin, summary: d?.sum || null, detail: d?.extra || null, columns: LEGENDS[key] || null }); return }
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
      ['docs', '', 'Developer hub, setup and command reference'],
      ['help keys', '', 'Key permissions, limits, renewal and recovery'],
      ['auth', '', 'Sign in with your key from ' + CONNECT_URL],
      ['login', '< key', 'Sign in from a pipe, e.g.  pbpaste | brello login'],
      ['whoami', '', 'Check whether a key is set'],
      ['logout', '', 'Remove your saved key'],
      ['changelog', '', "What's new — every release"],
    ] },
    { title: 'Your team',        cmds: ['stats', 'team', 'now', 'workload', 'overdue', 'active', 'departments'] },
    { title: 'Cards & people',   cmds: ['search', 'user', 'client', 'clients', 'scope', 'card', 'due', 'done', 'blocked', 'recent', 'activity', 'comments', 'reactions'] },
    { title: 'Board & production', cmds: ['stages', 'cards', 'stage-stats', 'shoots', 'meetings', 'readiness', 'studio'] },
    { title: 'Act on cards', rows: [
      ['create', '"<title>" [flags]', 'Create a new card (--assignee --due --client --dept --priority --list)'],
      ['comment', '<card> <text>', 'Add a comment to a card'],
      ['move', '<card> <list>', 'Move a card to another list (--reason)'],
      ['due', '<card> <date>', 'Set or clear a card’s due date (--reason)'],
      ['done', '<card>', 'Mark a card done (--undo reopens)'],
      ['priority', '<card> <level>', 'Set or clear a card’s priority'],
      ['assign', '<card> <who>', 'Assign a card, none unassigns (--reason)'],
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
  if (JSON_OUT) {
    emit({ ok: true, version: VERSION, docs: DOCS_URL, groups: groups.map(g => ({ title: g.title, commands: g.items.map(([command, arg, desc]) => ({ command, arg: arg || null, desc })) })) })
    return
  }
  const w = Math.max(...groups.flatMap(g => g.items.map(([n, a]) => (n + (a ? ' ' + a : '')).length)))
  console.log(`\n${B}brello${R} ${D}— your team's work, from the terminal${R}\n`)
  for (const g of groups) {
    console.log(`${B}${g.title}${R}`)
    for (const [n, a, desc] of g.items) {
      console.log(`  ${C}${(n + (a ? ' ' + a : '')).padEnd(w)}${R}  ${D}${desc}${R}`)
    }
    console.log('')
  }
  console.log(`${D}  docs: ${DOCS_URL}${R}`)
  console.log(`${D}  self-service keys: your team, approved actions, 60/min + 5,000/day. Run brello help keys.${R}`)
  console.log(`${D}  examples:  brello user Samer   ·   brello studio reel   ·   brello card 1c11685c${R}`)
  console.log(`${D}  scripts:   add --json to any command for raw JSON (no banner, no colour)${R}`)
  console.log(`${D}  new here?  run  ${R}${C}brello auth${R}${D}  first, then  ${R}${C}brello stats${R}\n`)
}

if (!cmd || cmd === '--help' || cmd === '-h' || (cmd === 'help' && !rest.length)) { help(); process.exit(0) }
if (cmd === 'help') { helpFor((rest[0] || '').trim()); process.exit(0) }
// also support  brello <command> --help / -h  → the focused panel for that command
if (rest.includes('--help') || rest.includes('-h')) { helpFor(cmd); process.exit(0) }

if (cmd === 'login') {
  if (rest.some(a => !a.startsWith('--'))) {
    console.error(c.red('✖') + ' brello login no longer takes the key as an argument, so it stays out of your shell history.')
    console.error('  run  ' + c.cyan('brello auth') + '  (masked prompt)  or  ' + c.cyan('pbpaste | brello login'))
    process.exit(1)
  }
  if (process.stdin.isTTY) { const { runAuth } = await import('./lib/auth.mjs'); await runAuth(); process.exit(0) }
  const { runLoginFromStdin } = await import('./lib/auth.mjs')
  await runLoginFromStdin()
  process.exit(0)
}

// global flags: --board widens card queries to the whole board; --unassigned filters
// to no-assignee; --undo / --restore feed the write commands.
let reason = null
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--reason') { reason = rest[i + 1] ?? ''; rest.splice(i, 2); break }
  if (rest[i].startsWith('--reason=')) { reason = rest[i].slice('--reason='.length); rest.splice(i, 1); break }
}
// --days takes a value (brello readiness --days 5); pull it out before the
// generic flag split so the number is not read as an argument.
let daysFlag = null
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--days') { daysFlag = rest[i + 1] ?? ''; rest.splice(i, 2); break }
  if (rest[i].startsWith('--days=')) { daysFlag = rest[i].slice('--days='.length); rest.splice(i, 1); break }
}
// Value flags for the filtered reads (--from 2026-10-01 or --from=2026-10-01).
// Taken out of `rest` first so their values never read as positional args.
const VALUE_FLAGS = {
  shoots: ['from', 'to', 'client', 'type', 'status'],
  meetings: ['from', 'to', 'client', 'owner'],
  'stage-stats': ['department', 'dept', 'client'],
  cards: ['client', 'offset', 'limit', 'created-after', 'created-before'],
}
const opts = {}
for (const name of VALUE_FLAGS[cmd] || []) {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--' + name) {
      const v = rest[i + 1]
      const has = v !== undefined && !v.startsWith('--')
      opts[name] = has ? v : ''
      rest.splice(i, has ? 2 : 1)
      break
    }
    if (a.startsWith('--' + name + '=')) { opts[name] = a.slice(name.length + 3); rest.splice(i, 1); break }
  }
}
const flags = new Set(rest.filter(a => a.startsWith('--')))
const args = rest.filter(a => !a.startsWith('--'))

if (COMMANDS[cmd] || WRITES[cmd] || cmd === 'create' || cmd === 'new') {
  const t = getToken()
  if (t && isLegacyKey(t)) printLegacyHint(t)
}

// create mints a NEW card (title + value flags), so it parses `rest` itself
// rather than going through the card-ref write path.
if (cmd === 'create' || cmd === 'new') { await runCreate(rest); process.exit(0) }

// scope parses its own --month value and --json, so it skips the generic path.
if (cmd === 'scope') { await runScope(rest); process.exit(0) }

// write commands act on one card (comment/move/due/done/priority/assign/rename/
// describe/archive). due & done double as read commands: a non-numeric first arg
// ("brello due 1c11685c 2026-07-20") acts on that card; a number or nothing reads.
if (wantsWrite(cmd, args)) { await runWrite(cmd, args, flags, reason); process.exit(0) }
if (reason !== null) { console.error('--reason works with move, due and assign.'); process.exit(1) }

const def = COMMANDS[cmd]
if (!def) { console.error(`I don't know "${cmd}".`); help(); process.exit(1) }

const params = {}
if (flags.has('--board')) params.scope = 'board'
if (def.q === 'cards') {
  if (args.length) params.stage = args.join(' ').trim()
  if (flags.has('--unassigned')) params.assignee = 'none'
  if (flags.has('--history')) params.history = true
  if (opts.client) params.client = opts.client
  for (const [flag, key] of [['created-after', 'created_after'], ['created-before', 'created_before']]) {
    if (opts[flag] === undefined) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts[flag].trim())) { console.error(`--${flag} takes a date, e.g.   brello cards --board --${flag} 2026-10-01`); process.exit(1) }
    params[key] = opts[flag].trim()
  }
  for (const k of ['offset', 'limit']) {
    if (opts[k] === undefined) continue
    const n = Number(opts[k])
    if (!Number.isInteger(n) || n < (k === 'limit' ? 1 : 0)) { console.error(`--${k} takes a whole number, e.g.   brello cards --board --limit 1000 --offset 1000`); process.exit(1) }
    params[k] = n
  }
}
if (def.q === 'shoots' || def.q === 'meetings') {
  for (const k of ['from', 'to', 'client', 'type', 'status', 'owner']) if (opts[k]) params[k] = opts[k].trim()
  if ((params.from && !params.to) || (params.to && !params.from)) {
    console.error(`Give both dates, e.g.   brello ${cmd} --from 2026-10-01 --to 2026-10-31`)
    process.exit(1)
  }
  if (def.q === 'shoots' && flags.has('--include-removed')) params.include_removed = true
}
if (def.q === 'clients') {
  const n = args.join(' ').trim()
  if (n) params.q = n
  if (flags.has('--all')) params.active = false
}
if (def.q === 'stage_stats') {
  const d = opts.department || opts.dept
  if (d) params.department = d.trim()
  if (opts.client) params.client = opts.client.trim()
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
if (def.q === 'studio') {
  const f = args.join(' ').trim()
  if (f) params.q = f   // optional name filter, e.g. brello studio reel
}
if (def.q === 'client') {
  params.client = args.join(' ').trim()
  if (!params.client) { console.error('Add a client name, e.g.   brello client "Foodhall"'); process.exit(1) }
}
if (def.q === 'due')    { const n = parseInt(args[0], 10); if (Number.isFinite(n)) params.days = n; }
if (def.q === 'done')   { const n = parseInt(args[0], 10); if (Number.isFinite(n)) params.days = n; }
if (def.q === 'recent') { const n = parseInt(args[0], 10); if (Number.isFinite(n)) params.n = n; }
if (def.q === 'readiness') {
  const raw = daysFlag ?? args[0]
  if (raw !== undefined) {
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 1) { console.error('--days takes a number of days, e.g.   brello readiness --days 5'); process.exit(1) }
    params.days = n
  }
}
if (daysFlag !== null && def.q !== 'readiness') { console.error('--days works with readiness. For due and done, pass the number, e.g.   brello due 3'); process.exit(1) }

// Human view only: nested fields read as one line, and the widest rows keep
// their key columns. --json always returns every field untouched.
const when16 = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '')
function humanRows(name, rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') return rows
  if (name === 'shoots') {
    const removed = rows.some(s => s.removed_at)
    return rows.map(s => ({
      date: s.date, time: s.time, client: s.client, type: s.type, status: s.status, location: s.location,
      crew: s.crew, account: s.account, month: s.contract_month, extended: s.extended ? 'yes' : '',
      models: typeof s.models === 'number' ? (s.models ? `${s.models}${s.models_arranged ? ' ✓' : ''}` : '0') : '',
      ...(s.readiness !== undefined ? { readiness: s.readiness } : {}),
      ...(removed ? { removed: s.removed_at ? String(s.removed_at).slice(0, 10) : '', why: s.removed_reason || '' } : {}),
    }))
  }
  if (name === 'meetings') {
    return rows.map(m => ({
      start: when16(m.start), client: m.client, title: m.title, owner: m.owner,
      attendees: (m.attendees || []).map(a => a.name).join(', '), online: m.online ? 'yes' : '',
      minutes: m.minutes_status, by: m.minutes_by,
    }))
  }
  if (name === 'clients') {
    return rows.map(c => ({ name: c.name, handle: c.instagram_handle ? '@' + String(c.instagram_handle).replace(/^@/, '') : '', open_cards: c.open_cards, logo: c.logo_url ? 'yes' : 'no' }))
  }
  if (name === 'cards' && rows.some(r => Array.isArray(r.history))) {
    return rows.map(({ history, stage_entered_at, dwell_basis, ...r }) => ({ ...r, history: (history || []).map(h => h.stage).join(' > ') }))
  }
  return rows
}

try {
  const r = await withSpinner(`querying · ${cmd}`, () => callRoster(def.q, params))
  if (JSON_OUT) { emit(r); process.exit(0) }
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
    table(humanRows(cmd, displayRows(def.q, r.data)), cmd)
    const leg = legendFor(cmd)
    if (leg && r.data.length && typeof r.data[0] === 'object' && Object.keys(r.data[0]).length >= 4) {
      console.log('  ' + c.dim('legend:  ') + c.dim(leg))
    }
  } else printObject(r.data)
  if (r.note) console.log('\n  ' + c.dim('▸ ') + c.amber(r.note))
  console.log(c.dim(`\n  ↳ brello help  ·  for everything you can ask\n`))
  printNotice('\n\n')
} catch (e) {
  if (JSON_OUT) emitError(e)
  console.error('✖ ' + describeError(e))
  process.exit(1)
}
