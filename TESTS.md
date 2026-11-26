# Tests by hand

The checks the owner runs by hand, one test session per group of features. Each feature on `next` has its entry
here, written on its branch with the feature itself: the checks in order, and what should be seen. When the owner
says a session has passed, `next` is merged into `local-only` (see "Git" in `CLAUDE.md`).

Before a session: build the app from `next` and install it as `CLAUDE.md` says ("To install a build").

## Group 1: features 18, 33, 25 and 31

Features 18 and 33 are on `next`. Features 25 and 31 are built together on `check-ins`, waiting for the owner's
review.

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
   times have all passed), then `### Coming up` (deadlines in the next 14 days). With features 25 and 31: every line in those three lists is a box, `- [ ] …`,
   ending in `^td-<id>`.
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

### Feature 33: stand down

On `next` since `0dde9a9`. The look is JARVIS's (set it in the menu if another look is on). With features 25 and 31,
what it holds waits in the quiet queue: the steps below are written for that.

**Before.** Add to `~/Documents/roamies-pi/settings.json`:
`"standDown": { "phrase": "stand down", "shortcut": "Control+Alt+Period", "endsAtDayTurn": true, "waitSeconds": 1.5 }`. Have one reminder
("remind me in five minutes to stretch") due a few minutes after you start, and `speakNotices` true.

1. **Start Roamies.**
   You should see: no bubble naming missing settings, and no bubble about the stand-down shortcut.
2. **Ask something with a long spoken answer; while it speaks, press ⌃⌥. (Control-Option-Period).**
   You should see and hear: the voice stops at once; the bubble and any card go; the globe turns grey and dim,
   stops turning, and its heart is a flat dash; it sits still at home. No line is said.
3. **Look at it beside normal rest.** Hold the talk keys and say something short, so it ends the stand down, and let
   it come to rest (about 15 seconds).
   You should see: normal rest is in colour, the globe turning slowly, a dot for a heart: clearly different from 2.
4. **Hold the talk keys and say "Jarvis, stand down, please".**
   You should see: it stands down as in 2 while the keys are still held (about a second and a half after the last
   word); no reply follows.
5. **Hold the talk keys and say "take a note: the committee will stand down in March".**
   You should see: a note is taken as usual (it ends the stand down from 4): nothing stood down.
6. **Ask for something that ends with a question to you (a Send bubble for pi, or a yes/no), and when its answer
   window opens say "okay Jarvis, stand down now please".**
   You should see: the bubble closes; the microphone closes (no listening pill); nothing is sent. Say "what's
   pending?" later: the question is listed. A read-only hand-off with its countdown running is not sent when the
   countdown would have ended.
7. **Hand pi a task that takes a while** ("ask pi to run the tests and wait a minute first"), press Send, and while
   pi works press ⌃⌥. .
   You should see: pi's steps stop; no "Stopped pi." line.
8. **While stood down, let the reminder come due.**
   You should see and hear: nothing at its time, and no count on the character.
9. **Restart Roamies while stood down** (Quit, open it again).
   You should see: the character comes back in the stood-down look, with no wave and no greeting.
10. **Type a request in the ask field.**
    You should see and hear: colour comes back; the reply; the late nudge for the reminder, with the list; then,
    once it is quiet, one line such as "While I stood down: pi was stopped…" (shown, and said).
11. **Say "that's enough for today, you can stand down".**
    You should see: an ordinary reply; nothing stood down.
12. **Optional: the day turn.** Stand down, then set `calendar.dayStart` and `calendar.dayTurnsAt` a few minutes
    ahead and wait past the turn (set them back after).
    You should see: colour comes back by itself, with nothing said or shown. Then type a request: after its reply,
    the "While I stood down…" line, if anything happened meanwhile.
13. **The activity log**, `~/.gg/sidekick/logs/<today>.log`.
    You should see: one `stand_down` line each time it began (by `key` or `phrase`, then true/false only) and one
    `stand_down_end` line each time it ended (`by`, `minutes`, `held`); `quiet_queued` lines with `"why":"stood"`
    for what it held; no words you said, no titles.

### Features 25 and 31: check-ins, the speaking budget and the quiet queue

Built together on `check-ins`; on `next` once the review is accepted. Two numbers matter here: at most 3 things said
unasked an hour, and a check-in at most 6 times a day.

**Before.** Add to `~/Documents/roamies-pi/settings.json`:
`"speaking": { "perHour": 3, "briefing": true, "review": true, "checkIn": true, "deadlineAtRisk": true, "calendarLine": true, "notice": true, "awayMinutes": 10, "quietInCalls": true }`,
and in `limits`: `"checkInsPerDay": 6, "checkInAgainMinutes": 30, "atRiskHours": 24, "queueGiveMost": 3`. Have Super
Productivity open, and in it: a to-do with a 15-minute block starting a few minutes from now; a to-do with no block
due 10 minutes from now; a to-do due tomorrow morning with no block. `speakNotices` true.

1. **Start Roamies.**
   You should see: no bubble naming missing settings. Within a minute, said and shown: "<tomorrow's to-do> is due
   tomorrow at HH:MM and has no time planned before then." (the other two are listed too if due within 24 hours
   with no block before then).
2. **Type a first request**, so the daily note has today's Plan.
   You should see: every line of `## Plan`, `### Needs a new time` and `### Coming up` is `- [ ] …` ending in
   `^td-<id>`.
3. **Let the block end**, with nothing else going on.
   You should see and hear, within 30 seconds: "Your block for <title> has ended. Is it done?", with the buttons
   Done, Still on it and Not yet; the microphone opens for the answer. Say **"still on it"**.
   You should see: the bubble goes; the Log gets `Check-in: <title>: still on it`. About 30 minutes later (after a
   block that is running has ended) the question comes again: "Is <title> done now?".
