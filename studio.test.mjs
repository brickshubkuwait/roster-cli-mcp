// brello studio <command> and the studio_* MCP tools, against local stand-ins for
// Bricks Studio (STUDIO_URL) and roster-query (ROSTER_URL). No key, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { VERSION, CHANGELOG } from './lib/changelog.mjs'
import { parseStudioArgs, classifyFiles } from './lib/studio.mjs'

const KEY = 'brl_test_key_0123456789abcdef'
const SUBMISSIONS = { ok: true, count: 1, limit: 50, offset: 0, next_offset: null, data: [{ id: '1c11685c-aaaa', title: 'JUN Reel 1', type: 'VIDEO', status: 'PENDING', internalStatus: 'NONE', client: 'Foodhall', clientId: 'c1', owner: 'Sara', versions: 2, comments: 3, latest: { id: 'v2', number: 2, label: 'v2' }, createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-21T08:00:00.000Z', url: 'https://studio.test/s/1' }] }
const CSV = 'created_at,version,author,type,timecode,seconds,file,comment,resolved\r\n2026-10-21T08:00:00.000Z,v2,Sara,team,0:42,42,,"logo, too small",\r\n'

// A stand-in that answers both Studio (/api/agent/*, /s3/*) and roster-query (POST /roster-query).
async function withServers(studioReply, fn) {
  const studio = []
  const roster = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      if (req.url === '/roster-query') {
        roster.push(JSON.parse(raw.toString()))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, count: 0, data: [] }))
        return
      }
      const u = new URL(req.url, 'http://x')
      const rec = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, raw }
      try { rec.body = JSON.parse(raw.toString()) } catch { rec.body = null }
      studio.push(rec)
      const [status, out, headers = {}] = studioReply(rec)
      const text = typeof out === 'string' ? out : JSON.stringify(out)
      res.writeHead(status, { 'Content-Type': typeof out === 'string' ? 'text/csv; charset=utf-8' : 'application/json', ...headers })
      res.end(text)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { return await fn(base, studio, roster) } finally { server.close() }
}
function env(base) {
  return { ...process.env, STUDIO_URL: base, ROSTER_URL: base + '/roster-query', BRELLO_TOKEN: KEY, HOME: mkdtempSync(join(tmpdir(), 'brello-studio-')), BRELLO_NO_UPDATE_CHECK: '1' }
}
function run(base, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['cli.mjs', ...args], { cwd: new URL('.', import.meta.url), env: env(base) })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
async function withMcp(base, fn) {
  const client = new Client({ name: 'studio-test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./mcp.mjs', import.meta.url).pathname], env: env(base) }))
  try { return await fn(client) } finally { await client.close() }
}

test('studio submissions --json: GET with the bearer key, raw JSON out, no Supabase apikey', async () => {
  await withServers(() => [200, SUBMISSIONS], async (base, studio, roster) => {
    const r = await run(base, 'studio', 'submissions', 'reel', '--client', 'Foodhall', '--status=pending', '--mine', '--limit', '20', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout), SUBMISSIONS)
    assert.equal(studio.length, 1)
    assert.equal(roster.length, 0)
    const req = studio[0]
    assert.equal(req.method, 'GET')
    assert.equal(req.path, '/api/agent/submissions')
    assert.deepEqual(req.query, { q: 'reel', client: 'Foodhall', status: 'PENDING', scope: 'mine', limit: '20' })
    assert.equal(req.headers.authorization, `Bearer ${KEY}`)
    assert.equal(req.headers.apikey, undefined)
    const bare = await run(base, 'studio', 'submissions', '--json')
    assert.equal(bare.code, 0, bare.stderr)
    assert.deepEqual(studio[1].query, {}, 'only defined params are sent')
  })
})

test('studio submissions table and the X-Studio-Notice header', async () => {
  await withServers(() => [200, SUBMISSIONS, { 'X-Studio-Notice': 'Your key expires in 3 days' }], async (base) => {
    const r = await run(base, 'studio', 'submissions')
    assert.equal(r.code, 0, r.stderr)
    for (const s of ['JUN Reel 1', 'Foodhall', 'INTERNAL', '1c11685c']) assert.ok(r.stdout.includes(s), s)
    assert.match(r.stderr, /Notice: Your key expires in 3 days/)
  })
})

test('studio comments --csv prints the CSV body verbatim and nothing else', async () => {
  await withServers(() => [200, CSV, { 'X-Studio-Notice': 'Your key expires in 3 days' }], async (base, studio) => {
    const r = await run(base, 'studio', 'comments', '1c11685c', '--csv', '--version', '2')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stdout, CSV)
    assert.equal(studio[0].path, '/api/agent/submissions/1c11685c/comments')
    assert.deepEqual(studio[0].query, { format: 'csv', version: '2' })
  })
})

