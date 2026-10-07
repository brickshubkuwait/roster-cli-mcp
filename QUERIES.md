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