4. **Let the second to-do's due time pass.** No due-time nudge ("is due at") comes for it.
   You should see and hear: "<title> was due at HH:MM. Is it done?". Say **"not yet, tomorrow at 10"**.
   You should see: Roamies says the new time; Super Productivity shows it; the Log gets `Rescheduled: <title> → …`.
5. **The budget.** By now three things were said unasked within the hour (the deadline line and two check-ins). Make
   another one come: move the first to-do's block to end in two minutes, or set `speaking.perHour` to 1.
   You should see and hear: nothing at its time; a small count on the character, "1".
6. **Type "anything waiting?"**.
   You should see: the check-in is asked now, and the count goes. Click **Done**: the to-do is done in Super
   Productivity. Type "anything waiting?" again: "Nothing is waiting."
7. **Away.** Set `speaking.awayMinutes` to 1. Have a check-in come due (a to-do due in three minutes), and don't
   touch the keyboard or mouse for that time.
   You should see: nothing said; the count shows 1. Touch the mouse: still nothing (the queue waits for your next
   exchange). Then type a request: after its reply, the check-in is asked. Set `awayMinutes` back.
8. **In a call.** Start a FaceTime or Zoom test call (or record a voice memo), and have a check-in come due.
   You should see: nothing said; the count shows 1; the activity log has `presence {"away":false,"call":true}` and
   `quiet_queued {"kind":"checkIn","why":"call"}`. End the call: `presence {"away":false,"call":false}`.
9. **A kind off.** Set `speaking.deadlineAtRisk` to false and add a to-do due tomorrow with no block.
   You should see: no line; the count; `quiet_queued {"kind":"deadlineAtRisk","why":"off"}`.
10. **Stood down.** Press ⌃⌥. and let a check-in come due.
    You should see: no count while stood down. Type a request: after its reply, the "While I stood down" line
    (if anything was stopped or went out of date), then the check-in.
11. **Out of date.** Let a check-in wait in the queue (as in 5), then tick that to-do done in Super Productivity
    before your next exchange.
    You should see, after the next reply: "Dropped as out of date: 1 check-in." and no question.
12. **A box in Obsidian.** In today's Plan, tick the box of an open to-do that has a block later (today or under
    Coming up).
    You should see: within 5 minutes, the to-do done in the list and in Super Productivity, its block gone from the
    calendar, and its Done line in the Log. Untick it: nothing changes.
13. **The review.** At `calendar.reviewAt`: the to-do left "still on it" is "Still open today", not missed, and no
    question asks about it.
14. **The activity log**, `~/.gg/sidekick/logs/<today>.log`.
    You should see: `checkin_due`, `checkin {how, answer}`, `deadline_at_risk`, `quiet_queued {kind, why}` (why one of
    `stood`, `off`, `away`, `call`, `budget`), `quiet_given`, `quiet_stale`, `presence {away, call}`, `plan_ticked`;
    counts and those words only, no titles.

## Group 2: features 23, 32, 14, 29 and 30

### Features 23 and 32: the local model, private mode, the ledger (branch `offline-ledger`; 14, 29 and 30 not built)

**Before.** In `~/Documents/roamies-pi/settings.json`: `"local": { "address": "http://127.0.0.1:8080/v1", "model": "",
"whenOffline": true, "historyExchanges": 4, "maxSteps": 4, "confirmChanges": true, "start": { "python":
"/opt/homebrew/anaconda3/envs/localai/bin/python", "model": "e4b", "port": 8080, "sleepAfterMinutes": 10, "draft": true } }`,
`"measureRequests": true`, and in `limits`: `"ledgerDays": 90`. Gemma 4 E4B and its drafter in the Hugging Face cache.

1. **Wi-Fi off, then ask "What's on my calendar on Friday?"**
   You should see: after the server starts (about 10 s the first time), "Claude can't be reached, so the local model
   on this Mac is answering." and the answer, in a bubble tagged "local". `ps` shows `mlx_vlm.server` under
   `sandbox-exec`.
2. **Say "Remind me at half past four to pick up the parcel."**
   You should see: "I'll remind you to pick up the parcel at 16:30." at once (made by code, no model).
3. **Say "Move the budget review to Friday at 3pm."**
   You should see: a yes/no bubble "Move the block for "Budget review" to Friday … at 15:00?", said aloud with the
   answer window; no answer saves nothing and nothing is kept.
4. **Wi-Fi on, ask anything.** You should see: "Claude is answering again." first.
5. **Say "Keep this private." then "Add a to-do: call the clinic."** You should see: the "private" mark under the
   character, the bubble tagged "local · private", and the to-do on the list. **Then "Back to Claude." and "What's
   open today?"**: Claude's reply mentions one private to-do, never its title.
6. **Private mode with the local server stopped** (`pkill -f mlx_vlm.server`, `local.start.python` ""): "The local
   model isn't answering; nothing was sent."
7. **Say "What left the Mac today?"** You should see: the provider's requests, tokens, screen captures and window
   texts, how many stayed on this Mac, and the hand-offs to pi; no model is asked.
8. **The tunnel** (your own, to the Mac mini, on another port in `local.address`): the same answers; Roamies starts
   and stops no server.
9. **The activity log**: `timing {route, hearing, ready, reading, voice, …}`, `memory {mb: {shell, sidecar, voice,
   kokoro, modelServer, webkit}, pressure, swapMB}`, `local_request`, `private_mode`; numbers and names only.

## Group 3: features 19 and 21

Not on `next` yet.

## Group 4: features 17, 28, 15, 20 and 27

Not on `next` yet.
