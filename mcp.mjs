#!/usr/bin/env node
// Roster MCP server (stdio) — uses your ROSTER_TOKEN.
// Gives Claude direct tools to query Roster instead of hand-written SQL.
// Register in Claude Code / claude_desktop_config.json (see README).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { callRoster } from './lib/client.mjs'

const server = new McpServer({ name: 'roster-brello', version: '1.0.0' })

const asText = (r) => ({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] })
const wrap = (query, mapParams = () => ({})) => async (args) => {
  try { return asText(await callRoster(query, mapParams(args || {}))) }
  catch (e) { return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true } }
}

server.tool('roster_stats', 'Team dashboard: team size, open/done/overdue cards, and how many are tracking now', {}, wrap('stats'))
server.tool('roster_team', 'List your team members', {}, wrap('team'))
server.tool('roster_comments', 'Recent comments on your team’s cards', {}, wrap('comments'))
server.tool('roster_overdue', 'Overdue cards for your team (past due, not done)', {}, wrap('overdue'))
server.tool('roster_workload', 'Open + overdue card counts per person (who is overloaded)', {}, wrap('workload'))
server.tool('roster_active', 'Who is actively tracking time right now (live Hubstaff timers)', {}, wrap('active'))
server.tool('roster_leaves', 'Upcoming time off for your team (Vacation Tracker)', {}, wrap('leaves'))
server.tool('roster_reactions', 'Recent emoji reactions on your team’s cards', {}, wrap('reactions'))
server.tool('roster_activity', 'Recent activity on your team’s cards — moves (stage→stage), comments, assignments, splits, edits', {}, wrap('activity'))
server.tool('roster_search', 'Search cards by title or client name', { q: z.string().describe('text to search for') }, wrap('search', a => ({ q: a.q })))
server.tool('roster_card', 'Full card detail — description, stage, subtasks, split task, collaborators, linked cards', { id: z.string().describe('card id or its first 8 characters') }, wrap('card', a => ({ id: a.id })))
server.tool('roster_stages', 'Board stages (lists) with your team’s open card count in each', {}, wrap('stages'))
server.tool('roster_departments', 'The roster’s departments and headcount', {}, wrap('departments'))
server.tool('roster_shoots', 'The whole shoot schedule — recent + upcoming, company-wide (date, client, type, crew)', {}, wrap('shoots'))
server.tool('roster_ps_issues', 'Open Product Support issues (admin only)', {}, wrap('ps_issues'))
server.tool('roster_audit', 'Access log: who queried what and when (admin only)', {}, wrap('audit'))

await server.connect(new StdioServerTransport())
console.error('[roster-mcp] ready')
