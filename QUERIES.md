# Commands

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

## Limits & pagination

| | |
|---|---|
| Requests | 180 / minute per token (CLI and MCP share the budget) |
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
