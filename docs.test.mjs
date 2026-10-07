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
  for (const copy of ['brello help keys', '24 hours', '10 minutes', '60 requests/minute', '3,000/rolling day', '30 days', 'revokes the old key', 'logout only removes', 'Archive is unavailable']) assert.ok(help.includes(copy), copy)
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
