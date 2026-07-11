#!/usr/bin/env node
// Roster MCP server (stdio) — uses your ROSTER_TOKEN.
// Gives Claude direct tools to query Roster instead of hand-written SQL.
// Register in Claude Code / claude_desktop_config.json (see README).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { callRoster } from './lib/client.mjs'
import { CHANGELOG, VERSION } from './lib/changelog.mjs'

const server = new McpServer({ name: 'roster-brello', version: VERSION })

const asText = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] })
const wrap = (query, mapParams = () => ({})) => async (args) => {
  try { return asText(await callRoster(query, mapParams(args || {}))) }
  catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } }
}

server.tool('roster_stats', 'Dashboard totals: open/done/overdue cards and who is tracking now. Default scope "team" = your team\'s cards (reports team_size) — pass scope "board" for whole-board totals (reports people_with_cards + unassigned_cards instead).', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('stats', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_team', 'Company-wide directory of ALL active team members (names, departments, roles) — NOT card-scoped, so its count is bigger than your team. Card tools default to your team; the response\'s your_team/your_team_size fields say who that is.', {}, wrap('team'))
server.tool('roster_comments', 'Recent comments on your team’s cards (team scope only)', {}, wrap('comments'))
server.tool('roster_overdue', 'Overdue cards (past due, not done). Default scope "team" = your team\'s cards only — pass scope "board" for every overdue card on the board.', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('overdue', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_workload', 'Open + overdue card counts per person. Default scope "team" = your team only — pass scope "board" for everyone on the board (includes an Unassigned row).', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('workload', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_active', 'Who is actively tracking time right now (live Hubstaff timers)', {}, wrap('active'))
server.tool('roster_leaves', 'Upcoming time off for your team (Vacation Tracker)', {}, wrap('leaves'))
server.tool('roster_reactions', 'Recent emoji reactions on your team’s cards', {}, wrap('reactions'))
server.tool('roster_activity', 'Recent activity on your team’s cards — moves (stage→stage), comments, assignments, splits, edits', {}, wrap('activity'))
server.tool('roster_search', 'Search cards by title or client name. Default scope "team" searches ONLY cards assigned to your team — pass scope "board" to search the entire board.', { q: z.string().describe('text to search for'), scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('search', a => ({ q: a.q, ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_user_cards', 'Everything for one person — their whole card history (live AND archived) plus a dossier: role, department, open/done/archived totals, and what they are tracking right now', { who: z.string().describe('a person\'s name (full or partial)') }, wrap('user', a => ({ who: a.who })))
server.tool('roster_card', 'Full card detail — description, stage, subtasks, split task, collaborators, linked cards, PLUS: stage_history[] (every stage the card passed through, with enter/exit times, dwell hours and who moved it), time_in_stage_hours/age (how long it has sat in its current stage; dwell_basis "created_at" = a floor, history starts 2026-06-06), reopen_count, backward_moves, and effort (actual_hours + effort_by_person parsed from time-tracking records)', { id: z.string().describe('card id or its first 8 characters') }, wrap('card', a => ({ id: a.id })))
server.tool('roster_stages', 'Board stages (lists) with open card counts. Default scope "team" counts ONLY cards assigned to your team — pass scope "board" for true board totals.', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('stages', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_cards', 'List EVERY card matching the filters — the stage/board enumerator. Filters: stage (list name), assignee (name, or "none" for unassigned), client, done. Default scope "team" = only your team\'s cards; scope "board" = the whole board including unassigned. Every row carries stage_entered_at + time_in_stage_hours + age (how long it has sat in its current stage — sort by this to find what\'s rotting; dwell_basis "created_at" marks floors). Every response carries a "filter" field stating exactly what was counted.', {
  stage: z.string().optional().describe('list name, e.g. "Ready for Sprint" (case-insensitive)'),
  assignee: z.string().optional().describe('person name, or "none"/"unassigned" for cards with no assignee'),
  client: z.string().optional().describe('client name (partial OK)'),
  done: z.boolean().optional().describe('true = completed only, false = open only, omit = both'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards"),
}, wrap('cards', a => ({ ...(a.stage ? { stage: a.stage } : {}), ...(a.assignee ? { assignee: a.assignee } : {}), ...(a.client ? { client: a.client } : {}), ...(typeof a.done === 'boolean' ? { done: a.done } : {}), ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_stage_cards', 'Every card currently in ONE stage (list) — e.g. roster_stage_cards("Ready for Sprint", scope "board"). Same engine as roster_cards.', {
  stage: z.string().describe('the stage/list name, e.g. "Ready for Sprint"'),
  assignee: z.string().optional().describe('person name, or "none" for unassigned only'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards"),
}, wrap('cards', a => ({ stage: a.stage, ...(a.assignee ? { assignee: a.assignee } : {}), ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_stage_stats', 'Stage usage over the board\'s WHOLE history (since 2026-06-06, all teams): per stage — distinct cards ever entered, median + p90 dwell hours (completed segments), and skip-rate (share of forward moves that jumped past the stage). Aggregates only, no names. Use to judge whether a column is actually used and what "normal" dwell looks like.', {}, wrap('stage_stats'))
server.tool('roster_departments', 'The roster’s departments and headcount', {}, wrap('departments'))
server.tool('roster_shoots', 'The whole shoot schedule — recent + upcoming, company-wide (date, client, type, crew)', {}, wrap('shoots'))
server.tool('roster_markup', 'Markup.io review feed — videos/images submitted for review (name, type, submitted date, open comment-thread count, link). Optional name filter.', { q: z.string().optional().describe('optional filter by item name') }, wrap('markup', a => (a.q ? { q: a.q } : {})))
server.tool('roster_client', 'Everything for one client — every card assigned to your team (live + done), who is on it, with open/done/overdue totals (team scope only)', { client: z.string().describe('client name (partial OK)') }, wrap('client', a => ({ client: a.client })))
server.tool('roster_due', 'Your team\'s cards due soon — the next N days (default 7), soonest first (team scope only)', { days: z.number().optional().describe('days ahead, default 7') }, wrap('due', a => (a.days ? { days: a.days } : {})))
server.tool('roster_done', 'Your team\'s recently completed cards — the last N days (default 14) (team scope only)', { days: z.number().optional().describe('days back, default 14') }, wrap('done', a => (a.days ? { days: a.days } : {})))
server.tool('roster_blocked', 'Your team\'s blocked or stuck cards — explicit blockers, or overdue by 3+ days (team scope only)', {}, wrap('blocked'))
server.tool('roster_recent', 'Recently touched cards across your team (default 20)', { n: z.number().optional().describe('how many, default 20') }, wrap('recent', a => (a.n ? { n: a.n } : {})))
server.tool('roster_now', 'Live pulse — who is tracking now, what is due today, and the latest card moves', {}, wrap('now'))
server.tool('roster_changelog', `Brello release history — what changed in every version of this CLI/MCP (installed: v${VERSION}). Answers "what's new?" without a network call.`, {}, async () => asText({ ok: true, installed: VERSION, releases: CHANGELOG }))
server.tool('roster_ps_issues', 'Open Product Support issues (admin only)', {}, wrap('ps_issues'))
server.tool('roster_audit', 'Access log: who queried what and when (admin only)', {}, wrap('audit'))

await server.connect(new StdioServerTransport())
console.error('[roster-mcp] ready')
