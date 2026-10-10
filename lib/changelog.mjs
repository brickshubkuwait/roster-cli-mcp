import { readFileSync } from 'node:fs'

// Public release notes, newest first. The installed version comes from the
// package so releases without public notes still report their actual version.
export const CHANGELOG = [
  {
    version: '1.11.0', date: '2026-10-10', title: 'Meetings, shoot ranges and JSON output',
    items: [
      'brello meetings lists meetings with owner, attendees and minutes status (none, draft or submitted), filtered by --from/--to, --client and --owner',
      'brello shoots takes --from and --to (YYYY-MM-DD), --client, --type, --status and --include-removed; each shoot now has its id, client id, account, contract month, Extended flag, timestamps and, when removed, when and why',
      'brello cards --history adds each card’s stage history; brello stage-stats takes --department and --client',
      'Add --json to any command for machine output: the raw JSON response with no banner and no colour; errors print as JSON with exit code 1',
      'MCP: roster_meetings is new; roster_shoots, roster_cards (history) and roster_stage_stats (department, client) take the same filters',
    ],
  },
  {
    version: '1.10.1', date: '2026-10-08', title: 'Reasons for moves and due dates',
    items: [
      'brello move, brello due and brello assign take --reason "<why>", recorded on the card',
      'MCP: roster_move, roster_set_due and roster_assign take an optional reason',
      'Refused changes now show the full explanation and code (for example REASON_REQUIRED) instead of the bare code',
    ],
  },
  {
    version: '1.10.0', date: '2026-10-07', title: 'Developer hub and key help',
    items: [
      'brello docs prints the developer hub and My keys links, with no sign-in required',
      'brello help keys explains invitations, approval, reveal, permissions, limits, renewal and recovery',
      'MCP: roster_docs gives Claude the same developer links and key guidance without an API call',
      'README and help now distinguish self-service limits and approved actions from administrator-issued keys',
      'Developer hub: searchable CLI/MCP reference, setup guides, workflows and troubleshooting, reachable from the Roster and Brello menus',
    ],
  },
  {
    version: '1.9.0', date: '2026-10-07', title: 'Self-service keys',
    items: [
      'Keys now come from roster.bricks.com.kw/connect. Sign in with brello auth (masked prompt), or pipe it in: pbpaste | brello login',
      'brello login no longer takes the key as an argument, so it never lands in your shell history or the process list',
      '~/.roster is locked to your user (0700) and the key file to 0600, tightened automatically if an older install left them open',
      'Old style keys get a one-line hint to grab a new key',
      'Clear messages when a key is expired, revoked, paused or rate limited, in the terminal and in Claude',
      'Server notices (like a key expiring soon) print after your results; MCP tools add them as a final Notice line',
      'Claude Code setup is one line: claude mcp add brello -- brello-mcp',
    ],
  },
  {
    version: '1.8.0', date: '2026-08-09', title: 'Studio + connected card context',
    items: [
      'studio [filter] — the Bricks Studio review feed replaces the retired Markup.io command',
      'Studio rows include the Brello card/client, status, version, comments, qualifying client-view receipt, and open/share links',
      'card detail now includes Salesforce opportunity + invoice, Studio submissions, WhatsApp/email send receipt, client viewed time, Slack thread, deliverable sizes, approved EN/AR copy, and request outcome',
      'MCP: roster_studio replaces roster_markup; roster_card returns the same connected context',
    ],
  },
  {
    version: '1.7.0', date: '2026-07-21', title: 'Create cards',
    items: [
      'create "<title>" — mint a brand-new card on the board, no clicking required',
      'Flags: --assignee <name|id>, --due YYYY-MM-DD, --client "<tag>", --dept <department>, --priority <top|high|medium|low>, --list "<stage>", --desc "<brief>" — only the title is required',
      'The card lands in the board’s first list unless you name one; every field is validated (unknown client/department/list is rejected)',
      'MCP: roster_create — so Claude can act on "make a task for Abrar to do the Spirit Felice Bahrain artwork, due tomorrow"',
    ],
  },
  {
    version: '1.6.0', date: '2026-07-15', title: 'Act on cards — write commands',
    items: [
      'comment <card> <text> — add a comment to a card',
      'move <card> <list> — move a card to another list',
      'due <card> <date|clear> — set or clear a card’s due date · done <card> [--undo] — mark a card done or reopen it',
      'priority <card> <top|high|medium|low|none> — set or clear priority · assign <card> <name|none> — assign or unassign',
      'rename <card> <name> · describe <card> <text> · archive <card> [--restore]',
      'Every write takes a card id OR an exact card name; MCP: roster_comment, roster_move, roster_set_due, roster_mark_done, roster_set_priority, roster_assign, roster_rename, roster_describe, roster_archive',
    ],
  },
  {
    version: '1.5.0', date: '2026-07-11', title: 'Dwell, stage history + stage stats',
    items: [
      'Every card row (cards, stage_cards, overdue) now shows how long it has sat in its current stage: stage_entered_at, time_in_stage_hours, age ("3d 2h") — dwell_basis "created_at" marks cards whose history predates move-logging (2026-06-06), so the number is a floor',
      'card detail: stage_history[] — every stage with enter/exit times, dwell hours and who moved it; plus reopen_count and backward_moves',
      'card detail: effort as data — actual_hours + effort_by_person + effort_last_synced_at, parsed from the time-tracking records',
      'NEW stage-stats (MCP: roster_stage_stats) — per-stage history: cards ever entered, median/p90 dwell, skip-rate. The "is this column even used?" answer',
    ],
  },
  {
    version: '1.4.0', date: '2026-07-11', title: 'Changelog',
    items: [
      'brello changelog — this list, right in your terminal',
      'MCP: roster_changelog tool, so Claude can answer "what changed?"',
    ],
  },
  {
    version: '1.3.0', date: '2026-07-11', title: 'Whole-board scope + short tokens',
    items: [
      'scope "team" | "board" on stages, search, workload, overdue and stats — board mode sees every team\'s cards plus unassigned ones',
      'NEW roster_cards / roster_stage_cards — enumerate every card in a stage or across the board; assignee "none" finds unassigned cards',
      'CLI: --board and --unassigned flags, e.g.  brello cards "Ready for Sprint" --board',
      'Every response now says exactly what was counted (scope + filter fields)',
      'stats board mode reports people_with_cards + unassigned_cards; team lists itself as the company directory with your_team fields',
      'Short password-style brl_ tokens — paste into brello auth like a password',
      'npm test — a 22-check acceptance suite driving the real MCP against the live API',
    ],
  },
  {
    version: '1.2.1', date: '2026-06-29', title: 'Card polish',
    items: ['Card view: location is a clickable Google Maps link'],
  },
  {
    version: '1.2.0', date: '2026-06-29', title: 'Six new commands',
    items: [
      'client "<name>" — client dossier: totals, who is on it, every card',
      'due [days] / done [days] — due soon and recently completed',
      'blocked — explicit blockers or overdue 3+ days',
      'recent [n] — recently touched cards · now — live pulse in one feed',
      'brello help <command> — per-command detail with column legends',
    ],
  },
  {
    version: '1.1.0', date: '2026-06-29', title: 'Markup + behaviour timeline',
    items: [
      'markup [filter] — Markup.io review feed with open comment-thread counts',
      'user/card views show started → ended → done timeline and cycle time',
    ],
  },
  {
    version: '1.0.3', date: '2026-06-29', title: 'People history',
    items: ['user <name> — one person\'s whole card history (live + archived) with a dossier header'],
  },
  {
    version: '1.0.2', date: '2026-06-28', title: 'Brello rebrand',
    items: [
      'Primary command is brello (roster still works as an alias)',
      'Grouped help, install theatre, terminal styling',
    ],
  },
  {
    version: '1.0.0', date: '2026-06-28', title: 'First release',
    items: [
      'brello auth sign-in, then: stats, team, overdue, workload, active, leaves, comments, reactions, activity, search, card, stages, departments, shoots',
      'MCP server (brello-mcp) exposing everything to Claude as roster_* tools',
    ],
  },
]

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