test('studio comment POSTs { body, timecode }', async () => {
  await withServers(() => [201, { ok: true, data: { id: 'k1', version: 2, versionLabel: 'v2', timecode: '0:42', body: 'hi' }, url: 'https://studio.test/s/1' }], async (base, studio) => {
    const r = await run(base, 'studio', 'comment', '1c11685c', 'hi', '--at', '0:42')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /team comment added/)
    assert.equal(studio[0].method, 'POST')
    assert.equal(studio[0].path, '/api/agent/submissions/1c11685c/comments')
    assert.match(studio[0].headers['content-type'], /application\/json/)
    assert.deepEqual(studio[0].body, { body: 'hi', timecode: '0:42' })
    await run(base, 'studio', 'comment', '1c11685c', 'two', 'words', '--version', '3', '--file', 'f1', '--json')
    assert.deepEqual(studio[1].body, { body: 'two words', version: 3, fileId: 'f1' })
  })
})

test('studio plan --set PATCHes only the named fields; without --set it reads', async () => {
  await withServers((req) => [200, { ok: true, data: { id: '9f2c41aa', name: 'X', status: 'READY' }, editable: ['name'], url: 'https://studio.test/p/1' }], async (base, studio) => {
    const r = await run(base, 'studio', 'plan', '9f2c41aa', '--set', 'name=X', '--set', 'status=READY', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(studio[0].method, 'PATCH')
    assert.equal(studio[0].path, '/api/agent/plans/9f2c41aa')
    assert.deepEqual(studio[0].body, { name: 'X', status: 'READY' })
    const read = await run(base, 'studio', 'plan', '9f2c41aa')
    assert.equal(read.code, 0, read.stderr)
    assert.equal(studio[1].method, 'GET')
    assert.match(read.stdout, /editable/)
    const bad = await run(base, 'studio', 'plan', '9f2c41aa', '--set', 'budget=10')
    assert.equal(bad.code, 1)
    assert.match(bad.stderr, /shootDate/)
    assert.equal(studio.length, 2, 'a refused --set never reaches Studio')
  })
})

test('brello studio <filter> (old form) still goes to roster-query, not Studio', async () => {
  await withServers(() => [500, { ok: false, error: 'should not be called' }], async (base, studio, roster) => {
    const r = await run(base, 'studio', 'reel', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(studio.length, 0)
    assert.equal(roster.length, 1)
    assert.equal(roster[0].query, 'studio')
    assert.deepEqual(roster[0].params, { q: 'reel' })
    await run(base, 'studio', '--json')
    assert.equal(roster[1].query, 'studio')
    assert.deepEqual(roster[1].params, {})
  })
})

test('other routes: status, clients, items, whoami, submission', async () => {
  await withServers((req) => [200, req.path.endsWith('/whoami') ? { ok: true, user: { name: 'Sara', orgSlug: 'bricks', access: 'full', readOnly: false }, key: { label: 'laptop', studio: ['studio_comment'] } } : { ok: true, count: 0, data: req.path.includes('/submissions/') ? { id: 'x', versions: [{ id: 'v1', number: 1, label: 'v1', files: [{ id: 'f1', fileName: 'a.jpg', preview: 'https://cdn.test/p', download: 'https://cdn.test/d' }] }], url: 'https://studio.test/s/x' } : [] }], async (base, studio) => {
    await run(base, 'studio', 'status', '1c11685c', 'Changes', '--note', 'tighten the intro', '--json')
    assert.deepEqual([studio[0].method, studio[0].path, studio[0].body], ['POST', '/api/agent/submissions/1c11685c/status', { action: 'changes', note: 'tighten the intro' }])
    await run(base, 'studio', 'clients', 'food', '--all', '--json')
    assert.deepEqual([studio[1].path, studio[1].query], ['/api/agent/clients', { q: 'food', all: '1' }])
    await run(base, 'studio', 'items', 'Food Hall', 'chair', '--plans', '--json')
    assert.deepEqual([studio[2].path, studio[2].query], ['/api/agent/clients/Food%20Hall/items', { q: 'chair', includePlans: '1' }])
    const w = await run(base, 'studio', 'whoami')
    assert.equal(w.code, 0, w.stderr)
    assert.match(w.stdout, /studio_comment/)
    const s = await run(base, 'studio', 'submission', 'x1234567')
    assert.equal(s.code, 0, s.stderr)
    assert.match(s.stdout, /download: https:\/\/cdn\.test\/d/)
    assert.match(s.stdout, /https:\/\/studio\.test\/s\/x/)
    const bad = await run(base, 'studio', 'status', '1c11685c', 'ship')
    assert.equal(bad.code, 1)
    assert.equal(studio.length, 5)
  })
})

test('Studio refusals explain themselves', async () => {
  await withServers((req) => req.path.endsWith('/comments')
    ? [403, { ok: false, error: 'This key cannot post team comments.', code: 'capability_required', capability: 'studio_comment' }]
    : [403, { ok: false, error: 'No Studio account is linked', code: 'no_studio_user' }], async (base) => {
    const r = await run(base, 'studio', 'comment', '1c11685c', 'hi', '--json')
    assert.equal(r.code, 1)
    const out = JSON.parse(r.stdout)
    assert.equal(out.code, 'capability_required')
    assert.match(out.error, /Studio: post team comments/)
    assert.match(out.error, /roster\.bricks\.com\.kw\/connect/)
    const n = await run(base, 'studio', 'plans')
    assert.equal(n.code, 1)
    assert.match(n.stderr, /Your key's Slack identity has no Studio account/)
  })
})

test('uploads: images go multipart, videos go presign, PUT, register; a mix is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brello-up-'))
  const jpg = join(dir, 'cover.jpg'), mp4 = join(dir, 'final.mp4')
  writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
  writeFileSync(mp4, Buffer.alloc(1024, 7))
  await withServers((req) => {
    if (req.path.endsWith('/presign')) return [200, { ok: true, uploadUrl: `${req.headers.host ? 'http://' + req.headers.host : ''}/s3/put?sig=1`, key: 'uploads/video-source/1.mp4' }]
    if (req.path === '/s3/put') return [200, { ok: true }]
    return [201, { ok: true, data: { id: 'v3', number: 3, label: 'v3', files: [{}] }, url: 'https://studio.test/s/1' }]
  }, async (base, studio) => {
    const img = await run(base, 'studio', 'upload', '1c11685c', jpg, '--label', 'Option B', '--option-of', 'v2', '--json')
    assert.equal(img.code, 0, img.stderr)
    assert.equal(studio[0].path, '/api/agent/submissions/1c11685c/versions')
    assert.match(studio[0].headers['content-type'], /^multipart\/form-data/)
    const form = studio[0].raw.toString('latin1')
    assert.match(form, /name="files"; filename="cover\.jpg"/)
    assert.match(form, /Content-Type: image\/jpeg/)
    assert.match(form, /name="optionLabel"\r\n\r\nOption B/)
    assert.match(form, /name="parentVersionId"\r\n\r\nv2/)
    const vid = await run(base, 'studio', 'upload', '1c11685c', mp4)
    assert.equal(vid.code, 0, vid.stderr)
    assert.match(vid.stdout, /uploaded v3/)
    assert.deepEqual(studio.slice(1).map(r => [r.method, r.path]), [['POST', '/api/agent/submissions/1c11685c/versions/presign'], ['PUT', '/s3/put'], ['POST', '/api/agent/submissions/1c11685c/versions']])
    assert.deepEqual(studio[1].body, { fileName: 'final.mp4', contentType: 'video/mp4', fileSize: 1024 })
    assert.equal(studio[2].headers['content-type'], 'video/mp4')
    assert.equal(studio[2].raw.length, 1024)
    assert.deepEqual(studio[3].body, { files: [{ key: 'uploads/video-source/1.mp4', fileName: 'final.mp4', mimeType: 'video/mp4', fileSize: 1024 }] })
    const mixed = await run(base, 'studio', 'upload', '1c11685c', jpg, mp4)
    assert.equal(mixed.code, 1)
    assert.match(mixed.stderr, /separate versions/)
    assert.equal(studio.length, 4, 'a mixed upload never reaches Studio')
  })
  assert.throws(() => classifyFiles([join(dir, 'notes.txt')]), /not an image/)
})

