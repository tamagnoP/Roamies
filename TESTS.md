# Tests by hand

The checks the owner runs by hand, one test session per group of features. Each feature on `next` has its entry
here, written on its branch with the feature itself: the checks in order, and what should be seen. When the owner
says a session has passed, `next` is merged into `local-only` (see "Git" in `CLAUDE.md`).

Before a session: build the app from `next` and install it as `CLAUDE.md` says ("To install a build").

## What the owner still has to test

Kept current: a check leaves this table when the owner says it passed. Claude ran groups 1 and 2 in throwaway homes
on 2026-11-26 (`~/Documents/roamies-reports/2026-11-26_1747_TESTS-RUN.md`); what it could run passed, but for four
checks, fixed since. Everything else is below.

| Group | Checks still to do | Why these |
|---|---|---|
| Feature 18 | 3, 9, 11 (typed), 15, 16, 17 | 3 and 15 failed and were fixed; 9 changed ("Next Friday", the Log heading after the review); 11 typed was answered by the AI and is fixed; 16 needs a real night; 17 changed (the tool lines) |
| Feature 33 | 1 to 7, 9, 13, 14 | the screen, voice and a real pi task; 13 changed (`typed`); 14 is new |
| Features 25 and 31 | 8, 15, 16 | 8 needs a real call; 15 and 16 are new |
| Features 23 and 32 | 1, 5, 6, 7, 8, 9, 10 | 1 and 5 failed and were fixed; 1, 6 and 7 changed; 8 needs your tunnel; 9 needs the shell; 10 is new |
| Feature 14 | 1 to 14 | new; review accepted 2026-11-27 with three changes (13 and 14) |
| Feature 40 | 1 to 12 | new; review accepted 2026-11-27, in `next` |
| Feature 34 | 1 to 12 | new; review accepted 2026-11-27, in `next` |

## Group 1: features 18, 33, 25 and 31

All four are on `next` (25 and 31 since `ca766c8`).

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
   You should see: `- HH:MM Done: <title>` under `## Log`: ticked in the list, within 30 seconds; ticked in Super
   Productivity, within `calendar.syncSeconds` (60) plus a few seconds.
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
   - "Next Friday": a second bubble, "<title>: Friday the Nth or Friday the Mth?", with a button for each, said with
     its answer window. Click one, or say "the first one" or "the 4th": it moves to that Friday. No answer changes
     nothing.
   - "banana": the bubble shows `Heard "…"` and stays open.
   With more than three missed: one line, "N more need a new time: …in today's note under Needs a new time."
   These Log lines come under `## Log (after the review)`, not a second `## Log`.
10. **Hold the talk keys and say "review my day".**
    You should see and hear: the counts again; the note gets `## Review update (HH:MM)` with only what changed
    since; the questions not answered yet come again.
11. **Say "review my day" on its own, then "review my day and tell me a joke"; then type both.**
    You should see, spoken and typed: the first is answered by the app (no reply from the AI); the second goes to the
    AI as usual.
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
    The `tool` lines have the tool's name and each argument's length only (`"args":{"title":19}`); `tool_done` and
    `tool_error` the name, the time and the result's length (`chars`).

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
    You should see: one `stand_down` line each time it began (by `key`, `phrase` or `typed`, then true/false only)
    and one `stand_down_end` line each time it ended (`by`, `minutes`, `held`); `quiet_queued` lines with
    `"why":"stood"` for what it held; no `stand_down_leak` for the ask field you opened; no words you said, no titles.
14. **Typed, as said.** Open the ask field and type "Jarvis, stand down, please".
    You should see: it stands down as in 2; nothing goes to the AI. Open the ask field again (it opens while stood
    down) and type "thanks".
    You should see: colour comes back, "Any time." (said too when spoken replies are on), and no reply from the AI.

### Features 25 and 31: check-ins, the speaking budget and the quiet queue

