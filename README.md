# brello

Query your team's work from the terminal, or straight from Claude. A small CLI and
MCP server for Roster. No app, no SQL.

```
$ brello stats
team size: 7
open: 24   done: 37   overdue: 5
active now: 2
```

## Install

```bash
npm install -g brello
```

Then sign in — paste the token your admin gave you (saved, so you only do it once):

```bash
brello auth
brello stats
```

> Need a token? Ask your admin to issue one.
> The command is `brello` (typing `roster` works too).

<details><summary>Install from source instead</summary>

```bash
git clone https://github.com/brickshubkuwait/roster-cli-mcp.git
cd roster-cli-mcp && npm install && npm link
brello auth
```
</details>

## CLI

| Command | What it shows |
|---|---|
| `brello stats` | Team dashboard — size, open / done / overdue, who's tracking |
| `brello team` | Your team members |
| `brello overdue` | Cards past their due date and not done |
| `brello workload` | Open + overdue cards per person |
| `brello active` | Who's tracking time right now (live Hubstaff) |
| `brello leaves` | Upcoming time off for your team (Vacation Tracker) |
| `brello comments` | Recent comments on your team's cards |
| `brello reactions` | Recent emoji reactions on your team's cards |
| `brello activity` | Card history — moves (stage→stage), comments, splits, edits |
| `brello search "<text>"` | Find cards by title or client |
| `brello user <name>` | Everything for one person — every card, live AND archived, with their open/done/archived totals + what they're tracking now |
| `brello card <id>` | Every field on a card — workflow, Studio, Salesforce, send/view receipt, Slack thread, sizes and copy |
| `brello studio [filter]` | Bricks Studio review feed — status/version, comments, client views, and open/share links |
| `brello client "<name>"` | Everything for one client — every in-scope card (live + done), who's on it, with open/done/overdue totals |
| `brello due [days]` | Cards due soon — the next N days (default 7), soonest first |
| `brello done [days]` | Recently completed cards — the last N days (default 14) |
| `brello blocked` | Blocked or stuck cards — explicit blockers, or overdue by 3+ days |
| `brello recent [n]` | Recently touched cards across your team (default 20) |
| `brello now` | Live pulse — who's tracking now, what's due today, and the latest card moves |
| `brello stages` | Board stages with your team's open card count in each |
| `brello departments` | The roster's departments and headcount |
| `brello shoots` | The whole shoot schedule — recent + upcoming, company-wide |

Run `brello help` to see them all. Full reference: [QUERIES.md](./QUERIES.md).

## Limits

| Surface | Limit |
|---|---|
| CLI (`brello …`) | 180 requests / minute per token |
| MCP (Claude tools) | 180 requests / minute per token (shared with the CLI) |

Each call returns a sensible page: `search` up to 50 cards, `comments` / `reactions` the latest 40, `leaves` the next 60 upcoming.

## Use it from Claude (MCP)

The global install also adds a `brello-mcp` command. If you've run `brello auth`,
Claude reuses that sign-in — just add this to `~/.claude.json` and ask in plain
English (*"what's overdue for my team?"*, *"who's off next week?"*):

```json
{
  "mcpServers": {
    "brello": {
      "command": "brello-mcp"
    }
  }
}
```

> No path, no token — the server reads the one `brello auth` saved.
> To pin a specific token, add `"env": { "BRELLO_TOKEN": "..." }`.