test('MCP: studio tools are registered and studio_comment forwards the same body', async () => {
  await withServers(() => [201, { ok: true, data: { id: 'k1' } }, { 'X-Studio-Notice': 'Your key expires in 3 days' }], async (base, studio, roster) => {
    await withMcp(base, async (client) => {
      const tools = Object.fromEntries((await client.listTools()).tools.map(t => [t.name, t]))
      for (const name of ['studio_whoami', 'studio_submissions', 'studio_submission', 'studio_comments', 'studio_comment', 'studio_upload', 'studio_status', 'studio_plans', 'studio_plan', 'studio_plan_edit', 'studio_clients', 'studio_client_items']) {
        assert.ok(tools[name], name)
        assert.match(tools[name].description, /Bricks Studio/, name)
        assert.match(tools[name].description, /Client-facing actions/, name)
      }
      assert.deepEqual(tools.studio_comment.inputSchema.required.sort(), ['id', 'text'])
      assert.deepEqual(tools.studio_status.inputSchema.properties.action.enum, ['approve', 'changes', 'clear'])
      assert.equal(studio.length, 0, 'no network call at startup')
      const res = await client.callTool({ name: 'studio_comment', arguments: { id: '1c11685c', text: 'hi', timecode: '0:42' } })
      assert.equal(res.isError, undefined)
      assert.equal(studio[0].method, 'POST')
      assert.equal(studio[0].path, '/api/agent/submissions/1c11685c/comments')
      assert.equal(studio[0].headers.authorization, `Bearer ${KEY}`)
      assert.deepEqual(studio[0].body, { body: 'hi', timecode: '0:42' })
      assert.match(res.content[0].text, /\nNotice: Your key expires in 3 days$/)
      await client.callTool({ name: 'studio_plan_edit', arguments: { id: '9f2c41aa', name: 'X', status: 'READY' } })
      assert.deepEqual([studio[1].method, studio[1].body], ['PATCH', { name: 'X', status: 'READY' }])
      const empty = await client.callTool({ name: 'studio_plan_edit', arguments: { id: '9f2c41aa' } })
      assert.equal(empty.isError, true)
      await client.callTool({ name: 'studio_submissions', arguments: { client: 'Foodhall', mine: true } })
      assert.deepEqual(studio[2].query, { client: 'Foodhall', scope: 'mine' })
      assert.equal(roster.length, 0)
    })
  })
})

