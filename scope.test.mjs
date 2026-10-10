import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { parseScopeArgs, deliverableRows, extraRows, entryHeading, valueText } from './lib/scope.mjs'
import { QUERIES } from './lib/client.mjs'

// A real gateway answer (Sedra Perfumes, 2026-09), ids shortened.
const SEDRA = {
  ok: true, scope: 'all departments', client: 'Sedra Perfumes', month: '2026-09', count: 1,
  data: [{
    opportunity_id: '006Pr00000XRGsBIAX', contract: 'Social Media Management & Content',
    contract_type: 'retainer', frequency: 'Monthly', status: 'active',
    period: { from: '2026-09-01', to: '2026-09-30', months: ['2026-09'], basis: 'invoice', salesforce_invoice: 'Inv-05524' },
    deliverables: [
      { type: 'sessions', contracted: 2, shot: 1, delivered: null, approved: null },
      { type: 'photos', contracted: 9, shot: 9, delivered: 9, approved: 0, delivered_cards: 1, approved_cards: 0 },
      { type: 'videos', contracted: 6, shot: 4, delivered: 1, approved: 0, delivered_cards: 1, approved_cards: 0 },
      { type: 'artworks', contracted: 9, shot: null, delivered: 0, approved: 0, delivered_cards: 0, approved_cards: 0 },
    ],
    extras: [
      { special_request_id: '7c009356', what: 'Extra Video', status: 'done', value: { videos: 2 } },
      { special_request_id: 'e5645761', what: 'Production Budget', status: 'working', value: null },
    ],
    notes: ['3 delivered cards on this opportunity carry no month (no invoice, delivery month or shoot) and are not counted'],
  }],
  notes: ['sessions have no delivered or approved count: a session is shot, not sent'],
}

test('scope arguments: client words, --month value or =value, --json', () => {
  assert.deepEqual(parseScopeArgs(['Sedra', '--month', '2026-10']), { client: 'Sedra', month: '2026-10', json: false })
  assert.deepEqual(parseScopeArgs(['Sedra', 'Perfumes', '--month=2026-10', '--json']), { client: 'Sedra Perfumes', month: '2026-10', json: true })
  assert.deepEqual(parseScopeArgs(['--json', 'Sedra']), { client: 'Sedra', month: null, json: true })
  assert.match(parseScopeArgs(['--month', '2026-10']).error, /client name/)
  assert.match(parseScopeArgs(['Sedra', '--month', '2026-13']).error, /YYYY-MM/)
  assert.match(parseScopeArgs(['Sedra', '--month']).error, /YYYY-MM/)
})

test('table rows show unknown as ?, sessions as n/a, and money never', () => {
  const rows = deliverableRows(SEDRA.data[0])
  assert.deepEqual(rows[0], { type: 'sessions', contracted: '2', shot: '1', delivered: 'n/a', approved: 'n/a', cards: '' })
  assert.deepEqual(rows[3], { type: 'artworks', contracted: '9', shot: '?', delivered: '0', approved: '0', cards: '0 sent, 0 ok' })
  assert.deepEqual(extraRows(SEDRA.data[0].extras), [
    { request: 'Extra Video', status: 'done', value: '2 videos' },
    { request: 'Production Budget', status: 'working', value: '' },
  ])
  assert.equal(valueText({ videos: 1, sessions: 1 }), '1 videos, 1 sessions')
  assert.deepEqual(entryHeading(SEDRA.data[0]), { title: 'Social Media Management & Content', sub: 'retainer · Monthly · active · period 2026-09 · Inv-05524' })
})

// A local stand-in for roster-query: records the request, answers with SEDRA.
async function withGateway(fn) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      seen.push(JSON.parse(body))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(SEDRA))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try { return await fn(`http://127.0.0.1:${server.address().port}`, seen) } finally { server.close() }
}
function run(url, ...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['cli.mjs', ...args], {
      cwd: new URL('.', import.meta.url),
      env: { ...process.env, ROSTER_URL: url, BRELLO_TOKEN: 'brl_test_key' },
    })
    let stdout = '', stderr = ''
    p.stdout.on('data', d => { stdout += d })
    p.stderr.on('data', d => { stderr += d })
    p.on('close', status => resolve({ status, stdout, stderr }))
  })
}

test('brello scope --json prints the gateway answer untouched', async () => {
  await withGateway(async (url, seen) => {
    const r = await run(url, 'scope', 'Sedra', '--month', '2026-09', '--json')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout), SEDRA)
    assert.equal(seen[0].query, 'scope')
    assert.deepEqual(seen[0].params, { client: 'Sedra', month: '2026-09' })
  })
})

test('brello scope prints one table per contract with its notes', async () => {
  await withGateway(async (url) => {
    const r = await run(url, 'scope', 'Sedra', '--month=2026-09')
    assert.equal(r.status, 0, r.stderr)
    for (const s of ['Sedra Perfumes', 'scope · 2026-09', 'Social Media Management & Content', 'CONTRACTED', 'DELIVERED', 'photos', 'artworks', 'Extra Video', '2 videos', 'carry no month', 'a session is shot, not sent'])
      assert.ok(r.stdout.includes(s), s)
    assert.doesNotMatch(r.stdout, /[–—]/)
  })
})

test('a bad month or no client never reaches the gateway', async () => {
  await withGateway(async (url, seen) => {
    assert.equal((await run(url, 'scope', 'Sedra', '--month', '10-2026')).status, 1)
    assert.equal((await run(url, 'scope')).status, 1)
    assert.equal(seen.length, 0)
  })
})

test('scope is wired into help, the query list, the docs and the MCP server', async () => {
  assert.ok(QUERIES.scope && QUERIES.scope.params.includes('month'))
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
  assert.match(read('QUERIES.md'), /brello scope "<client>" --month YYYY-MM/)
  assert.match(read('README.md'), /brello scope "Sedra" --month 2026-10/)
  for (const f of ['lib/scope.mjs']) assert.doesNotMatch(read(f), /[–—]/, f)
  const client = new Client({ name: 'scope-test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./mcp.mjs', import.meta.url).pathname], env: { ...process.env, ROSTER_URL: 'http://127.0.0.1:1', BRELLO_TOKEN: 'not-a-key' } }))
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === 'roster_scope')
    assert.ok(tool, 'roster_scope registered')
    assert.deepEqual(tool.inputSchema.required, ['client'])
  } finally { await client.close() }
})
