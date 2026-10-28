#!/usr/bin/env node
import { developerGuide } from './lib/docs.mjs'
// Roster MCP server (stdio), uses the key `brello auth` saved.
// Gives Claude direct tools to query Roster instead of hand-written SQL.
// Register:  claude mcp add brello -- brello-mcp   (Claude Desktop: see README).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { callRoster, getToken, isLegacyKey, LEGACY_HINT, describeError, noticeOf, takeNotice } from './lib/client.mjs'
import { callStudio, uploadVersion, PLAN_FIELDS } from './lib/studio.mjs'
import { CHANGELOG, VERSION } from './lib/changelog.mjs'

const server = new McpServer({ name: 'roster-brello', version: VERSION })

const log = (s) => { try { process.stderr.write('[roster-mcp] ' + s + '\n') } catch {} }
process.on('unhandledRejection', (e) => log('unhandled: ' + describeError(e)))

let legacyWarned = false
function warnIfLegacy() {
  if (legacyWarned) return
  const t = getToken()
  if (t && isLegacyKey(t)) { legacyWarned = true; log(LEGACY_HINT) }
}

function asText(r) {
  const notice = noticeOf(r)
  let body = r
  if (notice && r && typeof r === 'object' && !Array.isArray(r)) { const { notice: _n, ...rest } = r; body = rest }
  const text = JSON.stringify(body, null, 2) + (notice ? '\nNotice: ' + notice : '')
  return { content: [{ type: 'text', text }] }
}
const asError = (e) => ({ content: [{ type: 'text', text: 'Error: ' + describeError(e) }], isError: true })
const wrap = (query, mapParams = () => ({})) => async (args) => {
  try { warnIfLegacy(); return asText(await callRoster(query, mapParams(args || {}))) }
  catch (e) { return asError(e) }
}

