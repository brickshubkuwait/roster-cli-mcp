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
brello auth
brello stats
```

`brello auth` asks for your key at a masked prompt, checks it, and saves it to
`~/.roster` (only your user can read it), until you renew or replace the key. Run `brello auth` again with the replacement.

> Need a key? Get one at [roster.bricks.com.kw/connect](https://roster.bricks.com.kw/connect) (by invitation).
> Already copied it? `pbpaste | brello login` signs in straight from the clipboard.
> The command is `brello` (typing `roster` works too).

<details><summary>Install from source instead</summary>

```bash
git clone https://github.com/brickshubkuwait/roster-cli-mcp.git
cd roster-cli-mcp && npm install && npm link
brello auth
```
</details>

## Developer hub

Open [Bricks Developers](https://roster.bricks.com.kw/developers) for setup guides, the searchable CLI/MCP reference, workflows and troubleshooting.

```bash
brello docs
brello help keys
```

Claude can use the `roster_docs` tool for the same links and key guidance, without an API call.

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
| `brello scope "<client>" --month YYYY-MM` | One client in one month: what the contract sold vs what was shot, delivered and approved, per contract, plus special requests. `?` means unknown and a note says why. Add `--json` for the raw response. e.g. `brello scope "Sedra" --month 2026-10` |
| `brello due [days]` | Cards due soon — the next N days (default 7), soonest first |
| `brello done [days]` | Recently completed cards — the last N days (default 14) |
| `brello blocked` | Blocked or stuck cards — explicit blockers, or overdue by 3+ days |
| `brello recent [n]` | Recently touched cards across your team (default 20) |
| `brello now` | Live pulse — who's tracking now, what's due today, and the latest card moves |
| `brello stages` | Board stages with your team's open card count in each |
| `brello departments` | The roster's departments and headcount |
| `brello cards ["<stage>"]` | Every card in a stage or matching filters; `--history` adds each card's stage history |
| `brello stage-stats` | Stage usage over the board's history; `--department` and `--client` narrow it |
| `brello shoots` | The company-wide shoot schedule; `--from`/`--to`, `--client`, `--type`, `--status`, `--include-removed`; each shoot has a readiness line |
| `brello meetings` | Meetings with owner, attendees and minutes status; `--from`/`--to`, `--client`, `--owner` |
| `brello clients ["<name>"]` | Client directory with Instagram handle, logo and open cards; `--all` adds archived clients |
| `brello readiness [--days 7] [--json]` | Upcoming shoots and what is still missing: plan, budget, models, props, call time |

Run `brello help` to see them all. Full reference: [QUERIES.md](./QUERIES.md).

Add `--json` to any command for scripts: the raw JSON response, with no banner and no colour.

```bash
brello shoots --from 2026-10-01 --to 2026-10-31 --client Foodhall --json
brello meetings --owner Melani --json
brello clients --json
```

With `--json`, card results that name a client carry `client_logo_url` and `instagram_handle`, and `team` and `user` carry `avatar_url`.

Card changes (`brello move`, `brello due <card> <date>`, `brello assign`) take `--reason "<why>"`, which is recorded on the card. Taking a card out of Backlog needs a due date first (`DUE_REQUIRED`), and moving a missed due date to a later day needs a reason (`REASON_REQUIRED`).

## Limits

| Surface | Limit |
|---|---|
| Self-service key | 60 requests / minute + 3,000 / rolling day |
| Administrator-issued key | 180 requests / minute |

CLI and MCP share the same budget per key. Self-service card access stays with your team, even with `--board`. Write actions need individual approval, assignments stay within your team, and archive is unavailable. Self-service responses omit share/open URLs, invoice details and delivery recipients.

Each call returns a sensible page: `search` up to 50 cards, `comments` / `reactions` the latest 40, `leaves` the next 60 upcoming.

## Use it from Claude (MCP)

The global install also adds a `brello-mcp` command. Run `brello auth` first;
Claude reuses that sign-in. Then ask in plain English
(*"what's overdue for my team?"*, *"who's off next week?"*).

**Claude Code**

```bash
claude mcp add brello -- brello-mcp
```

**Claude Desktop**: add this to `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "brello": {
      "command": "brello-mcp"
    }
  }
}
```

> No path and no key in the config. The server reads the key `brello auth` saved.
> Got a new key? Run `brello auth` again; Claude picks it up on the next question.

## Keys

- Self-service keys are invitation-only and last 30 days. An approval can be claimed for 24 hours, with a sign-in within the last 10 minutes. The key is shown once.
- Renew in My keys when eligible. Revealing the renewal replaces and revokes the old key. Run `brello auth` on each device using it.
- `brello logout` only removes the local copy. Revoke a lost key in My keys.
- Keys come from [roster.bricks.com.kw/connect](https://roster.bricks.com.kw/connect). Renew or replace them there.
- If a key expires, is paused, or hits the rate limit, brello tells you why and what to do next.
- When the server has a heads up for you (for example, your key expires in a few days), the CLI prints it after your results and Claude sees it as a final `Notice:` line.
- Old style keys are retired. If you still have one, get a new key at the link above and run `brello auth`.
