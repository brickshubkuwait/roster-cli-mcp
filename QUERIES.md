# Commands

The [Developer hub](https://roster.bricks.com.kw/developers#reference) has the searchable CLI and MCP reference. Run `brello docs` for links, or `brello help keys` for key setup and recovery.

What each command returns.

| Command | Returns |
|---|---|
| `stats` | Team size, and counts of open / done / overdue cards, plus how many people are tracking time right now. |
| `team` | Your team members — name, role, and whether they're tracking. |
| `overdue` | Cards past their due date and not done — card, client, assignee, due date. |
| `workload` | Open + overdue card counts per person, so you can see who's buried. |
| `active` | Who is tracking time right now, and on which card (live Hubstaff). |
| `leaves` | Upcoming approved time off for your team — person, date, type (Vacation Tracker). |
| `comments` | Recent comments on your team's cards — card, author, comment, date. |
| `reactions` | Recent emoji reactions on your team's cards — card, who, emoji, date. |
| `activity` | Card history — who moved a card (stage→stage), commented, split, reassigned, or edited it, and when. |
| `search "<text>"` | Cards whose title or client matches the text. |
| `card <id>` | Full card detail — description, stage, priority, assignee, collaborators, subtasks, split task, linked cards, due. |
| `scope "<client>" --month YYYY-MM` | One client in one month, one block per contract live in that month: contracted (Salesforce quote), shot (completed shoot days and their outputs), delivered (cards sent to the client or completed) and approved (client approvals in Bricks Studio), by type: sessions, photos, videos, reels, stories, artworks, animations. Special requests come with what was asked for, never an amount. Unknown numbers print `?` (`null` in `--json`) with a note. See [Scope](#scope). |
| `stages` | The board's workflow stages (lists) with your team's open card count in each. |
| `departments` | The roster's departments and their headcount. |
| `shoots` | The whole shoot schedule, company-wide — date, client, type, crew (recent + upcoming). |

CLI and MCP share the same per-key budget. Self-service keys see your team’s cards even when `--board` is supplied. Write actions need approval, assignments stay within your team, and archive is unavailable. Self-service responses omit share/open URLs, invoice details and delivery recipients.

## Card fields

`card <id>` returns every field set on the card (empty ones are left out):

| Field | What it is |
|---|---|
| `card` | The card title |
| `client` | Client the work is for |
| `stage` | Which board column it's sitting in right now |
| `department` | The card's department tag |
| `priority` | low / medium / high |
| `assignee` | Who owns it |
| `collaborators` | Everyone else working on it |
| `due` · `done` | Due date, and whether it's complete |
| `delivery month` | Target delivery month |
| `occasion` | Campaign / occasion tag |
| `location` | Shoot or work location |
| `subtasks` | Checklist progress (done / total) and each item |
| `split` | If the task is split, who the second half is on (+ note) |
| `connected` | Linked / split-off cards |
| `description` | The full brief |
| `created` | When the card was first made |
| `last activity` | The most recent change to it |

```text
$ brello card 1c11685c
card:           WOW Caterers | JUN Video 2
client:         WOW Caterers
stage:          In Progress
department:     Reel Video Edit
priority:       high
assignee:       Joshin Samuel
collaborators:  Mahmoud Hesham, Krishna Gaikwad
due:            Jun 28        done: no
subtasks:       2/3 — ✓ Script  ✓ Rough cut  • Color grade
split:          yes → Mahmoud Hesham
description:    BTS edit, keep it real, music carries the brand…
created:        Jun 05        last activity: Jun 18
```

## Scope

`brello scope "<client>" --month YYYY-MM` (MCP `roster_scope`). The month defaults to the current one. `--json` prints the gateway response as is.

| Field | What it is |
|---|---|
| `opportunity_id` | The Salesforce opportunity on the contract |
| `contract_type` | `retainer` or `project` (`sealed` is not a contract type in Roster, so it never appears) |
| `period` | Retainer: the billing cycle that covers the month (a bi-monthly July invoice covers July and August), else the calendar month. Project: the whole project, start to end. |
| `deliverables[]` | `{ type, contracted, shot, delivered, approved, delivered_cards, approved_cards }` |
| `extras[]` | `{ special_request_id, what, status, value }` from the Special Requests board. `value` is the requested quantities, e.g. `{ "videos": 2 }`; a production budget has no value |
| `notes[]` | Why any number is unknown, and what the period means for that contract |

- **contracted** is the accepted (or newest) Salesforce quote. Sessions are the contract's sessions per month for a retainer, the shoot days on the quote for a project.
- **shot** counts completed shoot days (not planning days) on that contract in the period, and the photos, videos and other outputs each day declared.
- **delivered** counts cards on the opportunity that reached Sent to Client or Completed. Photos, artworks and stories use the card's unit count; one video or reel card is one piece.
- **approved** counts those cards the client approved in Bricks Studio. Approvals given outside Studio are not recorded.
- **null / `?`** means unknown, never zero: no line items synced, a shot day that declared no outputs, or a card with no unit count. The note gives what is known.

A team key reads a client only when that client has cards on its team. People are never named in this response.

## Limits & pagination

| | |
|---|---|
| Self-service requests | 60 / minute + 3,000 / rolling day per key |
| Administrator-issued requests | 180 / minute per key |
| `search` | up to 50 cards |
| `comments`, `reactions` | latest 40 |
| `leaves` | next 60 upcoming |
| `overdue`, `workload` | all matching |

## Examples

```text
$ brello stats
team size: 7
open: 24   done: 37   overdue: 5
active now: 2

$ brello overdue
CARD            CLIENT    ASSIGNEE        DUE
JUN Reel 1      —         Mahmoud Hesham  Jun 23
Video Prod 03   Deboned   Thahir Jabbar   Jun 25

$ brello workload
PERSON           OPEN  OVERDUE
Mahmoud Hesham   8     3
Joshin Samuel    4     1
```
