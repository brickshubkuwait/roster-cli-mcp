// Release history — newest first. Adding a release: prepend an entry AND bump
// package.json to the same version (VERSION below feeds the MCP server + CLI).
export const CHANGELOG = [
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

export const VERSION = CHANGELOG[0].version