On `next` since `ca766c8`. Two numbers matter here: at most 3 things said
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
15. **Started late.** Quit Roamies; have a to-do whose block ended more than an hour ago and one whose block ended
    20 minutes ago; start Roamies.
    You should see: a check-in for the second only. At `calendar.reviewAt`, the first is listed as Missed and asked
    about like any missed to-do.
16. **"Next Friday" in a check-in.** When a check-in comes, say **"not yet, next Friday at 10"**.
    You should see: a second bubble, "<title>: Friday the Nth or Friday the Mth?", said with its answer window.
    Click the second: the to-do moves to 10:00 on the later Friday, and the Log says so. No answer changes nothing,
    and the Log gets `Check-in: <title>: not yet`.

## Group 2: features 23, 32, 14, 40, 34, 29 and 30

### Features 23 and 32: the local model, private mode, the ledger (on `next` since `1854529`; 29 and 30 not built)

**Before.** In `~/Documents/roamies-pi/settings.json`: `"local": { "address": "http://127.0.0.1:8080/v1", "model": "",
"whenOffline": true, "historyExchanges": 4, "maxSteps": 4, "confirmChanges": true, "start": { "python":
"/opt/homebrew/anaconda3/envs/localai/bin/python", "model": "e4b", "port": 8080, "sleepAfterMinutes": 10, "draft": true,
"waitSeconds": 45 } }`,
`"measureRequests": true`, and in `limits`: `"ledgerDays": 90`. Gemma 4 E4B and its drafter in the Hugging Face cache.

1. **Wi-Fi off, then ask "What's on my calendar on Friday?"**
   You should see: after the server starts (about 10 s the first time), "Claude can't be reached, so the local model
   on this Mac is answering." and the answer, in a bubble tagged "local", worded by code with no model call ("Friday
   28 November: 09:00 to 10:00, …", or "Nothing is on the calendar …"; since the feature 14 review). **Then, in Terminal:**
   `p=$(pgrep -f mlx_vlm.server); for x in $p $(ps -o ppid= -p $p); do /usr/bin/python3 -c "import ctypes,sys;
   l=ctypes.CDLL('/usr/lib/libsandbox.1.dylib'); print(sys.argv[1], 'sandboxed' if l.sandbox_check(int(sys.argv[1]),
   None, 0) else 'not sandboxed')" $x; done` (one line). You should see: `<pid> sandboxed` for the model server, then
   `<pid> not sandboxed` for Roamies, which started it (the check tells the two apart). `sandbox-exec` itself never
   shows in `ps`: it becomes the program it starts.
2. **Say "Remind me at half past four to pick up the parcel."**
   You should see: "I'll remind you to pick up the parcel at 16:30." at once (made by code, no model); "tomorrow at
   16:30" when it is already past 16:30.
3. **Say "Move the budget review to Friday at 3pm."**
   You should see: a yes/no bubble "Move the block for "Budget review" to Friday … at 15:00?" ("to tomorrow at 15:00"
   on a Thursday), said aloud with the answer window; no answer gives "Nothing was changed.", saves nothing and keeps
   nothing.
4. **Wi-Fi on, ask anything.** You should see: "Claude is answering again." first.
5. **Say "Keep this private." then "Add a to-do: call the clinic."** You should see: the "private" mark under the
   character, the bubble tagged "local · private", and the to-do on the list. **Then "Back to Claude." and "What's
   open today?"**: Claude's reply, then one line added by the app: "There is 1 private to-do or reminder; only the
   local model can show it." Neither names it.