server.tool('roster_stats', 'Dashboard totals: open/done/overdue cards and who is tracking now. Default scope "team" = your team\'s cards (reports team_size) — pass scope "board" for whole-board totals (reports people_with_cards + unassigned_cards instead).', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('stats', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_team', 'Company-wide directory of ALL active team members (names, departments, roles) — NOT card-scoped, so its count is bigger than your team. Card tools default to your team; the response\'s your_team/your_team_size fields say who that is.', {}, wrap('team'))
server.tool('roster_comments', 'Recent comments on your team’s cards (team scope only)', {}, wrap('comments'))
server.tool('roster_overdue', 'Overdue cards (past due, not done). Default scope "team" = your team\'s cards only — pass scope "board" for every overdue card on the board.', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('overdue', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_workload', 'Open + overdue card counts per person. Default scope "team" = your team only — pass scope "board" for everyone on the board (includes an Unassigned row).', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('workload', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_active', 'Who is actively tracking time right now (live Hubstaff timers)', {}, wrap('active'))
server.tool('roster_reactions', 'Recent emoji reactions on your team’s cards', {}, wrap('reactions'))
server.tool('roster_activity', 'Recent activity on your team’s cards — moves (stage→stage), comments, assignments, splits, edits', {}, wrap('activity'))
server.tool('roster_search', 'Search cards by title or client name. Default scope "team" searches ONLY cards assigned to your team — pass scope "board" to search the entire board.', { q: z.string().describe('text to search for'), scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('search', a => ({ q: a.q, ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_user_cards', 'Everything for one person — their whole card history (live AND archived) plus a dossier: role, department, open/done/archived totals, and what they are tracking right now', { who: z.string().describe('a person\'s name (full or partial)') }, wrap('user', a => ({ who: a.who })))
server.tool('roster_card', 'Full card detail — brief, stage, people, subtasks, linked cards, stage history, tracked effort, Salesforce opportunity/invoice, Bricks Studio submissions, client send/view receipt, Slack thread, deliverable sizes, approved EN/AR copy, and request outcome.', { id: z.string().describe('card id or its first 8 characters') }, wrap('card', a => ({ id: a.id })))
server.tool('roster_stages', 'Board stages (lists) with open card counts. Default scope "team" counts ONLY cards assigned to your team — pass scope "board" for true board totals.', { scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards") }, wrap('stages', a => (a.scope ? { scope: a.scope } : {})))
server.tool('roster_cards', 'List EVERY card matching the filters — the stage/board enumerator. Filters: stage (list name), assignee (name, or "none" for unassigned), client, done. Default scope "team" = only your team\'s cards; scope "board" = the whole board including unassigned. Every row carries stage_entered_at + time_in_stage_hours + age (how long it has sat in its current stage — sort by this to find what\'s rotting; dwell_basis "created_at" marks floors). Every response carries a "filter" field stating exactly what was counted. Pages of 200 by default (limit up to 1000); count is the full total and next_offset is set while more remain, so page with offset until next_offset is null.', {
  stage: z.string().optional().describe('list name, e.g. "Ready for Sprint" (case-insensitive)'),
  assignee: z.string().optional().describe('person name, or "none"/"unassigned" for cards with no assignee'),
  client: z.string().optional().describe('client name (partial OK)'),
  done: z.boolean().optional().describe('true = completed only, false = open only, omit = both'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards"),
  history: z.boolean().optional().describe('true adds history: [{stage, entered_at, exited_at}] per card, oldest first (exited_at null = still there)'),
  created_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD: only cards created on or after this Kuwait day, e.g. to pull just new cards'),
  created_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD: only cards created on or before this Kuwait day'),
  limit: z.number().int().min(1).max(1000).optional().describe('cards per page, default 200, max 1000'),
  offset: z.number().int().min(0).optional().describe('skip this many cards; the response carries next_offset while more remain'),
}, wrap('cards', a => ({ ...(a.stage ? { stage: a.stage } : {}), ...(a.assignee ? { assignee: a.assignee } : {}), ...(a.client ? { client: a.client } : {}), ...(typeof a.done === 'boolean' ? { done: a.done } : {}), ...(a.scope ? { scope: a.scope } : {}), ...(a.history ? { history: true } : {}), ...(a.created_after ? { created_after: a.created_after } : {}), ...(a.created_before ? { created_before: a.created_before } : {}), ...(a.limit ? { limit: a.limit } : {}), ...(typeof a.offset === 'number' ? { offset: a.offset } : {}) })))
server.tool('roster_stage_cards', 'Every card currently in ONE stage (list) — e.g. roster_stage_cards("Ready for Sprint", scope "board"). Same engine as roster_cards.', {
  stage: z.string().describe('the stage/list name, e.g. "Ready for Sprint"'),
  assignee: z.string().optional().describe('person name, or "none" for unassigned only'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = only cards assigned to your team; 'board' = the entire board, all teams + unassigned cards"),
}, wrap('cards', a => ({ stage: a.stage, ...(a.assignee ? { assignee: a.assignee } : {}), ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_stage_stats', 'Stage usage over the board\'s WHOLE history (since 2026-06-06, all teams): per stage, distinct cards ever entered, median + p90 dwell hours (completed segments), and skip rate (share of forward moves that jumped past the stage). Aggregates only, no names. Optional department and client narrow it to matching cards. Use to judge whether a column is actually used and what "normal" dwell looks like.', {
  department: z.string().optional().describe('department, e.g. "Video Edit"; a family name such as "Design" covers its departments'),
  client: z.string().optional().describe('client name (partial OK)'),
}, wrap('stage_stats', a => ({ ...(a.department ? { department: a.department } : {}), ...(a.client ? { client: a.client } : {}) })))
server.tool('roster_departments', 'The roster’s departments and headcount', {}, wrap('departments'))
server.tool('roster_shoots', 'The company-wide shoot schedule. Without dates: the last 7 days onward (first 120). With from + to (YYYY-MM-DD, both required): that range (up to 1000 rows). Each shoot: id, date, time, client, client_id, type, status, location, crew, account (the account owner, not in crew), contract_month, extended (Extended Session), code, session ("2 of 4"), scope, outputs [{product, quantity}], models (how many models the shoot needs) and models_arranged, prep {props, casting, wardrobe, setup, permit}, drone_pilot, production_assistant, end_time, reel_start_time, reel_duration, completed, completed_at, feedback_session, jida_project_id, created_at, updated_at, removed_at, removed_reason, readiness (what is still missing) and checklist. Removed shoots are left out unless include_removed is true.', {
  from: z.string().optional().describe('start date YYYY-MM-DD (needs to)'),
  to: z.string().optional().describe('end date YYYY-MM-DD, inclusive (needs from)'),
  client: z.string().optional().describe('client name, case-insensitive partial'),
  type: z.string().optional().describe('shoot type, case-insensitive exact'),
  status: z.string().optional().describe('status, e.g. Confirmed, Pending, Canceled'),
  include_removed: z.boolean().optional().describe('true also returns removed shoots, with removed_at and removed_reason'),
}, wrap('shoots', a => ({ ...(a.from ? { from: a.from } : {}), ...(a.to ? { to: a.to } : {}), ...(a.client ? { client: a.client } : {}), ...(a.type ? { type: a.type } : {}), ...(a.status ? { status: a.status } : {}), ...(a.include_removed ? { include_removed: true } : {}) })))
server.tool('roster_clients', 'Client directory for dashboards: id, name, logo_url (Instagram avatar, null when absent), instagram_handle, industry, is_active, accounts (account people), open_cards (open cards in your card scope; scope "board" counts the whole board). Active clients only unless active is false. Card tools that return a client name also return client_logo_url and instagram_handle; roster_team and roster_user_cards return avatar_url.', {
  q: z.string().optional().describe('part of a client name'),
  active: z.boolean().optional().describe('true (default) = active clients only; false = every client'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = open_cards counts your team's cards; 'board' = the whole board"),
}, wrap('clients', a => ({ ...(a.q ? { q: a.q } : {}), ...(typeof a.active === 'boolean' ? { active: a.active } : {}), ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_meetings', 'Meetings from the Roster calendar. Without dates: 7 days back to 60 days ahead (Kuwait days). Each meeting: id, client, title, kind, status, start, end (Kuwait time, ISO), owner (organiser), attendees [{name, email, internal, response}], online, location_mode, minutes_status (none = no minutes, draft = written but not submitted, submitted = pushed to the calendar event), minutes_submitted_at, minutes_by, gemini_notes_url (the calendar event link, where Gemini notes attach; the Roster does not store Gemini notes). Default scope "team" = meetings your team organises or attends; scope "board" = every meeting.', {
  from: z.string().optional().describe('start date YYYY-MM-DD (needs to)'),
  to: z.string().optional().describe('end date YYYY-MM-DD, inclusive (needs from)'),
  client: z.string().optional().describe('client name (partial OK)'),
  owner: z.string().optional().describe('organiser name (partial OK)'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = meetings your team organises or attends; 'board' = every meeting"),
}, wrap('meetings', a => ({ ...(a.from ? { from: a.from } : {}), ...(a.to ? { to: a.to } : {}), ...(a.client ? { client: a.client } : {}), ...(a.owner ? { owner: a.owner } : {}), ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_readiness', 'Shoot readiness: every shoot in the next N days (default 7, up to 31) and what is still missing (plan, budget, models, props, call time). A 9:00 AM start is missing until someone confirms it. Company-wide, like roster_shoots.', { days: z.number().optional().describe('days ahead, default 7') }, wrap('readiness', a => (a.days ? { days: a.days } : {})))
server.tool('roster_studio', 'Bricks Studio review feed — linked submissions with card/client, status, version, comments, client-view receipt, and open/share links. Optional text filter and team/board scope.', {
  q: z.string().optional().describe('optional filter by submission, card, or client name'),
  scope: z.enum(['team', 'board']).optional().describe("'team' (default) = your team’s cards; 'board' = the whole board"),
}, wrap('studio', a => ({ ...(a.q ? { q: a.q } : {}), ...(a.scope ? { scope: a.scope } : {}) })))
server.tool('roster_client', 'Everything for one client — every card assigned to your team (live + done), who is on it, with open/done/overdue totals (team scope only)', { client: z.string().describe('client name (partial OK)') }, wrap('client', a => ({ client: a.client })))
server.tool('roster_scope', 'One client in one month: what the contract sold (Salesforce quote) vs what was shot, delivered to the client and approved in Studio, one entry per contract live in that month, plus special requests. Null means unknown and every null has a line in notes. No money is returned.', {
  client: z.string().describe('client name (partial OK)'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('YYYY-MM, default this month'),
}, wrap('scope', a => ({ client: a.client, ...(a.month ? { month: a.month } : {}) })))
server.tool('roster_due', 'Your team\'s cards due soon — the next N days (default 7), soonest first (team scope only)', { days: z.number().optional().describe('days ahead, default 7') }, wrap('due', a => (a.days ? { days: a.days } : {})))
server.tool('roster_done', 'Your team\'s recently completed cards — the last N days (default 14) (team scope only)', { days: z.number().optional().describe('days back, default 14') }, wrap('done', a => (a.days ? { days: a.days } : {})))
server.tool('roster_blocked', 'Your team\'s blocked or stuck cards — explicit blockers, or overdue by 3+ days (team scope only)', {}, wrap('blocked'))
server.tool('roster_recent', 'Recently touched cards across your team (default 20)', { n: z.number().optional().describe('how many, default 20') }, wrap('recent', a => (a.n ? { n: a.n } : {})))
server.tool('roster_now', 'Live pulse — who is tracking now, what is due today, and the latest card moves', {}, wrap('now'))
server.tool('roster_docs', 'Developer hub links and current key setup, permissions, limits and recovery guidance. Local help, no API request.', {}, async () => asText(developerGuide()))
server.tool('roster_changelog', `Brello release history — what changed in every version of this CLI/MCP (installed: v${VERSION}). Answers "what's new?" without a network call.`, {}, async () => asText({ ok: true, installed: VERSION, releases: CHANGELOG }))
server.tool('roster_ps_issues', 'Open Product Support issues (admin only)', {}, wrap('ps_issues'))
server.tool('roster_audit', 'Access log: who queried what and when (admin only)', {}, wrap('audit'))

// ── create tool — mint a brand-new card on the board. Only `name` is required;
// it lands in the board's first list unless you name one. Assignee, due date,
// client tag, department, priority and description are all optional. Use this
// when someone says "make a task/card for X" — e.g. "task for Abrar to make the
// Spirit Felice Bahrain artwork, due tomorrow".
server.tool('roster_create', 'Create a NEW card on the board (task). Only "name" is required; the card lands in the board\'s first list unless you pass "list". Optionally assign it, set a due date (YYYY-MM-DD), tag a client, set the department or priority, and add a description. Use this whenever someone asks to make/add a new task or card for a person.', {
  name: z.string().describe('the card title, e.g. "Spirit Felice Bahrain artwork"'),
  list: z.string().optional().describe('the stage/list to create it in — defaults to the board\'s first list'),
  assignee: z.string().optional().describe('who to assign it to — a member name or Uxxxx slack id'),
  due: z.string().optional().describe('due date "YYYY-MM-DD"'),
  client: z.string().optional().describe('client tag to attach (must already exist on the board)'),
  department: z.string().optional().describe('department chip, e.g. "Design", "Video Edit", "Creative"'),
  priority: z.enum(['top', 'high', 'medium', 'low']).optional().describe('priority level'),
  description: z.string().optional().describe('the card description / brief'),
}, wrap('create', a => ({
  name: a.name,
  ...(a.list ? { list: a.list } : {}),
  ...(a.assignee ? { assignee: a.assignee } : {}),
  ...(a.due ? { due: a.due } : {}),
  ...(a.client ? { client: a.client } : {}),
  ...(a.department ? { department: a.department } : {}),
  ...(a.priority ? { priority: a.priority } : {}),
  ...(a.description ? { description: a.description } : {}),
})))

// ── write tools — act on a single card. `card` is a card id OR an exact, unique
// card name; when a name is ambiguous the server returns an error asking for the id.
server.tool('roster_comment', 'Add a comment to a card', { card: z.string().describe('card id or exact card name'), body: z.string().describe('the comment text') }, wrap('comment', a => ({ card: a.card, body: a.body })))
server.tool('roster_move', 'Move a card to a list', { card: z.string().describe('card id or exact card name'), to: z.string().describe('destination list name or id'), reason: z.string().optional().describe('why, recorded on the card; required when a missed due date moves later (REASON_REQUIRED)') }, wrap('move', a => ({ card: a.card, to: a.to, ...(a.reason ? { reason: a.reason } : {}) })))
server.tool('roster_set_due', 'Set or clear a card’s due date', { card: z.string().describe('card id or exact card name'), due: z.string().nullable().optional().describe('due date "YYYY-MM-DD" — pass null or "" to clear it'), reason: z.string().optional().describe('why, recorded on the card; required when a missed due date moves later (REASON_REQUIRED)') }, wrap('set_due', a => ({ card: a.card, due: a.due ?? null, ...(a.reason ? { reason: a.reason } : {}) })))
server.tool('roster_mark_done', 'Mark a card done, or reopen it', { card: z.string().describe('card id or exact card name'), done: z.boolean().optional().describe('true (default) marks done; false reopens it') }, wrap('mark_done', a => ({ card: a.card, ...(typeof a.done === 'boolean' ? { done: a.done } : {}) })))
server.tool('roster_set_priority', 'Set or clear a card’s priority', { card: z.string().describe('card id or exact card name'), priority: z.enum(['top', 'high', 'medium', 'low', '']).describe('priority level — pass "" to clear it') }, wrap('set_priority', a => ({ card: a.card, priority: a.priority })))
server.tool('roster_assign', 'Assign a card to someone, or unassign it', { card: z.string().describe('card id or exact card name'), to: z.string().describe('member name or Uxxxx slack id — pass "" to unassign'), reason: z.string().optional().describe('why, recorded on the card; required when a missed due date moves later (REASON_REQUIRED)') }, wrap('assign', a => ({ card: a.card, to: a.to, ...(a.reason ? { reason: a.reason } : {}) })))
server.tool('roster_rename', 'Rename a card', { card: z.string().describe('card id or exact card name'), name: z.string().describe('the new card title') }, wrap('rename', a => ({ card: a.card, name: a.name })))
server.tool('roster_describe', 'Set a card’s description', { card: z.string().describe('card id or exact card name'), description: z.string().describe('the new description text') }, wrap('describe', a => ({ card: a.card, description: a.description })))
server.tool('roster_archive', 'Archive a card, or restore it', { card: z.string().describe('card id or exact card name'), restore: z.boolean().optional().describe('omit/false archives the card; true restores it') }, wrap('archive', a => ({ card: a.card, ...(typeof a.restore === 'boolean' ? { restore: a.restore } : {}) })))

// ── Bricks Studio: the same key, answered as the key owner's own Studio login.
// Reads work on every key; comment, upload, status and plan changes need the
// matching Studio permission on the key, requested on the Connect page.
const STUDIO = 'Bricks Studio (review submissions, Creative Plans, clients), with the same key.'
const NO_CLIENT = 'Client-facing actions (sending to a client, share links, client approval, delete) are not available here.'
const enc = (s) => encodeURIComponent(String(s ?? '').trim())
const studioWrap = (fn) => async (args) => {
  try {
    warnIfLegacy()
    takeNotice()
    const r = await fn(args || {})
    const n = takeNotice()
    if (typeof r === 'string') return { content: [{ type: 'text', text: r + (n ? '\nNotice: ' + n : '') }] }
    return asText(n && r && typeof r === 'object' && !Array.isArray(r) && !r.notice ? { ...r, notice: n } : r)
  } catch (e) { return asError(e) }
}
const sub = (id) => `/api/agent/submissions/${enc(id)}`

server.tool('studio_whoami', `${STUDIO} Who Studio sees for your key: your Studio account, org, access and view only flag, plus the Studio permissions on the key (studio_comment, studio_upload, studio_status, studio_plan). ${NO_CLIENT}`, {}, studioWrap(() => callStudio('GET', '/api/agent/whoami')))
server.tool('studio_submissions', `${STUDIO} List submissions (work sent for review), newest first: id, title, type, client status, internal status, client, owner, version and comment counts, the latest version and a Studio link. Pages of 50 by default (limit up to 200); page with offset while next_offset is set. ${NO_CLIENT}`, {
  q: z.string().optional().describe('text in the title or client name, or the start of an id'),
  client: z.string().optional().describe('client name (partial OK)'),
  status: z.enum(['PENDING', 'APPROVED', 'REVISION_REQUESTED', 'NONE', 'CHANGES_REQUESTED']).optional().describe('PENDING, APPROVED or REVISION_REQUESTED filter the client status; NONE or CHANGES_REQUESTED filter the internal review'),
  type: z.string().optional().describe('submission type, e.g. VIDEO, CAROUSEL, STORY, ARTWORK'),
  mine: z.boolean().optional().describe('true = only submissions you uploaded'),
  limit: z.number().int().min(1).max(200).optional().describe('rows per page, default 50, max 200'),
  offset: z.number().int().min(0).optional().describe('skip this many rows'),
}, studioWrap(a => callStudio('GET', '/api/agent/submissions', { query: { q: a.q, client: a.client, status: a.status, type: a.type, scope: a.mine ? 'mine' : undefined, limit: a.limit, offset: a.offset } })))
server.tool('studio_submission', `${STUDIO} One submission in full: client and internal status, plan, shoot, recent activity, and every version with its files and signed preview, poster and download links (preview links last 12 hours, download links 1 hour). ${NO_CLIENT}`, {
  id: z.string().describe('submission id or its first 8 characters'),
}, studioWrap(a => callStudio('GET', sub(a.id))))
server.tool('studio_comments', `${STUDIO} Review comments on a submission, oldest first: createdAt, version, author, type (team or client), timecode, seconds, file, body, resolved. csv true returns the same rows as CSV text for a spreadsheet. ${NO_CLIENT}`, {
  id: z.string().describe('submission id or its first 8 characters'),
  csv: z.boolean().optional().describe('true = return CSV text instead of JSON'),
  version: z.number().int().min(1).optional().describe('only comments on this version number'),
}, studioWrap(a => callStudio('GET', `${sub(a.id)}/comments`, { query: { format: a.csv ? 'csv' : undefined, version: a.version }, csv: !!a.csv })))
server.tool('studio_comment', `${STUDIO} Add a team comment to a submission. It is always a team comment and never visible to the client. Pin it to a moment with timecode (0:42, 1:02:05 or seconds), to a version number, or to one file. Needs the studio_comment permission on the key. ${NO_CLIENT}`, {
  id: z.string().describe('submission id or its first 8 characters'),
  text: z.string().describe('the comment text'),
  timecode: z.string().optional().describe('a moment in a video, e.g. 0:42 or 1:02:05'),
  version: z.number().int().min(1).optional().describe('version number, default the latest'),
  file_id: z.string().optional().describe('a file id from studio_submission, to comment on one file'),
}, studioWrap(a => callStudio('POST', `${sub(a.id)}/comments`, { body: { body: a.text, ...(a.timecode ? { timecode: a.timecode } : {}), ...(a.version !== undefined ? { version: a.version } : {}), ...(a.file_id ? { fileId: a.file_id } : {}) } })))
server.tool('studio_upload', `${STUDIO} Upload a new version of a submission from local files: images (jpg, png, webp, gif, heic, up to 30 and 60 MB each) or videos (mp4, mov, webm, up to 2 GB), not both in one call. The new version starts hidden from the client. option_of adds it as an option of an existing version. Needs the studio_upload permission on the key. ${NO_CLIENT}`, {
  id: z.string().describe('submission id or its first 8 characters'),
  files: z.array(z.string()).min(1).max(30).describe('local file paths'),
  option_label: z.string().optional().describe('label for this option, e.g. "Option B"'),
  option_of: z.string().optional().describe('version id this upload is an option of'),
}, studioWrap(a => uploadVersion(a.id, a.files, { optionLabel: a.option_label, parentVersionId: a.option_of })))
server.tool('studio_status', `${STUDIO} Set the internal review status of a submission: approve, changes (changes requested) or clear. This is the team's internal track only; the client's own verdict is never set here. Needs the studio_status permission on the key. ${NO_CLIENT}`, {
  id: z.string().describe('submission id or its first 8 characters'),
  action: z.enum(['approve', 'changes', 'clear']).describe('approve, changes or clear'),
  note: z.string().optional().describe('a note for the team'),
  version_id: z.string().optional().describe('a version id, default the latest version'),
}, studioWrap(a => callStudio('POST', `${sub(a.id)}/status`, { body: { action: a.action, ...(a.note !== undefined ? { note: a.note } : {}), ...(a.version_id ? { versionId: a.version_id } : {}) } })))
server.tool('studio_plans', `${STUDIO} List Creative Plans, most recently changed first: id, name, status (DRAFT or READY), kind, client, owner, shoot date, location and duration, linked shoot, submission count and a Studio link. ${NO_CLIENT}`, {
  q: z.string().optional().describe('text in the plan name, location or client name, or the start of an id'),
  client: z.string().optional().describe('client name (partial OK)'),
  status: z.enum(['DRAFT', 'READY']).optional().describe('DRAFT or READY'),
  mine: z.boolean().optional().describe('true = only plans you own'),
  limit: z.number().int().min(1).max(200).optional().describe('rows per page, default 50, max 200'),
  offset: z.number().int().min(0).optional().describe('skip this many rows'),
}, studioWrap(a => callStudio('GET', '/api/agent/plans', { query: { q: a.q, client: a.client, status: a.status, scope: a.mine ? 'mine' : undefined, limit: a.limit, offset: a.offset } })))
server.tool('studio_plan', `${STUDIO} One Creative Plan in full, with editable (the fields studio_plan_edit can change) and a Studio link. ${NO_CLIENT}`, {
  id: z.string().describe('plan id or its first 8 characters'),
}, studioWrap(a => callStudio('GET', `/api/agent/plans/${enc(a.id)}`)))
server.tool('studio_plan_edit', `${STUDIO} Change a Creative Plan: name, status (DRAFT or READY), shootDate, shootLocation, shootDuration, clientBrief. Pass only the fields to change; an empty string clears a text field. Needs the studio_plan permission on the key. ${NO_CLIENT}`, {
  id: z.string().describe('plan id or its first 8 characters'),
  name: z.string().optional().describe('new plan name'),
  status: z.enum(['DRAFT', 'READY']).optional().describe('DRAFT or READY'),
  shootDate: z.string().optional().describe('shoot date as text, e.g. 2026-11-02'),
  shootLocation: z.string().optional().describe('shoot location'),
  shootDuration: z.string().optional().describe('shoot duration, e.g. 4 hours'),
  clientBrief: z.string().optional().describe('the client brief'),
}, studioWrap(a => {
  const body = Object.fromEntries(PLAN_FIELDS.filter(k => a[k] !== undefined).map(k => [k, a[k]]))
  if (!Object.keys(body).length) throw new Error(`Pass at least one field to change: ${PLAN_FIELDS.join(', ')}`)
  return callStudio('PATCH', `/api/agent/plans/${enc(a.id)}`, { body })
}))
server.tool('studio_clients', `${STUDIO} Studio clients: id, name, active, business categories and counts of submissions, plans and catalog items. Active clients only unless all is true. ${NO_CLIENT}`, {
  q: z.string().optional().describe('part of a client name'),
  all: z.boolean().optional().describe('true = include inactive clients'),
}, studioWrap(a => callStudio('GET', '/api/agent/clients', { query: { q: a.q, all: a.all ? '1' : undefined } })))
server.tool('studio_client_items', `${STUDIO} A client's items catalog (products and props) with category, description, photo and source. plans true also lists items named on that client's plans that are not in the catalog yet. ${NO_CLIENT}`, {
  client: z.string().describe('client id or name'),
  q: z.string().optional().describe('filter items by text'),
  plans: z.boolean().optional().describe('true = add items found on the client\'s plans'),
}, studioWrap(a => callStudio('GET', `/api/agent/clients/${enc(a.client)}/items`, { query: { q: a.q, includePlans: a.plans ? '1' : undefined } })))

warnIfLegacy()
await server.connect(new StdioServerTransport())
log('ready v' + VERSION)
