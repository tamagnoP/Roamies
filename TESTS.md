# Tests by hand

The checks the owner runs by hand, one test session per group of features. Each feature on `next` has its entry
here, written on its branch with the feature itself: the checks in order, and what should be seen. When the owner
says a session has passed, `next` is merged into `local-only` (see "Git" in `CLAUDE.md`).

Before a session: build the app from `next` and install it as `CLAUDE.md` says ("To install a build").

## Group 1: features 18, 33, 25 and 31

Not on `next` yet: feature 33 (stand down), feature 25 (check-ins on progress), feature 31 (speaking budget and
quiet queue).

### Feature 18: the daily note, task pages, the handover

On `next` since `be67580`. The checks marked **next day** need the day to turn (`calendar.dayTurnsAt`, 04:00). To see
the turn in one sitting, set `calendar.dayStart` and `calendar.dayTurnsAt` a few minutes ahead for the session (the
turn may not come after the start of the day), then set them back.

**Before.** Add these to `~/Documents/roamies-pi/settings.json`: `"dailyFolder": "Daily"`; in `calendar`,
`"dayTurnsAt": "04:00"` and `"reviewAt"` a few minutes ahead of when you start; in `limits`, `"reviewQuestions": 3`
and `"openItemAskDays": 7`. Have Super Productivity open, and at least two to-dos planned for today whose time is
over (to be missed), one still ahead, and one with nothing planned.

1. **Start Roamies.**
   You should see: no bubble naming missing settings.
2. **Type a first request**, for example "What's on today?".
   You should see: the usual reply; `Daily/<today>.md` in the vault, with the date, links to the days before and
   after, and `## Plan` listing today's to-dos (with their times), then `### Needs a new time` (old to-dos whose
   times have all passed), then `### Coming up` (deadlines in the next 14 days). Plain bullets, no boxes.
3. **Tick a to-do done** in the list, or in Super Productivity.
   You should see: within 30 seconds, `- HH:MM Done: <title>` under `## Log`.
4. **Say "note this down: <something>".**
   You should see: the note in the vault; `- HH:MM Note: [[<title>]]` in the Log.
5. **Say "note this down for the <to-do> to-do: <something>".**
   You should see:
   - `Tasks/<to-do title>.md`, with the title, the due time if it has one, and a line
     `- [[Daily/<today>|<day>]]: note [[<note title>]]`;
   - the note's front matter has `task:` and `day:`;
   - the Log line ends `(for [[Tasks/…|<to-do title>]])`.
6. **Say "link my note <an older note> to the <to-do> to-do".**
   You should see: one more line on the page; the note ends with `For [[Tasks/…]], [[Daily/…]].`; nothing else in
   the note changed.
7. **Say "which notes do I have for the <to-do> to-do?".**
   You should see: Roamies names the notes from 5 and 6, by title only.
8. **Wait for `calendar.reviewAt`**, with nothing else going on.
   You should see and hear, without asking: "Day review: N of M planned to-dos done…" (counts only, no titles). The note gets
   `## Review (HH:MM)`: each planned to-do as Done, Missed or Still open today, two sentences, then
   `### Needs a new time` with the missed ones.
9. **The questions that follow**, one per missed to-do: "<title> was planned for … and isn't done. When will you do
   it?", with the buttons Leave it and Drop it. Answer them like this:
   - "Tomorrow at 10": the block moves there (Super Productivity shows it), or the due time is set when it has no
     block. Roamies says the new time; the Log gets `Rescheduled: <title> → <day>, 10:00`.
   - "Drop it": Roamies says "I'll stop asking about <title>."; the Log gets `Let go: <title>`; the task in Super
     Productivity is unchanged (not deleted, not done).
   - Say nothing: the bubble closes when its answer window ends, nothing changes, and no further question comes.
   - "Next Friday" or "banana": the bubble shows `Heard "…"` and stays open.
   With more than three missed: one line, "N more need a new time: …in today's note under Needs a new time."
10. **Hold the talk keys and say "review my day".**
    You should see and hear: the counts again; the note gets `## Review update (HH:MM)` with only what changed
    since; the questions not answered yet come again.
11. **Say "review my day" on its own, then "review my day and tell me a joke".**
    You should see: the first is answered by the app (no reply from the AI); the second goes to the AI as usual.
12. **Next day: the first request** (typed or spoken).
    You should see and hear: "One moment: I'm wrapping up yesterday.", then the reply. Yesterday's note gets
    `## Handover`:
    - part one (to-dos and reminders made, changed, done or dropped; questions still waiting; blocks kept);
    - then `### Decided`, `### Left open` (each item as `- [ ] … ^oi-…`), and `### Worth remembering`.

    Today's note gets its Plan.
13. **Next day: ask "what was left open yesterday?".**
    You should see: Roamies knows the open items without looking anything up (they came with the new
    conversation's first message).
14. **Next day: the first spoken exchange**, with no morning briefing set.
    You should see: at its end, the questions about the to-dos under Needs a new time, as in 9, at most three.
15. **Open items.**
    - Tick an item's box in yesterday's note in Obsidian. You should see: within 5 minutes,
      `- [x] HH:MM Closed: <item> (ticked in the note)` in today's Log.
    - Say "<item>: that's sorted". You should see and hear: "Closed: <item>." with no question first, and the
      ticked Log line `(you said so)`.
    - Ask "is anything from yesterday done already?" and let Roamies suggest one. You should see: a bubble "Close the
      open item …?" first.
16. **Briefings (optional).** Set `briefings.morning` a minute ahead. You should hear: the count of to-dos that
    need a new time (no titles), then the questions. Set `briefings.evening` before `calendar.reviewAt`: the review
    comes first, said by the app, then the summary of pi's work.
17. **The activity log**, `~/.gg/sidekick/logs/<today>.log`.
    You should see: `daily_*`, `handover`, `handover_items` and `open_item_*` lines with counts only, and no titles.

## Group 2: features 23, 32, 14, 29 and 30

Not on `next` yet.

## Group 3: features 19 and 21

Not on `next` yet.

## Group 4: features 17, 28, 15, 20 and 27

Not on `next` yet.