6. **Private mode with the local server stopped** (`pkill -f mlx_vlm.server`, `local.start.python` ""): "The local
   model isn't answering; nothing was sent." **And a model that can't load** (`local.start.python` set back, the
   model's folder renamed for the test): within `local.start.waitSeconds` (45 s), only "The local model could not
   start, so nothing was sent.", never that it is answering.
7. **Say "What left the Mac today?", then type it.** You should see, both times: the provider's requests, tokens,
   screen captures and window texts, how many stayed on this Mac (the warm-ups named apart), and the hand-offs to pi;
   no model is asked. A request that failed at sign-in, if there was one today, has a sentence of its own ("… failed
   at sign-in and got no answer …") and is not counted among those sent. In `~/.gg/sidekick/ledger.jsonl` the local
   lines have `"model":"e4b"`, no folder.
8. **The tunnel** (your own, to the Mac mini, on another port in `local.address`): the same answers; Roamies starts
   and stops no server, and gives no notice about the port.
9. **The activity log**: `timing {route, hearing, ready, reading, voice, …}`, `memory {mb: {shell, sidecar, voice,
   kokoro, modelServer, webkit}, pressure, swapMB}`, `local_request`, `private_mode`; numbers and names only.
10. **Something else at the port.** With `local.start` set and Roamies' server stopped (`sleepAfterMinutes` passed,
    or Roamies quit and opened again), start another program on port 8080 (`python3 -m http.server 8080`), turn
    Wi-Fi off and ask anything.
    You should see: a notice, "Something else is answering at 127.0.0.1:8080, where Roamies starts its own local
    model …", and "The local model could not start, so nothing was sent."; no answer from it. Stop that program: the
    next request starts Roamies' own server as usual.

### Feature 14: Roamies reads files you name, and changes a note you name (in `next` since the review of 2026-11-27)

**Before.** Build from `roamies-read`. In `settings.json`: a project folder you don't mind Roamies reading, e.g.
`"projects": ["~/Documents/roamies-test-project"]` and `"project"` the same; `"files": true`, `"fileContents": "ask"`
(both the defaults). In that folder: `segment.py` with a line `threshold = 0.6`, `src/dataLoader.py`, and a `.env`
with `TOKEN=x`. In the vault, a note "Test plan" with a line `threshold 0.6`. Nothing of yours needs to be in either.

1. **Type "Read segment.py."**
   You should see: the bubble's tag "reading segment.py", no question, and an answer from its text.
2. **Type "What does the loader do?"**
   You should see: a bubble "Read this file?" with `~/Documents/roamies-test-project/src/dataLoader.py` and **Read
   it** / **Don't**. Click **Don't**: the answer says it wasn't read. Ask again and click **Read it**: it is read.
3. **Say "What does the loader do?" and let the bubble's answer window run out.**
   You should see: the question said, then nothing read and nothing kept.
4. **Type "Read the .env file in my test project."**
   You should see: Claude says it can't read it (passwords or keys); no question first.
5. **Type "Search my test project for threshold."**
   You should see: one bubble listing the files with matches ("Send the matching lines from…"). **Don't**: nothing
   from them is sent, not even their names. Again with "Search segment.py for threshold": its line comes back with no
   bubble.
6. **Type "What's in my test project?"**
   You should see: the names, folders ending in `/`, `.env` left out ("1 entry left out: blocked").
7. **Type "What left the Mac today?"**
   You should see: "File texts: N (M characters)." and "Note texts: …" with the rest. In `~/.gg/sidekick/logs`, the
   `file_tool` lines have numbers only: no path, file name or text.
8. **Say "Change Test plan: the threshold is 0.7."**
   You should see: a bubble "Change Test plan?" with `- threshold 0.6` and `+ threshold 0.7`, said aloud. Say "yes":
   nothing happens (the bubble stays). Say "save it": saved. In `~/Documents/roamies-pi/note-versions/` a file
   "Test plan <date> <time>.md" with the old text; in the daily note's Log "Edited: [[Test plan]]".
9. **Type "Change the plan: threshold 0.8."**
   You should see: Claude asks which note; no bubble, nothing changed (the title wasn't in your words).
10. **Type "Undo the last note edit."**
    You should see: "Put back Test plan as it was before the edit at HH:MM?" with the lines; **Save it** puts back
    `threshold 0.6`; a second version is kept in `note-versions`.
11. **Private mode and Wi-Fi off:** "Keep this private.", then "Read segment.py."
    You should see: the answer in a bubble tagged "local · private", from the file's text; the provider got nothing
    (the ledger's line for it says "this Mac").
12. **Set `"files": false`** and type "Read segment.py." You should see: Claude says file reading is off.
13. **A name of one word** (set `"files": true` again; put `plan.md` in the test project). Type "What's the plan for
    today?" You should see: no file read (Claude answers about your day, or a bubble "Read this file?" if it reaches
    for plan.md). Type "Read the plan." and then "What is in plan dot md?": each read with no bubble.
14. **Wi-Fi off, "Mark <a test to-do's whole title> as done."** You should see: the to-do marked done and the
    calendar's own line, at once, tagged "local"; in the activity log the `local_request` line has `"by":"code"` and
    `"steps":0` (no model call). The same with "Take <its title> off the calendar." once it has a block.

### Feature 40: find a file anywhere and show its folder (in `next` since the review of 2026-11-27)

**Before.** Build from `next`, with the hands helper built by `build.rs` (the `find` and `reveal` commands
are new). Make two throwaway files with a name nothing of yours has: `~/Desktop/roamies-findtest.txt` and
`~/Documents/roamies-findtest-2026.txt`, and a folder `~/Desktop/Roamies Findtest`. If you have an external drive,
`roamies-findtest-drive.txt` on it. Wait a minute so Spotlight has them. The defaults: `"findAnywhere": true`,
`"findDrives": true`, `"findLeaveOut": []`, `limits.findMatches` 8.

1. **Type "Find the file roamies findtest."**
   You should see: a card "found 3: roamies findtest" (4 with the drive) listing each with its folder
   (`~/Desktop`, `~/Documents`, the drive as "<drive name> › …"), the folder not among them (you asked for a file);
   the line "I found 3; the first two are … . Click one to show it in Finder." No reply from Claude.
2. **Click the second row.**
   You should see: Finder comes forward with that file selected; nothing opens. "Showing … in Finder."
3. **Say "Where is roamies-findtest dot txt?"**
   You should see and hear: "I found 2 (3): … and …. Which one should I show?", only the count and two names said, no
   folder. Say "the second one": that file shown in Finder, and "Showing it in Finder." said.
4. **Say "Which folder is roamies findtest in?" and say nothing.**
   You should see: the card with the files and the folder ("folder" beside its name); after the answer window runs
   out the bubble goes, the card stays and nothing is shown in Finder. Click the folder's row: Finder shows the folder
   selected in `~/Desktop`.
5. **Type "What is on my calendar today?"**
   You should see: the card goes; Claude answers as usual.
6. **Type "Where is roamies-nothing-like-this.pdf?"**
   You should see: "I found no file called "roamies-nothing-like-this.pdf". I look by name with Spotlight in your home
   folder and on your drives; hidden folders, ~/Library and the folders you excluded from Spotlight … aren't
   searched, …". No card.
7. **Type "Where is my lab meeting?" and "Find my keys."**
   You should see: Claude answers both as usual (not file searches).
8. **Move `~/Documents/roamies-findtest-2026.txt` to the Trash, then type "Find the file roamies findtest" and click
   that row if it is still listed** (Spotlight may still have it).
   You should see: "… isn't there any more." Then empty that one from the Trash.
9. **Wi-Fi off, and private mode:** "Keep this private.", then "Find the file roamies findtest."
   You should see: the same card and line, at once; the local model isn't asked (no "local" reply).
10. **Set `"findLeaveOut": ["~/Desktop"]`** and type "Find the file roamies findtest."
    You should see: only the one in Documents (and on the drive). Set it back to `[]`.
11. **Set `"findAnywhere": false`** and type "Where is roamies-findtest.txt?"
    You should see: Claude answers (the sentence went the usual way). Set it back to `true`.
12. **The record.** In `~/.gg/sidekick/logs`, the `find_file` and `find_pick` lines have numbers only (found, shown,
    left out, milliseconds; the row and voice or click): no "findtest", no name and no folder. "What left the Mac
    today?" shows no request for any of the searches. If macOS asked "Roamies would like to access files in your
    Documents folder" (or Desktop, or a removable volume) at any point, note which and when.

### Feature 34: masking (in `next` since the review of 2026-11-27)

**Before.** Build from `next`. Use throwaway words only, never real names: in `settings.json` set
`"mask": {"people": ["Zorbina Quell", "Mark"], "organisations": ["Fennick Labs"], "projects": ["Halyard"], "other": ["Quellium"]}`
and leave `"masking": true`. Then start Roamies (quit and open it again if it was running; the list itself is read at
each request, the start-up bubble only at start).

1. **The start-up bubble.**
   You should see: a line naming "Mark" as an everyday word, swapped in any case, with the `exactCase` hint. Quit and
   open Roamies again: the line doesn't come back (the list hasn't changed). Change `"Mark"` to
   `{"name": "Mark", "exactCase": true}`.
2. **Type "Note that Zorbina Quell from Fennick Labs wants the Halyard quellium figures by Friday."**
   You should see: Claude's reply with the real names, no "Person 1", "Organisation 1", "Project 1" or "Term 1"
   anywhere on screen; a note in the vault whose title and text have the real names.
3. **Say "What did I just note about Zorbina Quell?"**
   You should see and hear: the reply with the real names, said with them.
4. **Type "mark the figures as urgent, Mark said so."**
   You should see: an ordinary answer; nothing odd about "mark" (only "Mark" as written is on the list now).
5. **Ask for a hand-off that names a listed word, read only: "Ask pi to list the files in the Halyard folder."**
   You should see: "Send to pi?" (not "Asking pi in 5 s"), with "⚠ pi isn't masked: 1 word on your masking list is in
   this prompt." (a count, no word); it waits for you. Click Don't send.
6. **Web search.** On Claude's route (signed in with Claude) there is no web search: "Search the web for Fennick
   Labs." gets Claude's usual answer. Only with an API key: the line "Web search is off while your masking list has
   words in it, so nothing was searched or sent." and nothing more.
7. **Private mode:** "Keep this private.", then "What does Zorbina Quell want?", then "Back to Claude."
   You should see: the local reply (tagged) with the real name; the local model gets your words as they are.
8. **Change the list:** add `"Gorvane"` to `"other"`, save, and type "Gorvane is a new idea for Halyard; note it."
   You should see: the note and the reply with "Gorvane". This first request after a change starts Claude afresh with
   the conversation again: note roughly how long it takes compared with the request before.
9. **Type "What left the Mac today?"**
   You should see: "Private words swapped for stand-ins: N times in M requests (K swapped back)." among the lines.
10. **The claude program's transcripts.** In Terminal:
    `grep -rli -e zorbina -e fennick -e halyard -e quellium -e gorvane ~/.gg/claude-code/config/projects/`
    You should see: nothing from today after step 1 (a transcript from before the list was set may still name them;
    note its date). Then `grep -c mask_changed ~/.gg/sidekick/logs/*`: at least 1.
11. **What stays on the Mac.** `grep -li "zorbina quell" ~/.gg/sidekick/sessions/*.json` lists today's conversation
    (it is kept in your words), and `grep -l "Person 1" ~/.gg/sidekick/sessions/*.json` lists none of today's.
    `grep -i -e zorbina -e fennick -e halyard -e quellium ~/.gg/sidekick/logs/* ~/.gg/sidekick/ledger.jsonl` prints
    nothing.
12. **Off.** Set `"masking": false` and type "Who is Zorbina Quell?": an answer as before masking (the name goes as it
    is). Set it back to `true`, and when done, empty the list and delete the throwaway notes.

## Group 3: features 19 and 21

Not on `next` yet.

## Group 4: features 17, 28, 15, 20 and 27

Not on `next` yet.
