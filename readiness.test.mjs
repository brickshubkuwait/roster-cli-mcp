// brello readiness: drives the real CLI against a local stand-in for the
// roster-query gateway, so it needs no key and no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const READINESS = {
  ok: true, scope: 'all shoots', filter: 'company-wide shoots from 2026-10-10 to 2026-10-15 (next 5 days)',
  days: 5, from: '2026-10-10', until: '2026-10-15', count: 2, not_ready: 1,
  data: [
    { id: 'aaaa1111', date: '2026-10-10', in_days: 0, time: '10:00 AM', client: 'Foodhall', type: 'Studio', status: 'Confirmed', account: 'Melani Martis', ready: true, missing: '', missing_detail: [], plan: 'ready', budget: 'approved', models: 'confirmed', props: 'not_needed', call_time_confirmed: true, plan_url: 'https://studio.example/p/1', budget_approval_url: 'https://mail.example/1' },
    { id: 'bbbb2222', date: '2026-10-13', in_days: 3, time: '9:00 AM', client: 'RFL Cafe', type: 'Outdoor', status: 'Pending', account: '', ready: false, missing: 'Budget, Props, Call time', missing_detail: ['Budget: not set', 'Props: not set', 'Call time: 9:00 AM not confirmed'], plan: 'linked', budget: null, models: 'confirmed', props: null, call_time_confirmed: false, plan_url: null, budget_approval_url: null },
  ],
}
const SHOOTS = {
  ok: true, scope: 'all shoots', count: 1,
  data: [{ date: '2026-10-13', time: '9:00', client: 'RFL Cafe', type: 'Outdoor', status: 'Pending', location: 'Kuwait City', crew: 'Ayah', readiness: 'missing: budget, props, call time', checklist: { plan: 'linked', budget: 'not set', models: 'confirmed', props: 'not set', call_time: 'not confirmed' } }],
}

let server, url
const seen = []
test.before(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const j = JSON.parse(body || '{}')
      seen.push(j)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(j.query === 'readiness' ? READINESS : j.query === 'shoots' ? SHOOTS : { error: 'unknown query' }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}`
})
test.after(() => server.close())

function cli(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['cli.mjs', ...args], {
      cwd: new URL('.', import.meta.url),
      env: { ...process.env, ROSTER_URL: url, BRELLO_TOKEN: 'brl_test_key' },
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

test('brello readiness --days 5 asks the gateway for 5 days and prints the table', async () => {
  const r = await cli('readiness', '--days', '5')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(seen.at(-1).query, 'readiness')
  assert.deepEqual(seen.at(-1).params, { days: 5 })
  for (const s of ['DATE', 'IN', 'TIME', 'CLIENT', 'ACCOUNT', 'MISSING', 'today', '3 days', 'RFL Cafe', 'Budget, Props, Call time', 'ready']) assert.ok(r.stdout.includes(s), s)
  // Links and per-item detail stay out of the table.
  assert.doesNotMatch(r.stdout, /studio\.example|mail\.example|missing_detail/i)
})

test('readiness defaults to no days param, accepts a bare number and --days=N, and refuses junk', async () => {
  assert.equal((await cli('readiness')).status, 0)
  assert.deepEqual(seen.at(-1).params, {})
  assert.equal((await cli('readiness', '3')).status, 0)
  assert.deepEqual(seen.at(-1).params, { days: 3 })
  assert.equal((await cli('readiness', '--days=10')).status, 0)
  assert.deepEqual(seen.at(-1).params, { days: 10 })
  const bad = await cli('readiness', '--days', 'soon')
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /--days takes a number of days/)
  const elsewhere = await cli('due', '--days', '3')
  assert.equal(elsewhere.status, 1)
  assert.match(elsewhere.stderr, /--days works with readiness/)
})

test('--json prints the gateway response untouched', async () => {
  const r = await cli('readiness', '--days', '5', '--json')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), READINESS)
})

test('brello shoots keeps the readiness line and drops the nested checklist from the table', async () => {
  const r = await cli('shoots')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('READINESS'))
  assert.ok(r.stdout.includes('missing: budget'))
  assert.doesNotMatch(r.stdout, /CHECKLIST|\[object Object\]/)
})

test('help, docs and the MCP tool describe readiness without dashes', async () => {
  const h = await cli('help', 'readiness')
  assert.equal(h.status, 0)
  assert.match(h.stdout, /brello readiness \[--days 7\] \[--json\]/)
  assert.match(h.stdout, /9:00 AM start counts as missing/)
  assert.match((await cli('help')).stdout, /readiness/)
  const cliSrc = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8')
  const lines = cliSrc.split('\n').filter((l) => /readiness/.test(l))
  for (const l of lines) assert.doesNotMatch(l, /[–—]/, l)

  const client = new Client({ name: 'readiness-test', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('./mcp.mjs', import.meta.url).pathname], env: { ...process.env, ROSTER_URL: url, BRELLO_TOKEN: 'brl_test_key' } })
  try {
    await client.connect(transport)
    const tool = (await client.listTools()).tools.find((t) => t.name === 'roster_readiness')
    assert.ok(tool, 'roster_readiness is listed')
    assert.doesNotMatch(tool.description, /[–—]/)
    const res = await client.callTool({ name: 'roster_readiness', arguments: { days: 5 } })
    assert.deepEqual(seen.at(-1), { token: 'brl_test_key', query: 'readiness', params: { days: 5 } })
    assert.equal(JSON.parse(res.content[0].text).not_ready, 1)
  } finally {
    await client.close()
  }
})
