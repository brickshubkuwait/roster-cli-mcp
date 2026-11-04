import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { makeCliCode, makeCliSecret, formatCliCode, connectLink, startCliLogin, pollCliLogin, STOP_TEXT } from './lib/auth.mjs'

const fakeClock = () => {
  let t = 0
  return { now: () => t, wait: async (ms) => { t += ms } }
}

test('codes are 8 base32 characters and secrets 64 hex, never repeated', () => {
  const codes = new Set(Array.from({ length: 200 }, makeCliCode))
  assert.equal(codes.size, 200)
  for (const c of codes) assert.match(c, /^[A-Z2-7]{8}$/)
  assert.match(makeCliSecret(), /^[0-9a-f]{64}$/)
  assert.equal(formatCliCode('ABCD2345'), 'ABCD 2345')
  assert.equal(connectLink('ABCD2345'), 'https://roster.bricks.com.kw/connect?cli=ABCD2345')
})

test('start registers code and secret, and retries a taken code', async () => {
  const sent = []
  let first = true
  const call = async (action, body) => {
    sent.push([action, body])
    if (first) { first = false; const e = new Error('taken'); e.code = 'code_taken'; throw e }
    return { ok: true }
  }
  const got = await startCliLogin({ call })
  assert.equal(sent.length, 2)
  assert.equal(sent[1][0], 'cli_start')
  assert.deepEqual(sent[1][1], got)
  const boom = async () => { const e = new Error('nope'); e.code = 'bad_code'; throw e }
  await assert.rejects(startCliLogin({ call: boom }), /nope/)
})

test('poll waits through pending and waiting, tolerates 429 and network errors, returns the key once', async () => {
  const seq = [{ status: 'pending' }, 'net', { status: 'pending' }, 'rate', { status: 'waiting' }, { status: 'waiting' }, { status: 'ok', key: 'brl_x', token: { label: 'L' } }]
  const call = async (action, body) => {
    assert.equal(action, 'cli_poll')
    assert.deepEqual(body, { code: 'ABCD2345', secret: 's' })
    const next = seq.shift()
    if (next === 'net') { const e = new Error('down'); e.network = true; throw e }
    if (next === 'rate') { const e = new Error('slow'); e.status = 429; throw e }
    return { ok: true, ...next }
  }
  const seen = []
  const clock = fakeClock()
  const r = await pollCliLogin({ code: 'ABCD2345', secret: 's', call, ...clock, onStatus: (s) => seen.push(s) })
  assert.deepEqual(r, { status: 'ok', key: 'brl_x', token: { label: 'L' } })
  assert.deepEqual(seen, ['pending', 'waiting'])
})

test('deny, expiry and unknown stop with a clear message', async () => {
  for (const status of ['denied', 'expired', 'unknown', 'used', 'not_allowed']) {
    const r = await pollCliLogin({ code: 'ABCD2345', secret: 's', call: async () => ({ status, note: status === 'denied' ? 'Not now' : undefined }), ...fakeClock() })
    assert.equal(r.status, status)
    assert.ok(STOP_TEXT[status])
    if (status === 'denied') assert.equal(r.note, 'Not now')
  }
  await assert.rejects(pollCliLogin({ code: 'A', secret: 's', call: async () => { const e = new Error('bad'); e.status = 400; throw e }, ...fakeClock() }), /bad/)
})

test('polls every 2 s for 10 minutes, then every 15 s, and gives up after 24 hours', async () => {
  const waits = []
  let t = 0
  const r = await pollCliLogin({ code: 'ABCD2345', secret: 's', call: async () => ({ status: 'waiting' }), now: () => t, wait: async (ms) => { waits.push(ms); t += ms } })
  assert.equal(r.status, 'timeout')
  assert.equal(waits.filter((w) => w === 2000).length, 300)
  assert.equal(waits.filter((w) => w === 15000).length, (24 * 3600_000 - 600_000) / 15000)
})

test('help and copy: Google sign in, no reveal or paste for the normal path, no dashes', () => {
  const run = (...args) => spawnSync(process.execPath, ['cli.mjs', ...args], { cwd: new URL('.', import.meta.url), encoding: 'utf8', env: { ...process.env, ROSTER_URL: 'http://127.0.0.1:1', BRELLO_TOKEN: 'not-a-key' } }).stdout
  const auth = run('help', 'auth')
  assert.match(auth, /sign in with your Bricks Google account/)
  const keys = run('help', 'keys')
  for (const t of [auth, keys]) {
    assert.doesNotMatch(t, /reveal|paste at|read-only|scoped|audited|[–—]/i)
  }
})

test('1.15.1 copy: an admin, never a name, and approved once', () => {
  const run = (...args) => spawnSync(process.execPath, ['cli.mjs', ...args], { cwd: new URL('.', import.meta.url), encoding: 'utf8', env: { ...process.env, ROSTER_URL: 'http://127.0.0.1:1', BRELLO_TOKEN: 'not-a-key' } }).stdout
  const text = [run('help'), run('help', 'auth'), run('help', 'keys'), run('help', 'login')].join('\n')
  assert.doesNotMatch(text, /Yousef/)
  assert.match(text, /a key from an admin/)
  assert.match(run('help', 'keys'), /Approved once\. After that your terminal reconnects on its own/)
  assert.equal(STOP_TEXT.denied, 'Your access request was not approved.')
})
