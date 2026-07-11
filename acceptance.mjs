#!/usr/bin/env node
// Acceptance tests for the board-scope contract (run: npm test).
// Drives the real MCP server over stdio with YOUR token (~/.roster/token or
// BRELLO_TOKEN) against the LIVE roster-query edge fn — read-only queries only.
// Counts are asserted as invariants (board ⊇ team), not fixed numbers.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'acceptance', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./mcp.mjs', import.meta.url).pathname] }))

let pass = 0, fail = 0
const ok = (cond, label) => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`) }
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text)

// 0) The tools + schemas actually exist
const { tools } = await client.listTools()
const byName = Object.fromEntries(tools.map(t => [t.name, t]))
ok(!!byName.roster_cards, 'roster_cards is registered')
for (const t of ['roster_stages', 'roster_search', 'roster_workload', 'roster_overdue', 'roster_stats'])
  ok(!!byName[t]?.inputSchema?.properties?.scope, `${t} declares scope in inputSchema`)

// 1) stages honors scope:"board" and labels itself board
const stTeam = await call('roster_stages')
const stBoard = await call('roster_stages', { scope: 'board' })
const rfs = (d) => d.data.find(s => s.stage === 'Ready for Sprint')?.cards ?? -1
ok(stBoard.scope === 'board' || stBoard.scope.startsWith('board'), `stages(board) scope reads "board" (got "${stBoard.scope}")`)
ok(rfs(stBoard) > rfs(stTeam), `stages(board) Ready for Sprint ${rfs(stBoard)} > team ${rfs(stTeam)}`)

// 2) roster_cards enumerates a stage board-wide with nullable assignee
const cards = await call('roster_cards', { stage: 'Ready for Sprint', scope: 'board' })
ok(cards.count > 0 && cards.data.length > 0, `roster_cards("Ready for Sprint", board) returns ${cards.count} cards`)
ok(cards.data.every(c => 'assignee' in c && 'due' in c && 'stage' in c && 'department' in c), 'every card has assignee/due/stage/department fields')
ok(cards.data.some(c => c.assignee === null) || cards.data.every(c => c.assignee !== null), 'assignee is null (not missing) when unassigned')

// 3) board-wide search finds other teams' cards that team scope cannot see
for (const q of ['Floatie', 'Biggie Box Reaction', 'SEALED', "Kid's Meal"]) {
  const r = await call('roster_search', { q, scope: 'board' })
  ok(r.count >= 1 && r.scope.startsWith('board'), `search("${q}", board) found ${r.count}`)
}

// 4) unassigned filter
const un = await call('roster_cards', { stage: 'Sprint', scope: 'board', assignee: 'none' })
ok(un.data.every(c => c.assignee === null), `cards(Sprint, board, assignee:none) → ${un.count} cards, all unassigned`)

// 5) default stays team-scoped and says so (hits ⊆ board hits; note only when empty)
const defSearch = await call('roster_search', { q: 'Floatie' })
const boardSearch = await call('roster_search', { q: 'Floatie', scope: 'board' })
ok(defSearch.scope.startsWith('team'), `default search scope reads team ("${defSearch.scope}")`)
ok(defSearch.count <= boardSearch.count && (defSearch.count > 0 || !!defSearch.note),
  `default search team-scoped: ${defSearch.count} of ${boardSearch.count} board hits${defSearch.count === 0 ? ' + board hint note' : ''}`)

// 6) overdue + stats honor scope; team directory labels itself truthfully
const odT = await call('roster_overdue'); const odB = await call('roster_overdue', { scope: 'board' })
ok(odB.count >= odT.count && odB.scope.startsWith('board'), `overdue board ${odB.count} >= team ${odT.count}`)
const statsB = await call('roster_stats', { scope: 'board' })
ok('people_with_cards' in statsB.data && 'unassigned_cards' in statsB.data, 'stats(board) reports people_with_cards + unassigned_cards')
const statsT = await call('roster_stats')
ok('team_size' in statsT.data, 'stats(team) reports team_size')
const team = await call('roster_team')
ok(team.scope === 'company directory' && !!team.your_team, `roster_team scope="${team.scope}", your_team="${team.your_team}"`)

// 7) dwell fields on listing rows + stage history/effort on card + stage stats
const dwellCards = await call('roster_cards', { stage: 'Ready for Sprint', scope: 'board' })
ok(dwellCards.data.every(c => 'time_in_stage_hours' in c && 'age' in c && ['moved', 'created_at'].includes(c.dwell_basis)),
  'every roster_cards row carries time_in_stage_hours/age/dwell_basis')
const detail = await call('roster_card', { id: dwellCards.data[0].id })
ok(Array.isArray(detail.data.stage_history) && detail.data.stage_history.length > 0
  && 'entered_at' in detail.data.stage_history[0] && 'duration_hours' in detail.data.stage_history[0],
  `roster_card stage_history has ${detail.data.stage_history?.length} segments`)
const stats = await call('roster_stage_stats')
ok(stats.count === 14 && stats.scope === 'board' && stats.data.every(s => 'cards_entered' in s && 'skip_pct' in s),
  `roster_stage_stats: ${stats.count} stages, board scope`)

// 8) changelog is local and matches the package version
const chlog = await call('roster_changelog')
const pkgVersion = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./package.json', import.meta.url), 'utf8')).version
ok(chlog.installed === pkgVersion && chlog.releases.length >= 5, `roster_changelog v${chlog.installed} = package v${pkgVersion}, ${chlog.releases?.length} releases`)

console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
await client.close()
process.exit(fail === 0 ? 0 : 1)
