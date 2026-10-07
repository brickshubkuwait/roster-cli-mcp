// `brello auth` — interactive login with a little terminal theatre.
import readline from 'node:readline'
import { callRoster, saveToken, clearToken, isLegacyKey, LEGACY_HINT, CONNECT_URL, describeError, takeNotice } from './client.mjs'

const tty = process.stdout.isTTY
const R = '\x1b[0m', B = '\x1b[1m'
const C = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m', white: '\x1b[97m', mag: '\x1b[35m', yellow: '\x1b[33m' }
const p = (s, ...codes) => (tty ? codes.join('') + s + R : s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (s = '') => process.stdout.write(s + '\n')
const etty = process.stderr.isTTY
const err = (s = '') => process.stderr.write(s + '\n')
const pe = (s, ...codes) => (etty ? codes.join('') + s + R : s)
const DIM = '\x1b[2m'

export function printNotice(suffix = '\n') {
  const n = takeNotice()
  if (n) process.stderr.write('  ' + pe('▸ Notice: ' + n, DIM, C.yellow) + suffix)
}
export function printLegacyHint(token) {
  if (isLegacyKey(token)) err('  ' + pe('▸ ' + LEGACY_HINT, C.yellow))
}

const BANNER = [
  '██████╗ ██████╗ ███████╗██╗     ██╗      ██████╗ ',
  '██╔══██╗██╔══██╗██╔════╝██║     ██║     ██╔═══██╗',
  '██████╔╝██████╔╝█████╗  ██║     ██║     ██║   ██║',
  '██╔══██╗██╔══██╗██╔══╝  ██║     ██║     ██║   ██║',
  '██████╔╝██║  ██║███████╗███████╗███████╗╚██████╔╝',
  '╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝ ╚═════╝ ',
]
function grad(line, i, n) {
  if (!tty) return line
  const a = [0, 224, 255], b = [150, 110, 255], t = n > 1 ? i / (n - 1) : 0
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t))
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${B}${line}${R}`
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
async function step(label, ms = 320) {
  if (!tty) { out('  ' + p('✓', C.green) + '  ' + label); return }
  let i = 0
  const t = setInterval(() => process.stdout.write('\r  ' + p(SPIN[i++ % SPIN.length], C.cyan) + '  ' + p(label, C.gray) + '              '), 60)
  await sleep(ms)
  clearInterval(t)
  process.stdout.write('\r  ' + p('✓', C.green) + '  ' + p(label, C.white) + '                \n')
}
async function bar(label, ms = 620) {
  if (!tty) { out('  ' + p('✓', C.green) + '  ' + label); return }
  const W = 26
  for (let i = 0; i <= W; i++) {
    process.stdout.write('\r  ' + p(label.padEnd(20), C.gray) + p('▕', C.gray) + p('█'.repeat(i), C.cyan) + p('░'.repeat(W - i), C.gray) + p('▏', C.gray) + ' ' + p(String(Math.round((i / W) * 100)).padStart(3) + '%', C.white))
    await sleep(ms / W)
  }
  process.stdout.write('  ' + p('✓', C.green) + '\n')
}
function decode(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) } catch { return {} }
}
function askToken(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => { rl.output.write(s.includes(prompt) || /[\r\n]/.test(s) ? s : '•') }
    rl.question(prompt, (a) => { rl.close(); resolve(a.trim()) })
  })
}

export async function runAuth() {
  out()
  out('  ' + p('◆ BRELLO', C.cyan, B) + p('  ·  secure access terminal', C.gray))
  out('  ' + p('  paste your key from ' + CONNECT_URL + ', then press enter', C.gray))
  out()
  const token = await askToken('  ' + p('key', C.cyan) + ' ▸ ')
  if (!token) { out('\n  ' + p('✗ nothing entered.', C.red) + '\n'); process.exit(1) }
  out()
  printLegacyHint(token)

  // techy telemetry preamble — JWTs show their signature; short brl_ keys a masked tail
  const isJwt = token.split('.').length === 3
  const sig = isJwt
    ? ((token.split('.')[2] || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase() || '—')
    : 'KEY ····' + token.slice(-4).toUpperCase()
  out('  ' + p('◢ gateway  ', C.gray) + p('roster-query', C.white) + p('  ·  ap-south-1', C.gray))
  out('  ' + p('◢ cipher   ', C.gray) + p(isJwt ? 'HS256' : 'SHA-256', C.white) + p('  ·  TLS 1.3', C.gray))
  out('  ' + p('◢ session  ', C.gray) + p(sig, C.mag))
  out()

  await step('opening secure channel')
  await step('negotiating cipher suite')
  let stats
  try { stats = await callRoster('stats', {}, token) }
  catch (e) {
    clearToken()
    out('\n  ' + p('✗ ACCESS DENIED', C.red, B))
    out('  ' + p(describeError(e), C.gray) + '\n')
    process.exit(1)
  }
  // Short tokens carry no claims — read the scope off the server's response.
  const cl = decode(token)
  const scopeStr = Array.isArray(cl.depts) ? cl.depts.join(', ') : String(stats.scope || 'team').replace(/^team:\s*/, '')
  await step('verifying credentials')
  await step('resolving scope · ' + scopeStr)
  await bar('syncing board state')
  saveToken(token)
  out('\n  ' + p('◆ LINK ESTABLISHED', C.green, B))

  // reveal the banner line by line
  out()
  for (let i = 0; i < BANNER.length; i++) { out('   ' + grad(BANNER[i], i, BANNER.length)); if (tty) await sleep(45) }
  out()

  const d = stats.data || {}
  const exp = cl.exp ? new Date(cl.exp * 1000).toISOString().slice(0, 10) : null
  const bln = (s) => p('  ┃ ', C.cyan) + s
  out(bln(p('▸ AUTHENTICATED', C.green, B) + '   ' + p(cl.label || '', C.white)))
  out(bln(p('scope   ', C.gray) + p(scopeStr || '—', C.cyan, B)))
  out(bln(p('team ', C.gray) + p(d.team_size ?? '—', C.white) + p('   open ', C.gray) + p(d.open ?? '—', C.white) + p('   overdue ', C.gray) + p(d.overdue ?? '—', C.white) + p('   active ', C.gray) + p(d.active_now ?? '—', C.white)))
  out(bln(p(exp ? 'key     valid until ' + exp : 'key     manage it at ' + CONNECT_URL, C.gray)))
  out()
  out('  ' + p('ready.', C.green, B) + p('  try:  ', C.gray) + p('brello stats', C.cyan) + p('  ·  ', C.gray) + p('brello activity', C.cyan) + p('  ·  ', C.gray) + p('brello shoots', C.cyan))
  out()
  printNotice('\n\n')
}

function readStdin(ms = 10000) {
  return new Promise((resolve) => {
    let data = ''
    const done = () => { clearTimeout(timer); process.stdin.pause(); resolve(data) }
    const timer = setTimeout(done, ms)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk; if (data.length > 8192) done() })
    process.stdin.on('end', done)
    process.stdin.on('error', done)
  })
}

export async function runLoginFromStdin() {
  const token = ((await readStdin()).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '')
  if (!token) {
    err(pe('✖ No key received on stdin.', C.red) + '  try:  pbpaste | brello login   or run  brello auth')
    process.exit(1)
  }
  printLegacyHint(token)
  let stats
  try { stats = await callRoster('stats', {}, token) }
  catch (e) {
    err(pe('✖ ' + describeError(e), C.red))
    process.exit(1)
  }
  saveToken(token)
  const scope = String(stats?.scope || '').replace(/^team:\s*/, '')
  out(p('✓', C.green) + ' key saved' + (scope ? p('  ·  ' + scope, C.gray) : '') + p('  ·  try:  ', C.gray) + p('brello stats', C.cyan))
  printNotice()
}
