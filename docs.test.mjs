import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { developerGuide, DOCS_URL, KEY_GUIDE } from './lib/docs.mjs'
import { VERSION, CHANGELOG } from './lib/changelog.mjs'

const cli = (...args) => {
  // Deliberately unusable endpoint/key: these commands must remain local.
  const result = spawnSync(process.execPath, ['cli.mjs', ...args], {
    cwd: new URL('.', import.meta.url), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, ROSTER_URL: 'http://127.0.0.1:1', BRELLO_TOKEN: 'not-a-key' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  return result.stdout
}
test('docs links work without credentials or a gateway connection', () => {
  assert.match(cli('docs'), /https:\/\/roster\.bricks\.com\.kw\/developers/)
  assert.match(cli('help'), /help keys/)
  assert.match(cli('help', 'docs'), /Developer hub/)
})
test('key help includes correct request, rotation, limits and local logout semantics', () => {
  const help = cli('help', 'keys')
  for (const copy of ['brello help keys', '24 hours', '10 minutes', '60 requests/minute', '5,000/rolling day', '30 days', 'revokes the old key', 'logout only removes', 'Archive is unavailable']) assert.ok(help.includes(copy), copy)
  assert.doesNotMatch(help, /read-only|scoped|audited|privacy fence|[—–]/i)
})
test('MCP serves the same local guide and reports the published package version', async () => {
  const client = new Client({ name: 'docs-test', version: '1.0.0' })
  const transport = new StdioClientTransport({command:process.execPath,args:[new URL('./mcp.mjs',import.meta.url).pathname],env:{...process.env,ROSTER_URL:'http://127.0.0.1:1',BRELLO_TOKEN:'not-a-key'}})
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    assert.ok(listed.tools.some(t=>t.name==='roster_docs'))
    const docs = await client.callTool({name:'roster_docs',arguments:{}})
    assert.deepEqual(JSON.parse(docs.content[0].text),developerGuide())
    assert.equal(developerGuide().docs,DOCS_URL)
    assert.equal(developerGuide().key_help,KEY_GUIDE)
    const history = JSON.parse((await client.callTool({name:'roster_changelog',arguments:{}})).content[0].text)
    assert.equal(history.installed,VERSION)
    assert.equal(CHANGELOG[0].version,VERSION)
  } finally { await client.close() }
})

// ── --json and the new filters, against a local stand-in for roster-query ──
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ANSI = /\x1b\[/
async function withGateway(reply, fn) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const j = JSON.parse(body)
      seen.push(j)
      const [status, out] = reply(j)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/roster-query`
  try { return await fn(url, seen) } finally { server.close() }
}
function run(url, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['cli.mjs', ...args], {
      cwd: new URL('.', import.meta.url),
      env: { ...process.env, ROSTER_URL: url, BRELLO_TOKEN: 'brl_test_key', HOME: mkdtempSync(join(tmpdir(), 'brello-')) },
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
const SHOOT = { id: 's1', date: '2026-10-12', time: '10:00', client: 'Foodhall', client_id: 'c1', type: 'Photo', status: 'Confirmed', location: 'Studio', crew: 'Ali, Sara', account: 'Melani Martis', contract_month: "OCT 26'", extended: false, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-02T08:00:00Z', removed_at: null, removed_reason: null }

test('--json prints the raw response with no banner or colour, and every filter reaches the server', async () => {
  await withGateway((j) => [200, { ok: true, scope: 'all shoots', filter: 'f', count: 1, data: [SHOOT], notice: 'Your key expires in 3 days' }], async (url, seen) => {
    const r = await run(url, 'shoots', '--from', '2026-10-01', '--to=2026-10-31', '--client', 'Foodhall', '--type', 'Photo', '--status', 'Confirmed', '--include-removed', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.doesNotMatch(r.stdout + r.stderr, ANSI)
    const out = JSON.parse(r.stdout)
    assert.deepEqual(out.data, [SHOOT])
    assert.equal(out.notice, 'Your key expires in 3 days')
    assert.equal(seen[0].query, 'shoots')
    assert.deepEqual(seen[0].params, { from: '2026-10-01', to: '2026-10-31', client: 'Foodhall', type: 'Photo', status: 'Confirmed', include_removed: true })
    const m = await run(url, '--json', 'meetings', '--from', '2026-10-01', '--to', '2026-10-31', '--owner', 'Melani', '--client', 'Foodhall', '--board')
    assert.equal(m.code, 0, m.stderr)
    assert.deepEqual(seen[1], { token: 'brl_test_key', query: 'meetings', params: { scope: 'board', from: '2026-10-01', to: '2026-10-31', client: 'Foodhall', owner: 'Melani' } })
    await run(url, 'cards', 'Sprint', '--history', '--client', 'Foodhall', '--json')
    assert.deepEqual(seen[2].params, { stage: 'Sprint', history: true, client: 'Foodhall' })
    await run(url, 'stage-stats', '--department', 'Video Edit', '--client', 'Foodhall', '--json')
    assert.deepEqual(seen[3], { token: 'brl_test_key', query: 'stage_stats', params: { department: 'Video Edit', client: 'Foodhall' } })
    const w = await run(url, 'comment', '1c11685c', 'final cut is up', '--json')
    assert.equal(w.code, 0, w.stderr)
    assert.equal(JSON.parse(w.stdout).ok, true)
    assert.deepEqual(seen[4].params, { card: '1c11685c', body: 'final cut is up' })
  })
})

test('--json errors are JSON with exit code 1; one date alone is refused before any request', async () => {
  await withGateway(() => [403, { error: 'that department is out of your scope' }], async (url, seen) => {
    const r = await run(url, 'meetings', '--json')
    assert.equal(r.code, 1)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, false)
    assert.equal(out.status, 403)
    assert.match(out.error, /out of your scope/)
    const half = await run(url, 'shoots', '--from', '2026-10-01')
    assert.equal(half.code, 1)
    assert.match(half.stderr, /Give both dates/)
    assert.equal(seen.length, 1)
  })
})

test('local commands answer --json without a gateway', async () => {
  const r = await run('http://127.0.0.1:1', 'changelog', '--json')
  assert.equal(JSON.parse(r.stdout).installed, VERSION)
  assert.equal(JSON.parse((await run('http://127.0.0.1:1', 'whoami', '--json')).stdout).key_set, true)
  assert.equal(JSON.parse((await run('http://127.0.0.1:1', 'docs', '--json')).stdout).docs, DOCS_URL)
  const help = JSON.parse((await run('http://127.0.0.1:1', '--json')).stdout)
  assert.ok(help.groups.flatMap((g) => g.commands).some((c) => c.command === 'meetings'))
  assert.equal(JSON.parse((await run('http://127.0.0.1:1', 'help', 'meetings', '--json')).stdout).command, 'meetings')
})

test('human shoots and meetings tables keep the key columns and flatten nested fields', async () => {
  const meeting = { id: 'm1', client: 'Foodhall', title: 'Monthly review', start: '2026-10-12T10:00:00+03:00', end: '2026-10-12T11:00:00+03:00', owner: 'Melani Martis', attendees: [{ name: 'Client Contact', internal: false }], online: true, minutes_status: 'draft', minutes_by: 'Melani Martis', gemini_notes_url: null }
  await withGateway((j) => [200, { ok: true, count: 1, data: j.query === 'shoots' ? [SHOOT] : [meeting] }], async (url) => {
    const s = await run(url, 'shoots')
    assert.equal(s.code, 0, s.stderr)
    assert.match(s.stdout, /ACCOUNT/)
    assert.match(s.stdout, /Melani Martis/)
    assert.doesNotMatch(s.stdout, /CLIENT ID|\[object Object\]/)
    const m = await run(url, 'meetings')
    assert.match(m.stdout, /MINUTES/)
    assert.match(m.stdout, /Client Contact/)
    assert.match(m.stdout, /2026-10-12 10:00/)
  })
})

test('MCP exposes the new reads and forwards their filters', async () => {
  await withGateway((j) => [200, { ok: true, count: 0, data: [] }], async (url, seen) => {
    const client = new Client({ name: 'reads-test', version: '1.0.0' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('./mcp.mjs', import.meta.url).pathname], env: { ...process.env, ROSTER_URL: url, BRELLO_TOKEN: 'brl_test_key' } })
    try {
      await client.connect(transport)
      const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]))
      for (const k of ['from', 'to', 'client', 'owner', 'scope']) assert.ok(tools.roster_meetings.inputSchema.properties[k], `roster_meetings.${k}`)
      for (const k of ['from', 'to', 'client', 'type', 'status', 'include_removed']) assert.ok(tools.roster_shoots.inputSchema.properties[k], `roster_shoots.${k}`)
      assert.ok(tools.roster_cards.inputSchema.properties.history)
      assert.ok(tools.roster_stage_stats.inputSchema.properties.department)
      assert.match(tools.roster_meetings.description, /does not store Gemini notes/)
      await client.callTool({ name: 'roster_meetings', arguments: { from: '2026-10-01', to: '2026-10-31', owner: 'Melani' } })
      await client.callTool({ name: 'roster_shoots', arguments: { from: '2026-10-01', to: '2026-10-31', include_removed: true } })
      await client.callTool({ name: 'roster_cards', arguments: { stage: 'Sprint', history: true } })
      await client.callTool({ name: 'roster_stage_stats', arguments: { client: 'Foodhall' } })
      assert.deepEqual(seen.map((s) => [s.query, s.params]), [
        ['meetings', { from: '2026-10-01', to: '2026-10-31', owner: 'Melani' }],
        ['shoots', { from: '2026-10-01', to: '2026-10-31', include_removed: true }],
        ['cards', { stage: 'Sprint', history: true }],
        ['stage_stats', { client: 'Foodhall' }],
      ])
    } finally { await client.close() }
  })
})

test('new copy has no em or en dashes', () => {
  assert.doesNotMatch(JSON.stringify(CHANGELOG[0]), /[–—]/)
  const q = readFileSync(new URL('./QUERIES.md', import.meta.url), 'utf8')
  assert.doesNotMatch(q.slice(q.indexOf('## Shoots'), q.indexOf('## Card fields')), /[–—]/)
  const mcp = readFileSync(new URL('./mcp.mjs', import.meta.url), 'utf8')
  for (const tool of ['roster_meetings', 'roster_shoots', 'roster_stage_stats']) {
    const line = mcp.slice(mcp.indexOf(`server.tool('${tool}'`), mcp.indexOf('\n', mcp.indexOf(`server.tool('${tool}'`)))
    assert.doesNotMatch(line, /[–—]/, tool)
  }
})

test('clients: name filter and --all reach the server; the table shows handle, open cards and logo yes/no', async () => {
  const rows = [
    { id: 'c1', name: 'Foodhall', logo_url: 'https://cdn.test/fh.jpg', instagram_handle: 'foodhall', industry: 'fnb', is_active: true, accounts: ['Melani Martis'], open_cards: 4 },
    { id: 'c2', name: 'Fashion House', logo_url: null, instagram_handle: null, industry: null, is_active: true, accounts: [], open_cards: 0 },
  ]
  await withGateway(() => [200, { ok: true, count: 2, data: rows }], async (url, seen) => {
    const t = await run(url, 'clients', 'foo', 'hall', '--all')
    assert.equal(t.code, 0, t.stderr)
    assert.deepEqual(seen[0].params, { q: 'foo hall', active: false })
    assert.match(t.stdout, /HANDLE/)
    assert.match(t.stdout, /@foodhall/)
    assert.match(t.stdout, /OPEN CARDS/)
    assert.match(t.stdout, /yes/)
    assert.doesNotMatch(t.stdout, /cdn\.test/, 'the table leaves URLs to --json')
    const j = await run(url, 'clients', '--json')
    assert.deepEqual(JSON.parse(j.stdout).data, rows)
    assert.deepEqual(seen[1].params, {})
    const client = new Client({ name: 'clients-test', version: '1.0.0' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('./mcp.mjs', import.meta.url).pathname], env: { ...process.env, ROSTER_URL: url, BRELLO_TOKEN: 'brl_test_key' } })
    try {
      await client.connect(transport)
      await client.callTool({ name: 'roster_clients', arguments: { q: 'food', active: false, scope: 'board' } })
      assert.deepEqual(seen[2].params, { q: 'food', active: false, scope: 'board' })
    } finally { await client.close() }
  })
})

// ── new-version notice ──
import { isNewer, refreshLatest, versionNotice, updateLine, REGISTRY_URL, DAY_MS } from './lib/update-check.mjs'

test('version notice: compares releases, reads the day cache, refreshes with a stubbed fetch', async () => {
  assert.equal(isNewer('1.12.0', '1.11.0'), true)
  assert.equal(isNewer('1.11.0', '1.11.0'), false)
  assert.equal(isNewer('1.10.9', '1.11.0'), false)
  assert.equal(isNewer('2.0.0', '1.99.99'), true)
  assert.equal(isNewer('garbage', '1.0.0'), false)
  const file = join(mkdtempSync(join(tmpdir(), 'brello-vc-')), '.version-check')
  const now = Date.UTC(2026, 9, 10)
  assert.deepEqual(versionNotice({ current: '1.11.0', file, now }), { line: null, stale: true }, 'no cache: nothing to print, a refresh is due')
  const calls = []
  const fetchOk = async (url, init) => { calls.push([url, !!init.signal]); return { ok: true, json: async () => ({ version: '1.12.0' }) } }
  assert.equal(await refreshLatest({ fetchImpl: fetchOk, file, now }), '1.12.0')
  assert.deepEqual(calls, [[REGISTRY_URL, true]])
  assert.deepEqual(versionNotice({ current: '1.11.0', file, now: now + 1000 }), { line: updateLine('1.12.0'), stale: false })
  assert.equal(updateLine('1.12.0'), 'brello 1.12.0 is out, update with: npm i -g brello')
  assert.equal(versionNotice({ current: '1.12.0', file, now }).line, null, 'up to date: silent')
  assert.equal(versionNotice({ current: '1.11.0', file, now: now + DAY_MS }).stale, true, 'checked at most once a day')
  // errors and timeouts are silent and still recorded, so tomorrow retries
  assert.equal(await refreshLatest({ fetchImpl: async () => { throw new Error('offline') }, file, now }), null)
  assert.deepEqual(versionNotice({ current: '1.11.0', file, now }), { line: null, stale: false })
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const t0 = Date.now()
  assert.equal(await refreshLatest({ fetchImpl: hang, file, now, timeoutMs: 50 }), null)
  assert.ok(Date.now() - t0 < 1000, 'the timeout aborts the request')
  assert.equal(await refreshLatest({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }), file: '/dev/null/nope/.version-check', now }), null, 'an unwritable cache is silent')
})

test('version notice: real terminals only, never with --json, never in the MCP server', () => {
  const cliSrc = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8')
  assert.match(cliSrc, /const TTY = process\.stdout\.isTTY && !JSON_OUT/)
  assert.match(cliSrc, /if \(TTY && !process\.env\.BRELLO_NO_UPDATE_CHECK\) \{\s*try \{\s*const \{ versionNotice, refreshInBackground \} = await import\('\.\/lib\/update-check\.mjs'\)/)
  assert.ok(cliSrc.indexOf("import('./lib/banner.mjs')") < cliSrc.indexOf("import('./lib/update-check.mjs')"), 'printed after the banner')
  assert.doesNotMatch(readFileSync(new URL('./mcp.mjs', import.meta.url), 'utf8'), /update-check/)
  assert.doesNotMatch(readFileSync(new URL('./lib/client.mjs', import.meta.url), 'utf8'), /update-check/)
})