test('argument parsing refuses unknown flags and missing ids before any request', () => {
  assert.match(parseStudioArgs(['submissions', '--board']).error, /does not take --board/)
  assert.match(parseStudioArgs(['comment']).error, /Add the id/)
  assert.match(parseStudioArgs(['comment', '1c11685c']).error, /comment text/)
  assert.match(parseStudioArgs(['plans', '--status', 'DONE']).error, /DRAFT or READY/)
  assert.match(parseStudioArgs(['submissions', '--limit', 'ten']).error, /whole number/)
  assert.deepEqual(parseStudioArgs(['plan', 'abc12345', '--set', 'shoot-date=2026-11-02', '--set=clientBrief=a=b']).body, { shootDate: '2026-11-02', clientBrief: 'a=b' })
})

test('release bookkeeping and copy rules', () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  assert.equal(CHANGELOG[0].version, pkg.version)
  assert.equal(VERSION, pkg.version)
  assert.equal(CHANGELOG[0].version, '1.14.0')
  const banned = /[–—]|read-only|scoped|audited/i
  assert.doesNotMatch(JSON.stringify(CHANGELOG[0]), banned)
  const section = (file, from, to) => { const s = readFileSync(new URL(file, import.meta.url), 'utf8'); const a = s.indexOf(from); assert.ok(a >= 0, `${file} has ${from}`); return s.slice(a, s.indexOf(to, a + 1)) }
  assert.doesNotMatch(section('README.md', '## Studio', '## Limits'), banned)
  const q = section('QUERIES.md', '## Studio', '## Limits & pagination')
  assert.doesNotMatch(q, banned)
  for (const tool of ['studio_submissions', 'studio_comments', 'studio_upload', 'studio_plan_edit', 'studio_client_items']) assert.ok(q.includes(tool), tool)
  const mcp = readFileSync(new URL('./mcp.mjs', import.meta.url), 'utf8')
  const start = mcp.indexOf('// ── Bricks Studio')
  assert.ok(start > 0)
  assert.doesNotMatch(mcp.slice(start, mcp.indexOf('warnIfLegacy()\nawait')), banned)
  assert.doesNotMatch(readFileSync(new URL('./lib/studio.mjs', import.meta.url), 'utf8'), /[–—]|read-only|audited/i)
  const cli = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8')
  const detail = cli.slice(cli.indexOf("  studio:      { sum: 'Bricks Studio"), cli.indexOf("  scope:       { sum:"))
  assert.ok(detail.length > 100)
  assert.doesNotMatch(detail, banned)
})

test('brello help studio lists every Studio command', async () => {
  const r = await run('http://127.0.0.1:1', 'help', 'studio')
  assert.equal(r.code, 0, r.stderr)
  for (const s of ['studio submissions', 'studio submission <id>', 'studio comments <id> [--csv]', 'studio comment <id>', 'studio upload <id>', 'studio status <id>', 'studio plans', 'studio plan <id>', 'studio clients', 'studio items', 'studio whoami', 'Connect page']) assert.ok(r.stdout.includes(s), s)
  const h = await run('http://127.0.0.1:1', 'help')
  assert.match(h.stdout, /\nStudio\n/)
  assert.match(h.stdout, /studio upload <id> <file\.\.\.>/)
})
