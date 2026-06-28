// `brello auth` — interactive login with a little terminal theatre.
import readline from 'node:readline'
import { callRoster, saveToken, clearToken } from './client.mjs'

const tty = process.stdout.isTTY
const R = '\x1b[0m', B = '\x1b[1m'
const C = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m', white: '\x1b[97m', mag: '\x1b[35m', yellow: '\x1b[33m' }
const p = (s, ...codes) => (tty ? codes.join('') + s + R : s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (s = '') => process.stdout.write(s + '\n')

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
  out('  ' + p('  paste the token your admin gave you, then press enter', C.gray))
  out()
  const token = await askToken('  ' + p('token', C.cyan) + ' ▸ ')
  if (!token) { out('\n  ' + p('✗ nothing entered.', C.red) + '\n'); process.exit(1) }
  out()

  // techy telemetry preamble
  const sig = (token.split('.')[2] || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase() || '—'
  out('  ' + p('◢ gateway  ', C.gray) + p('roster-query', C.white) + p('  ·  ap-south-1', C.gray))
  out('  ' + p('◢ cipher   ', C.gray) + p('HS256', C.white) + p('  ·  TLS 1.3', C.gray))
  out('  ' + p('◢ session  ', C.gray) + p(sig, C.mag))
  out()

  await step('opening secure channel')
  await step('negotiating cipher suite')
  let stats
  try { stats = await callRoster('stats', {}, token) }
  catch (e) {
    clearToken()
    const why = /invalid|expired/.test(e.message) ? 'token invalid or expired' : e.message
    out('\n  ' + p('✗ ACCESS DENIED', C.red, B) + p('  ' + why, C.gray))
    out('  ' + p('ask your admin for a fresh token, then run  brello auth', C.gray) + '\n')
    process.exit(1)
  }
  const cl = decode(token)
  await step('verifying credentials')
  await step('resolving scope · ' + (Array.isArray(cl.depts) ? cl.depts.join(', ') : 'team'))
  await bar('syncing board state')
  saveToken(token)
  out('\n  ' + p('◆ LINK ESTABLISHED', C.green, B))

  // reveal the banner line by line
  out()
  for (let i = 0; i < BANNER.length; i++) { out('   ' + grad(BANNER[i], i, BANNER.length)); if (tty) await sleep(45) }
  out()

  const d = stats.data || {}
  const exp = cl.exp ? new Date(cl.exp * 1000).toISOString().slice(0, 10) : '—'
  const bln = (s) => p('  ┃ ', C.cyan) + s
  out(bln(p('▸ AUTHENTICATED', C.green, B) + '   ' + p(cl.label || '', C.white)))
  out(bln(p('scope   ', C.gray) + p(Array.isArray(cl.depts) ? cl.depts.join(', ') : '—', C.cyan, B)))
  out(bln(p('team ', C.gray) + p(d.team_size ?? '—', C.white) + p('   open ', C.gray) + p(d.open ?? '—', C.white) + p('   overdue ', C.gray) + p(d.overdue ?? '—', C.white) + p('   active ', C.gray) + p(d.active_now ?? '—', C.white)))
  out(bln(p('token   valid until ' + exp, C.gray)))
  out()
  out('  ' + p('ready.', C.green, B) + p('  try:  ', C.gray) + p('brello stats', C.cyan) + p('  ·  ', C.gray) + p('brello activity', C.cyan) + p('  ·  ', C.gray) + p('brello shoots', C.cyan))
  out()
}
