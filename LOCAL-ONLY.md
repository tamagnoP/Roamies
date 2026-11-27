# Local-only build, with file work handed to pi

This copy of Roamies is patched so that, while running, the only thing it sends anywhere is the conversation with
the AI provider you sign in to, and so that changing your files, or running anything, goes through pi (the pi coding
agent) after you approve it. Roamies reads files in your project folders itself, only when you ask (feature 14). Made against upstream commit `fa798b4` (app version 0.1.34), for macOS, with pi 1.5.0.

## What Roamies does itself

| It can | When |
| --- | --- |
| Look at the screen or a window | Only when your message refers to what's on screen |
| Open an app by name (Zotero, Inkscape) | Only when you name it. No websites, files or folders |
| Click and type in an app | Only when you ask, only in the app in front, and only with "Allow File Edits & Commands" on |
| Keep the to-do list and reminders | As before |
| Keep notes in your Obsidian vault | Writes only when you ask; can add to a note, and change one you name once you have seen the change and said save (the old version kept); never deletes one |
| Read, list, find and search files in your project folders | Only in a request you type or speak; a file's text goes to the model only when your words name the file or you say yes to a bubble naming it (feature 14) |
| Hand a task to pi | Read-only tasks after a short countdown you can stop; tasks that can edit only after you say send |

Upstream's file and command tools (`read_file`, `list_files`, `search_files`, `write_file`, `run_command`) and
`fetch_url` are removed. Roamies' own read-only file tools (`files.mjs`, feature 14) take the place of the first three,
with `find_files`; they write nothing and start no program (see "Reading your files"). The limits themselves are enforced in code: apps only, the front app only, the switch for
clicking and typing, and Send before anything reaches pi. Whether you asked for it (that you referred to your screen,
or named an app) is a rule in its instructions, which the model follows but the code can't check.

## Handing a task to pi

1. You ask Roamies for something that needs a file ("ask pi to explain segment.py").
2. A bubble shows exactly what will be sent, the folder, and the mode, with **Send** and **Don't send**. With spoken
   replies on, it is said too, briefly: what it is and the prompt's first sentence ("For pi, with editing allowed.
   Rename the helper in util.py. The rest is on screen. Say send to send it."). The whole prompt is in the bubble.
3. A task that can edit is sent only when you click Send, press Y, or say "send". A read-only task goes by itself
   after a few seconds (`autoSendReadOnly`), so you only act to stop it: click Don't send, or say "no". Starting to
   talk stops the countdown for good: from then on it is sent only by "send" or a click.
   What you say while the bubble is open is for the bubble. It is sent only when what you said is nothing but send
   words: one alone, repeated or combined ("yes, send it", "ok go ahead"), with "please" if you like. It is declined
   only when what you said is nothing but don't-send words ("no", "don't send it", "cancel", "stop", "never mind"),
   by the same rule. Anything else leaves the bubble open as it was, any number of times, and is not taken as a new
   request: a send word followed by other words ("OK, wait, change the prompt", "go back", "send it to the other
   project"), mixed ones ("yes no", "send, no wait"), and nothing heard.
   After a key press, filler words before or after the answer don't spoil it ("um, send it now", "and send it",
   "Jarvis, go ahead then"): `fillerWords` under `reference`. In the middle they still do ("send it and then stop").
   Heard hands-free, in an answer window (see "Conversation flow"), a task that can edit is sent only on "send" or
   "send it", said alone, with "please" if you like: no "ok", no "yes", no filler words. A read-only task takes
   the send words there, without filler words.
   What you said and wasn't taken is shown, not swallowed: the bubble's last line becomes `Heard "…". Say send or
   no.` until your next phrase or until the bubble closes. It is on screen only: not logged, not sent, not kept.
   A click is never judged by words: the first button sends and the other doesn't, whatever the buttons are called
   ("Send" or "Send now"). The same holds for the folder-change question and the Super Productivity bubbles. Both lists are under `reference`
   in `settings.default.json` (`sendWords`, `dontSendWords`).
4. pi starts in the background, in the project folder, as `pi --mode json`. What it's doing ("Pi's reading
   segment.py…") shows in a bubble, at most one every few seconds.
5. When pi finishes, Roamies tells you the gist in its own voice (with spoken replies on), and then pi's full reply,
   or its question back to you, goes on screen word for word. With text replies, the full reply is shown straight
   away. Your answer to a question goes back to the same pi session, after another Send.
6. While pi is working, Roamies can only talk, keep the to-do list and notes, or stop pi (say "stop pi", or Stop in
   the menu).
7. What is ended with pi. pi runs as the leader of its own process group. When pi finishes, when it is
   stopped, when it passes `maxMinutes`, and when Roamies quits, the whole group is asked to end and whatever is
   left of it after 2 seconds is killed. A hand-off counts as finished when pi itself exits, even if something it
   started is still holding its output open. If Roamies' own background process crashes, the group is killed as
   it goes; if that process is killed outright, a small watcher started beside each hand-off (`/bin/sh` with a
   fixed script, two process numbers and the hand-off's folder) does the same within about three seconds, then
   ends itself.
   **What pi's commands leave running** (the owner's plan of 2026-11-24, `leftovers.mjs`). pi's bash tool starts
   each command as the leader of a process group of its own, and something a command leaves running in the
   background (`sleep 600 &`) stays in that group, outside pi's. So a hand-off that can edit is started with a
   small extension of Roamies' (`pi -e …/roamies-leftovers.ts`), written with an empty record into a folder made
   for that hand-off in your temporary folder and removed after it. The extension puts pi's bash tool back in
   place with one line in front of every command: the shell appends its process number and the time to the
   record. pi's own bash tool is used, with pi's shell settings; the tool's name, description and results, the
   command as pi shows and keeps it (its events, its session file) and pi's system prompt are unchanged, so the
   model is not told of the line or the record. The record is append-only (`chflags uappnd`), and the sandbox lets
   pi write that one file and nothing else in the folder, nor take the flag off. "Read only" hand-offs get no
   extension: they have no bash tool.
   When pi stops, whichever of the ways above, every recorded group still there is asked to end, and what is
   left after 2 seconds is killed. Before that, Roamies runs `/bin/ps -x -o pid=,pgid=,etime=`: your processes'
   numbers, groups and running times only, never their environment or their commands. A recorded number that now
   belongs to a process started at another time was reused by the system, and that group is left alone. The list
   is read in memory and dropped; it is never logged or kept. The activity log has `pi_leftovers` with the count
   only, and the reply on screen ends with a line when any were ended ("Pi's commands had left 1 process running.
   I ended it."). This always happens; there is no setting. With spoken replies on, that line (or the one below)
   is also said, worded by code: after "Stopped pi." when pi was stopped, and after Roamies has said the gist of a
   reply that came back or hit a problem, once the gist has finished playing (and an answer window it opened has
   closed). The model is never given it: the gist is made from pi's reply alone.
   If pi can't load the extension (it then stops before doing anything) it is started again without it, and if
   its bash tool has no `spawnHook` the extension leaves it as it is; either way the hand-off runs, the reply ends
   with "Pi ran without the extension that lets me end what its commands leave running, so anything they left
   running may still be running.", and the log has `pi_leftovers_off`.
   **Not caught:** Docker containers (Docker runs them, not the command); a process that moves itself to a new
   process group or session (`setsid`, `nohup` with `setsid`, a daemon that detaches). macOS only.
   **What the record lets pi do.** pi's commands can append to the record, so a command could name a group that
   is not pi's, with a start time that matches, and Roamies would end it. That gives pi nothing new: the sandbox
   (`(allow default)`, with no `signal` rule) already lets pi's commands send any signal to any of your
   processes, Roamies' included, and read the process list with each process's start time. `/bin/ps` itself
   doesn't run inside the sandbox (below), but `pgrep` and the system call `ps` reads the list with do. The record
   only lets them ask Roamies to do what they can do themselves.

**Modes.** "Read only" starts pi with `--tools read,grep,find,ls`, so it cannot change anything. "Can edit" starts
it with its normal tools (read, bash, edit, write). The mode is in the Send bubble.

**pi runs as it does in Terminal, inside a sandbox**: same sign-in, same `~/.pi/agent` settings, rules and
packages, started through your login shell so `pi` and `node` are found. The model and thinking level are whatever pi's own settings say.

## The sandbox pi runs in

Every hand-off starts pi under a macOS sandbox (`sandbox-exec`), with a profile Roamies builds from the project
folder and your settings. The limits are enforced by the system on pi, on its login shell, and on every command
they start, whatever pi's instructions or the model say. The Send bubble says so in one line: "Sandboxed: pi can
read 3 folders and write only in this project." (the count is the project, your other `projects` and `readOnly`).

**What pi can write.** Only:

- the project it was started in, with everything beneath it;
- temporary folders (`/tmp`, `/var/tmp`, and your own temporary and cache folders under `/var/folders`);
- in its own folder, `~/.pi/agent`: its session files (`sessions`), its sign-in (`auth.json`, which it rewrites
  when a token is refreshed), and the three locks it takes while it reads its files (`auth.json.lock`,
  `settings.json.lock`, `trust.json.lock`). A lock is an empty folder pi makes and removes; without the trust lock
  pi doesn't start, and without the settings lock it ignores its own settings.

Not its instructions (`SYSTEM.md`, `APPEND_SYSTEM.md`), templates, skills, packages, extensions, tools (`bin`),
settings or trust files; not your other projects; not a `readOnly` folder. A `readOnly` folder or another project
that sits inside the current project stays unwritable.

**What pi can read.** Outside your home folder, everything it could before: the system, Homebrew, conda, Node, and
pi's own installation, but not external drives (below). Inside your home folder, nothing except:

- the current project, the other folders under `projects`, and the folders under `readOnly`;
- its own folder, `~/.pi`;
- what the shell and git read on the way to starting it (`~/.bash_profile`, `~/.bashrc`, `~/.bash_login`,
  `~/.profile`, `~/.zshenv`, `~/.zprofile`, `~/.zshrc`, `~/.zlogin`, `~/.gitconfig`);
- the tool folders: `~/.anaconda`, `~/.conda`, `~/.condarc`, `~/.continuum`, `~/.cargo`, `~/.local`, `~/.npm`,
  `~/.cache/huggingface`, `~/.cache/uv`, `~/.cache/fontconfig`, `~/.cache/tree-sitter`, `~/.cache/chroma`,
  `~/.cellpose`, `~/.matplotlib`, `~/.ipython`, `~/.jupyter`, `~/.duckdb`, `~/.config/git`, `~/.config/rstudio`,
  `~/Library/Jupyter`, `~/Library/Fonts`, `~/Library/Caches/pip`, plus any you add with `toolFolders`, minus any
  you drop with `toolFoldersOff`;
- the folder the `pi` setting points into, when it is a full path.

So Documents, Desktop, Downloads, Pictures, Movies, Music, cloud-synced folders (`~/Library/CloudStorage`, and the
links to it such as `~/gdrive`), the rest of `~/Library`, shell histories and every other folder in your home are
unreadable unless you list them. A listed folder includes everything beneath it, and may be a link to a folder.

**External drives.** Nothing under `/Volumes` can be read or listed, except a folder there that you list under
`projects` or `readOnly` (or `toolFolders`), with everything beneath it. The folders above a listed one can be seen
to exist, so its path can be walked, but not listed or read. The startup disk also appears under `/Volumes`, as a
link (`/Volumes/Macintosh HD`): a path written through that link keeps working, under the same rules as the path
without it. A folder on an external drive can be listed and read, but the current project still has to be inside
your home folder.

**Always blocked**, for reading and writing, even inside a folder you listed:

- `~/Documents/roamies-pi/settings.json`, `settings.default.json`, `state.json` and the hand-off records in `log`;
- `~/.ssh`, `~/.gnupg`, `~/.gg`, `~/.claude`, the keychains (`~/Library/Keychains`, `/Library/Keychains`);
- `~/Library/Application Support/superProductivity`;
- `~/.config/gh`, the Hugging Face token (`~/.cache/huggingface/token`, `stored_tokens`), and OrbStack's keys and
  configuration (`~/.orbstack/ssh`, `~/.orbstack/config`);
- cargo's and git's saved sign-ins (`~/.cargo/credentials.toml`, `~/.cargo/credentials`,
  `~/.config/git/credentials`), which sit inside readable tool folders.

**Also denied:** running `/usr/bin/security`, `/usr/bin/osascript` and `/usr/bin/open`, and sending Apple Events,
so pi can't ask the keychain for a password or ask another app to act for it.

**Docker and OrbStack.** A container can mount any folder on the Mac, so reaching Docker is a way out of every
rule above. It is denied by default: pi can't connect to the Docker or OrbStack sockets
(`~/.orbstack/run`, `~/.docker/run`, `/var/run/docker.sock`). List a project under `docker` to allow it there; pi
can then also read `~/.docker`, `~/.orbstack/bin`, `~/.orbstack/run` and `~/.orbstack/shell` (so the line in your
`~/.bash_profile` that loads OrbStack's shell setup works there), and the Send bubble adds "Docker allowed:
containers can reach folders outside this project." **A project with Docker allowed is not fully confined**: what
pi does through a container happens outside the sandbox, with OrbStack's access to your files, not pi's.
`~/.docker/config.json` is where `docker login` keeps registry credentials, and becomes readable there.

**When it isn't on.** With `"sandbox": false` the bubble says "⚠ Sandbox is off: pi is not confined." If the
sandbox can't be applied (Roamies tries the profile before showing the bubble), the bubble says "⚠ The sandbox
could not be applied (…). If you send, pi runs unconfined.", and a read-only hand-off does not send itself: nothing
runs until you click Send. Each hand-off's record says `"sandbox": "on"`, `"off"` or `"not applied"`.

**What breaks inside it, and what it doesn't cover.**

- Installs fail: `pip install`, `conda install`, `npm install -g`, `brew install`, `uv` and anything else that
  writes outside the project or to a cache in your home folder (`~/.npm`, `~/.cache`, `~/Library/Caches`). Do
  installs yourself in Terminal. `npm install` inside a project needs its cache in `~/.npm`, which pi can't write.
- pi can't refresh its saved model catalogue (`~/.pi/agent/models-store.json`); it carries on with the one it has.
  Running pi in Terminal refreshes it.
- Programs that run with another user's rights (`sudo`, `ps`, `top`) don't run inside a sandbox.
- A line in your `~/.bash_profile` that reads a file from a folder pi can't read is skipped with an error the
  shell ignores. OrbStack's `~/.orbstack/shell` is one, in every project not listed under `docker`.
- Tools that put themselves in a sandbox fail, because a sandbox can't be started inside one: `swift build`
  and `xcodebuild`, for example.
- `git push` over SSH fails (no `~/.ssh`). The keychain service itself is not blocked, only the `security`
  command and the keychain files, so a program that asks the keychain directly (git's saved HTTPS passwords) still
  can.
- pi looks for `AGENTS.md` and `CLAUDE.md` in every folder above the project. Ones in folders you haven't listed
  are not loaded, and pi prints a warning for each that exists.
- The network is not limited: pi reaches its provider as before, and a command it runs can reach any server.
  Limit that outside this app if you need to.
- It limits files, three programs, Apple Events and Docker. It does not stop pi from talking to other services
  running on your Mac that listen on a local port or socket.
- Inside the project pi can change anything, including `.git`; the undo snapshot is what protects that.
- `sandbox-exec` is Apple's own tool but Apple calls it deprecated. If a macOS update removes it, hand-offs stop
  being sent by themselves and the bubble tells you, as above.

## The roamies-pi folder

`~/Documents/roamies-pi/` is made the first time it's needed.

`settings.json` is yours alone. Roamies makes it once, with the defaults, when it doesn't exist, and never writes it
again: it only reads it. What Roamies needs to remember goes in `state.json` (below).

**No setting has a value you can't see.** Each time Roamies starts it writes `settings.default.json` beside
`settings.json`:

- every setting with its default, under the same names, so a line can be copied into `settings.json`;
- under `reference`, what is fixed in the app and can't be changed from settings: the sandbox's lists (built-in tool
  folders, blocked folders and files, start-up files, what pi may write in its own folder, the programs it can't
  run, the external drives folder, the Docker paths, what is always readable and writable), the allowed range of
  each limit, the tools taken out and the ones that work while pi is busy, the words that count as "send", the
  corner names and home margins, the file names in this folder, and the voice program and sample rate.

Roamies never reads that file: editing it changes nothing, and it is replaced at the next start. It is readable by
you only, and pi can't read it.

If `settings.json` lacks a setting, Roamies uses the default and says so once per start, in a bubble, for as long as
it is missing: "settings.json doesn't have: home, limits. I'm using the values in settings.default.json until you
add them." A value it can't use gets its own line: "settings.json has a value I can't use for: maxMinutes. I'm
using 60." In a list (`readOnly`, `projects`, `routines` and the like) the entries it can use are kept, the others
left out, and the line says what is used. Two settings fall back to the safe side: anything but `true` or `false`
for `sandbox` leaves the sandbox on, and a `neverLook` that isn't a list of names means the built-in list. If the
setup guide is open, the bubble waits until it closes.

`settings.json`:

```json
{
  "project": "~/Documents/roamies-pi/workspace",
  "projects": ["~/Documents/roamies-pi/workspace", "~/Documents/cell-segmentation"],
  "pi": "pi",
  "maxMinutes": 60,
  "keepLogsDays": 30,
  "autoSendReadOnly": 5,
  "progressSeconds": 90,
  "routines": { "start a research session": ["open Zotero", "switch project to cell-segmentation", "ask pi to read TODO.md and tell me where I left off"] },
  "briefings": { "morning": "09:00", "evening": "18:30" },
  "neverLook": ["1Password", "Bitwarden", "KeePassXC", "Keychain Access", "Passwords", "Messages"],
  "sandbox": true,
  "readOnly": ["~/Documents/papers"],
  "toolFolders": ["~/.streamlit"],
  "toolFoldersOff": ["~/.npm"],
  "docker": ["~/Documents/cell-segmentation"],
  "home": "bottom-left",
  "voice": "",
  "voices": { "jarvis": "Daniel (Enhanced)" },
  "vault": "~/Documents/roamies-vault",
  "dailyFolder": "Daily",
  "autoListenQuestions": true,
  "closingReply": "Any time.",
  "speakNotices": true,
  "measurePageRebuild": false,
  "voiceEngine": "kokoro",
  "kokoro": { "python": "/opt/homebrew/anaconda3/envs/localai/bin/python", "model": "mlx-community/Kokoro-82M-bf16",
              "voice": "bm_george", "lang": "b", "speed": 1.05, "cacheMB": 0, "memoryMB": 400,
              "sleepAfterMinutes": 0 },
  "persona": { "name": "Jarvis", "address": "sir", "manner": "calm, precise, formally polite, loyal",
               "humour": "dry and rare", "maxSentences": 2,
               "beats": ["One moment, sir.", "Checking now, sir.", "Right away, sir."],
               "addressEverySeconds": 180 },
  "standDown": { "phrase": "stand down", "shortcut": "Control+Alt+Period", "endsAtDayTurn": true, "waitSeconds": 1.5 },
  "limits": {
    "approvalBubbleChars": 600,
    "promptChars": 8000,
    "piReplyChars": 3000,
    "stepBubbleSeconds": 4,
    "answerWaitMinutes": 10,
    "gitTimeoutSeconds": 30,
    "morningBriefingWindowHours": 4,
    "snapshotMaxFileMB": 2,
    "snapshotMaxFiles": 5000,
    "routinesShown": 12,
    "noteMaxChars": 20000,
    "notesSearched": 5000,
    "noteTitleOnlyBytes": 300000,
    "frontLookupMs": 900,
    "frontReuseSeconds": 8,
    "calendarTimeoutSeconds": 20,
    "answerWindowSeconds": 10,
    "exchangeEndSeconds": 20,
    "pendingKeepHours": 24,
    "spokenQuestionChars": 200,
    "heardLineChars": 80,
    "kokoroTimeoutSeconds": 20,
    "historyTokens": 40000,
    "kokoroSentenceChars": 120,
    "openItemAskDays": 7,
    "reviewQuestions": 3,
    "pageRebuildQuietMinutes": 15
  },
  "calendar": { "dayStart": "09:00", "dayEnd": "18:00", "lunch": ["12:30", "13:30"], "gapMinutes": 0, "syncSeconds": 60,
                "dayTurnsAt": "04:00", "reviewAt": "18:00" }
}
```

- `project`: the folder pi starts in (its working directory), until you tell Roamies to switch (see `projects`). The
  default is the `workspace` folder inside `roamies-pi`. The `roamies-pi` folder itself, or any folder that contains it, can't be a project, so pi is never
  started where it could rewrite these settings; a settings file that still names it means `workspace`.
- `projects`: the folders you can switch between by telling Roamies ("work on cell-segmentation"). The default is an
  empty list: the current project is always on it, whatever it holds. Each is named by
  its last part; write `{"name": "folder"}` instead of a list to choose the names. Only you add to this list: Roamies
  can switch between listed projects, after a yes, and nothing more. A switch is remembered in `state.json`, not
  here. It holds while that folder is still in this list and you haven't changed `project` since the switch: edit
  `project` by hand and your value wins. Deleting `state.json` also puts pi back in `project`. A project must be a folder inside your home
  folder.
- `pi`: the command that starts pi. If Roamies says it couldn't start pi, put the full path here (run `which pi`).
- `maxMinutes`: a task running longer than this is stopped.
- `keepLogsDays`: hand-off records older than this are deleted when a new hand-off starts. `0` keeps them all.
- `autoSendReadOnly`: seconds before a read-only hand-off sends itself. `0` makes every hand-off wait for Send.
- `progressSeconds`: on a long task, how often Roamies says pi is still working (spoken replies only). `0` is never.
- `routines`: phrases that run a list of steps. Say the phrase and Roamies does each step in order with its usual
  tools, rules and confirmations, stopping at the first one that fails or is refused.
- `briefings`: times, as `"HH:MM"`, for a morning rundown (your to-dos, and what pi was asked yesterday) and an
  end-of-day summary (what pi was asked that day; since feature 18 it writes no note: the daily note replaces the
  "Daily log <date>" notes, which stay as they are). Feature 18: the morning one writes the day's Plan, counts the
  to-dos that need a new time (without naming them) and is followed by the questions about them; the evening one
  first writes the day's review when there is a review time and today has none yet. Each is given once a day, when Roamies is idle: the
  morning one within four hours of its time (`limits.morningBriefingWindowHours`), the evening one any time after it. Leave a time out to switch it off.
- `sandbox`: `true` unless you write `false`. Switch it off only if it breaks pi; the Send bubble then warns on
  every hand-off (see "The sandbox pi runs in").
- `readOnly`: folders pi may read but never write, in every project. Default: none.
- `toolFolders`: more folders (or single files) that tools need to read, added to the built-in list in "The
  sandbox pi runs in". pi can read them, never write them. Default: none added.
- `toolFoldersOff`: built-in tool folders to take off that list, written as they appear there (`"~/.npm"`).
- `docker`: the projects in which pi may reach Docker and OrbStack. Default: none. A project listed here is not
  fully confined.
- These five are read from this file only, which pi can neither read nor write. A file from before they existed
  works as if it had the defaults, and the start-up bubble names what it lacks.
- `home`: where the character rests on the desktop in its default and small sizes (see "Where the character
  sits"): `"bottom-left"`, `"bottom-right"`, `"top-left"`, `"top-right"`, or a point such as
  `{ "x": 300, "y": 700 }` in screen points, counted from the top-left corner of the main display. Default
  `"bottom-left"`; anything else written there means the default. An edit shows from your next request.
- `neverLook`: apps Roamies never screenshots, reads or works in (see Safeguards). `[]` switches the check off.
- `vault`: the Obsidian vault Roamies keeps notes in (see below). It must be a folder inside your home folder.
- `dailyFolder`: the folder in the vault for the daily notes (see "The daily note"). Default `"Daily"`. One plain
  folder name: no slash, not starting with a dot.
- `voice`: the Mac voice every character speaks in; `""` means the system voice.
- `voices`: a voice per character, which wins over `voice`. The characters are `classic` (Roamie), `jarvis`, `anime`,
  `sarah` and `adrian`. If you leave `voices` out, JARVIS speaks as `Daniel` (British English).
- `autoListenQuestions`: `true` or `false`. With Auto Listen on, whether the microphone opens after a reply of
  Roamies' own that ends in a question. `false` switches that off; the answer windows of bubbles are not affected.
- `closingReply`: what Roamies says when you end an exchange with a closing phrase ("thanks"). The default is
  "Any time.".
- `speakNotices`: `true` or `false`. Whether a notice from a sync (something Roamies did or lost for you: a kept
  block placed or dropped, a conflict resolved, a task deleted in the app) is said as well as shown when you are
  not in a spoken exchange. `false` leaves those bubbles silent there. Inside an exchange everything shown is said
  either way.
- `files`: `true` or `false` (`true` unless you set it). `false` turns Roamies' own file reading off: each file tool
  then says so and reads nothing (see "Reading your files").
- `fileContents`: `"ask"` (the default) or `"free"`. With `"ask"`, a file's text goes to a model only when your own
  words in that request name the file, or you said yes to a bubble naming exactly the files. With `"free"`, any read
  in a request you typed or spoke.
- `measurePageRebuild`: `true` or `false` (`false` unless you set it). With `true`, each fresh page after a quiet
  stretch (see "Where the character sits") is measured, numbers only, into the activity log
  (`~/.gg/sidekick/logs`) as `rebuild_measure` lines: from the moment it is asked for until 6 seconds after the old
  page has gone, both windows' position, size and visibility and their events (made, moved, resized, focus, close,
  gone), the character's drawn position in every frame on both pages, each page's size and screen edges, the
  messages each page gets (their kind only), and every change of the character's home spot with what changed
  (width, height, an edge, its radius, the setting). Times are milliseconds since 1970, positions screen points or
  the page's own pixels. Nothing else is recorded and nothing leaves the Mac.
- `voiceEngine`: `"kokoro"` (the natural voice, see "The voice") or `"system"` (the Mac's own voice; no Python is
  started). Read when Roamies starts.
- `kokoro`: for the natural voice. Each part that is missing or can't be used takes its default and is named in the
  start-up bubble.

  | Part | Default | Allowed | What it is |
  | --- | --- | --- | --- |
  | `python` | `/opt/homebrew/anaconda3/envs/localai/bin/python` | a full path to a program that exists | The Python that has `mlx_audio`. Anything else (a bare name, a path with `~`, a folder, a file that can't be run): a bubble says so and the Mac's voice speaks. Read at start. |
  | `model` | `mlx-community/Kokoro-82M-bf16` | a name as downloaded (`owner/name`), or a folder | The model, which must already be on the Mac. Read at start. |
  | `voice` | `bm_george` | a voice that ships with the model | Read for each reply. |
  | `lang` | `b` | one letter | The model's language letter. Read at start. |
  | `speed` | 1.05 | 0.5 to 2 | 1 is the voice's own pace. Read for each reply. |
  | `cacheMB` | 0 | 0 to 16384, whole | MB of freed memory MLX keeps for reuse while it makes a sentence. 0: none. Read at start. |
  | `memoryMB` | 400 | 100 to 16384, whole | MB MLX aims to stay under while it makes a sentence. It goes over when one step needs more. Below about 400 sentences take longer and the helper gets no smaller. Read at start. |
  | `sleepAfterMinutes` | 0 | 0 to 1440, whole | Quiet minutes after which the helper is ended to give its memory back (see "The voice"). 0: never. Read at each check. |
- `persona`: how Roamies speaks (see "The manner"). It changes nothing about what Roamies may do. Read for each
  request, so an edit counts from the next one. Each part that is missing or can't be used takes its default and is
  named in the start-up bubble.

  | Part | Default | Allowed | What it is |
  | --- | --- | --- | --- |
  | `name` | `Jarvis` | up to 40 characters | The name the model is given for itself. Menus and labels still say the look's name. |
  | `address` | `sir` | up to 30 letters, or `""` for none | How you are addressed. |
  | `manner` | `calm, precise, formally polite, loyal` | up to 200 characters | A description of the tone, given to the model in quotation marks. |
  | `humour` | `dry and rare` | up to 100 characters | The same, for humour. |
  | `maxSentences` | 2 | 1 to 5, whole | The longest reply, unless you ask for an explanation, a list or a story. |
  | `beats` | `["One moment, sir.", "Checking now, sir.", "Right away, sir."]` | 1 to 40 lines of up to 60 characters | The short lines said before something slow. One is picked by code; no request is made for it. Said without the form of address unless `addressEverySeconds` is 0. |
  | `addressEverySeconds` | 180 | 0 to 86400, whole | The form of address is used at most once in this many seconds, by the app's lines and the model's replies together. 0: every time. |
- `limits`: the sizes, times and counts. Each is a number in the range below; one that is missing or outside its
  range uses its default and is named in the start-up bubble. Leaving `limits` out altogether counts as one missing
  setting. An edit counts from the next request, except `answerWaitMinutes`, which is read when Roamies starts.

  | Limit | Default | Allowed | What it is |
  | --- | --- | --- | --- |
  | `approvalBubbleChars` | 600 | 200 to 5000, whole | Characters of a prompt the Send bubble shows; a longer one is also saved whole to `pending.txt`. |
  | `promptChars` | 8000 | 500 to 100000, whole | The longest prompt that can be handed to pi. |
  | `piReplyChars` | 3000 | 200 to 50000, whole | Characters of pi's last reply Roamies' own model is given. |
  | `stepBubbleSeconds` | 4 | 0.5 to 60 | Seconds between the bubbles that show pi's steps. |
  | `answerWaitMinutes` | 10 | 1 to 120 | Minutes a Send bubble waits for your answer. |
  | `gitTimeoutSeconds` | 30 | 5 to 600 | Seconds each git command of an undo snapshot may take. |
  | `morningBriefingWindowHours` | 4 | 0.25 to 24 | Hours after its time that the morning briefing is still given. |
  | `snapshotMaxFileMB` | 2 | 0.1 to 100 | A new file bigger than this is left out of an undo snapshot. |
  | `snapshotMaxFiles` | 5000 | 1 to 100000, whole | New files in one undo snapshot. |
  | `routinesShown` | 12 | 1 to 100, whole | Routines the model is told about. |
  | `noteMaxChars` | 20000 | 1000 to 1000000, whole | Characters of a note written or read in one go. |
  | `notesSearched` | 5000 | 10 to 100000, whole | Notes looked through in a search. |
  | `noteTitleOnlyBytes` | 300000 | 1000 to 10000000, whole | A note bigger than this is searched by its title only. |
  | `frontLookupMs` | 900 | 100 to 5000, whole | Milliseconds the look-up of the app in front may take. |
  | `frontReuseSeconds` | 8 | 1 to 60 | Seconds the look-up made when you stop talking stays good. |
  | `calendarTimeoutSeconds` | 20 | 2 to 60 | Seconds each request to Super Productivity may take. The check that the app is there at all always gives up after 1 second. |
  | `answerWindowSeconds` | 10 | 3 to 30 | Seconds the microphone stays open by itself after Roamies has asked something. |
  | `exchangeEndSeconds` | 20 | 5 to 600 | Quiet seconds after Roamies' last reply that end an exchange. |
  | `pendingKeepHours` | 24 | 1 to 720 | Hours a question nobody answered is kept before it is dropped. |
  | `spokenQuestionChars` | 200 | 40 to 1000, whole | Characters of a question, or of a hand-off's first sentence, that are said aloud. |
  | `heardLineChars` | 80 | 20 to 300, whole | Characters of a phrase that wasn't taken, as shown in the bubble's last line. |
  | `kokoroTimeoutSeconds` | 20 | 2 to 120 | Seconds the natural voice may take over one sentence (six times that to start) before the Mac's voice takes over for the session. |
  | `historyTokens` | 40000 | 20000 to 500000, whole | Tokens sent in one request at which the older part of the conversation is folded into a summary (see "What goes with each request"). Never later than three quarters of what a request may hold. |
  | `kokoroSentenceChars` | 120 | 40 to 1000, whole | A sentence longer than this is split at a clause before the natural voice makes it. |
  | `openItemAskDays` | 7 | 1 to 60, whole | Days an open item stays open before the evening review asks whether to keep it or let it go (see "The daily note"). |
  | `reviewQuestions` | 3 | 1 to 20, whole | The most to-dos the daily note's questions ask about each time, oldest first (see "The daily note"). |
  | `pageRebuildQuietMinutes` | 15 | 0 to 1440, whole; 0 is never | Quiet minutes after which the overlay page is made afresh (see "Where the character sits"). |
  | `fileReadChars` | 20000 | 1000 to 100000, whole | Characters of a file in one read; the rest comes in further parts (feature 14). |
  | `fileListEntries` | 300 | 20 to 2000, whole | Entries in one listing of a folder. |
  | `fileSearchFiles` | 2000 | 100 to 20000, whole | Files looked through in one search or find. |
  | `fileSearchBytes` | 1000000 | 10000 to 20000000, whole | A larger file is skipped by a search. |
  | `fileMatches` | 50 | 5 to 500, whole | Matching lines, or files found, given back by one search or find. |
  | `filesPerRequest` | 10 | 1 to 50, whole | Reads (a part of a file, or a search's lines) in one request. |
  | `localFileChars` | 6000 | 1000 to 20000, whole | Characters of a file in one read on the local model's route. |
  | `noteEditLines` | 40 | 5 to 200, whole | Changed lines a note edit's bubble shows before "and N more lines". |
- `calendar`: for the to-do list in Super Productivity (see "To-dos in Super Productivity"). Each part that is missing
  or can't be used takes its default and is named in the start-up bubble; leaving `calendar` out counts as one
  missing setting.

  | Part | Default | Allowed | What it is |
  | --- | --- | --- | --- |
  | `dayStart` | "09:00" | a time, before `dayEnd` | Where a day plan starts. |
  | `dayEnd` | "18:00" | a time, after `dayStart` | Where a day plan ends. Also the time given to a deadline in the app that has a day but no time. |
  | `lunch` | ["12:30", "13:30"] | two times in order, or `[]` or `null` | The break a day plan keeps free; `[]` or `null` means no break. |
  | `gapMinutes` | 0 | 0 to 240, whole | Minutes left between blocks in a day plan. |
  | `syncSeconds` | 60 | 15 to 3600 | How often the to-do list is synced with Super Productivity. |
  | `dayTurnsAt` | "04:00" | a time, not after `dayStart` | When one day's daily note ends and the next one's starts (see "The daily note"). Before it, it is still the day before. |
  | `reviewAt` | `dayEnd`'s value | a time, or `""` | When the day's review is written and said. `""`: only when you ask for it. Left out, it is `dayEnd`'s value. |

`settings.default.json`: the reference described above. Written by Roamies at every start, never read by it.

`log/`: one `.jsonl` file per hand-off, named by date, time and mode. The first line is what was sent (prompt,
folder, mode, whether you approved by click or by voice, and the undo snapshot if there is one), then pi's events as
it emitted them (without the letter-by-letter streaming updates), then the result. Records older than `keepLogsDays`
are deleted.

`state.json`: Roamies' own memory, which it writes itself: the project you last switched to (with what `project` was at
that moment, so a later edit of yours is noticed), the days the
briefings were given, under `pending` the questions nobody answered (see "Conversation flow"; a pending hand-off's
prompt is kept there as plain text), and under `calendar` which to-do goes with which Super Productivity task, with the values both
had after the last sync, and under `standDown` whether Roamies is stood down and what it has to say when that ends
(see "Standing down"). Deleting it is safe for the first two, and forgets the pending questions; without `calendar`, Roamies no longer knows which
tasks are its own: it asks again before putting the list in the app, and the tasks already there would be made a
second time.

`pending.txt`: appears only while a Send bubble is open for a prompt too long to fit in it, and holds the whole
prompt.

`note-versions/` (feature 14): the version of each note from before Roamies changed it, with the vault's folders
below it, named `<title> <YYYY-MM-DD HHMM>.md`. Roamies never deletes one; you may. `state.json` remembers the last 50
edits under `noteEdits`, for "undo the last note edit".

## Where the character sits

In its default and small sizes the character has a home: one fixed spot on the desktop, set by `home` in
`settings.json`, where it is on screen all the time. Upstream's character was hidden until needed, popped up beside
the pointer, followed it, and hopped out of its way; in these two sizes it now does none of that.

- **It stays at home.** It doesn't hide when idle, come over to the pointer, follow it, or step aside when the
  pointer comes near. Replies, questions, the listening bubble, the Send bubble and the task tag all open beside it
  there, whole on the screen.
- **It leaves only to point something out**: while it draws or explains on screen, and while it works in another
  app for you, it turns into its small pointer and goes where that is. When that ends it goes back home and to its
  own size. A drawing cut short (Esc, a new request) sends it home too.
- **Dragging** moves it, and it stays where you drop it, also while it talks. It goes back home after its next
  drawing, pointing or work in another app, when Roamies is restarted, or when the overlay changes display. A drag
  never changes the setting.
- **Dock and menu bar.** A corner is a corner of the visible desktop: inside the Dock, wherever it is, and under
  the menu bar. A point that falls under either, or off the screen, is moved the least it takes to keep the whole
  character visible. When the Dock moves or changes size, so does home.
- **Displays.** There is one overlay, and it moves to the display your pointer is on when you ask for something, as
  before. The character rests at the home corner of whichever display the overlay is on. A point is in screen
  points across all displays; when the overlay is on a display that doesn't contain it, the character rests at the
  nearest edge of that display.
- **Clicks.** Only the character takes clicks, so it can be dragged: a circle around its centre, 165 points across
  in the default size and 83 in the small one, a little wider than the body you see. A click or scroll there
  doesn't reach what is underneath. Everything else on the desktop is clicked straight through, as before, and so
  is the character itself while it is pointing something out.
- **At rest nothing runs.** Once it has been still at home for a second, the page stops drawing altogether: no
  frames, no animation, and its eyes look straight ahead rather than at the pointer. So at rest it doesn't blink,
  and JARVIS doesn't turn. It doesn't doze off, yawn or snore, and plays no idle gestures of its own. It starts
  again for a message from Roamies, the pointer on its body, a change of Dock or display, and stops again when it is
  still. What keeps running is what ran before while it was hidden: the app reading the pointer's position, which is
  how it knows a click is on the character, and a check every 150 ms of whether Esc should be held.
- **A fresh page after a quiet stretch.** WebKit keeps memory the overlay page has finished with until macOS asks
  for it, and the page cannot give it back itself; a new page starts at about 72 MB. So once
  `limits.pageRebuildQuietMinutes` (15) have passed with all of these holding, the page is made afresh: the
  character is at rest at its home (not where you dragged it, not sent away), nothing is on screen (no bubble,
  card, drawing, list or field), nothing is being said or heard, no question is on screen or waiting for its answer
  in an answer window, nothing is being made, and nothing is waiting to be shown; and something was shown or
  spoken since the last time. The new page is made beside the old one, on the same display; the character appears
  in it at its home spot at once, with no entrance, sound or greeting, and JARVIS's globe turned as it was. The spot
  is worked out from the page's newest size, screen edges and character size (before 2026-11-25 it could use the
  default size's radius for one frame and then glide to the small size's spot), and for 3 seconds a change of the
  spot moves it there at once rather than gliding. The old page goes once the new page reports that it has drawn
  the character on screen (and where), or 10 seconds after the new page has its settings if it never does; before
  2026-11-25 it went half a second after the settings. Anything for the overlay that comes meanwhile (a bubble, a notice, the listening bubble) is
  held by the app and shown on the new page once it is ready; if the new page doesn't report ready within 10
  seconds, it is handed over then. 0 switches this off. The log has `page_rebuild` and `page_rebuilt` (with the
  milliseconds it took), sizes only. A question kept in `state.json` for later does not hold it off: it is asked
  again as before, at the end of your next exchange, on the new page.
- **Esc** is held from other apps only while there is something to stop or close, not while the character just
  rests. Esc closes what it is saying; it no longer sends the character away.
- **The show/hide key** (⌃⌥S unless you changed it) still sends it away and brings it back; "Show …" in the menu
  brings it back too. Sent away, it also comes back for the next thing it has to say.
- **Voice.** While you talk, the voice bars show beside the pointer as before; the answer appears at home.
- **Type to ask** opens beside the pointer, as before.
- **The cursor size** is unchanged: hidden until needed, beside the pointer, following it.
- **Screenshots.** Nothing changes about when the screen is captured. Screenshots of the whole screen leave every
  Roamies window out (macOS 14 and later), and a screenshot of a window shows only that window, so the character at
  home is in neither. "Ask About an Area" uses macOS's own crosshair, which captures what you see: if the area you
  drag includes the character, it is in the picture.

## Talking with it

- **Answering without a key.** With "Auto Listen" on (the menu, or the panel's Voice page), the microphone opens by
  itself after a reply of Roamies' own that ends in a question. That includes questions pi sends back: Roamies ends
  its spoken gist with pi's question and listens for your answer. It is bounded like the answer window below: it
  opens only when the reply has finished playing, lasts `limits.answerWindowSeconds`, and closes by the same three
  stops. What you say goes to the model as your answer. `"autoListenQuestions": false` switches it off.
- **Long tasks.** While pi works, Roamies says now and then that it's still going and what it's on.
- **Read-only trust.** A read-only pi can still read any file the sandbox lets it reach, and what it reads goes to pi's AI
  provider. If a project holds things you'd rather approve each time, set `autoSendReadOnly` to `0`.

## Conversation flow

When Roamies asks you something, you answer by just speaking. No key press. (`flow.mjs`.)

**An exchange** starts when you make a request by voice. It ends when you say a closing phrase alone ("thanks",
"thank you", "thanks mate", "that's all"; `closingPhrases` under `reference`), or `limits.exchangeEndSeconds` after
Roamies' last reply has finished playing. A closing phrase is answered by the app itself with `closingReply`,
spoken, and is not sent to the model.

**Spoken.** Inside an exchange, what Roamies shows it also says: its replies, the questions it raises itself (the
Send bubble, the folder question, the Super Productivity questions), what a sync has to say, and failures (a request
that failed, a microphone problem). A question is said briefly: a yes/no question by its first line, a hand-off by
what it is and its first sentence. Outside an exchange (a typed request, a sync on the timer) those bubbles stay
silent and wait for a click or a key press, with one exception: a notice about something done for you is said (see
"What a sync has to say" under Super Productivity; `speakNotices`). Talking to an open bubble stops what is playing but no longer
ends the reply's voice, so what Roamies says after your answer is spoken.

**The answer window.** After a question has been said, the microphone opens by itself for
`limits.answerWindowSeconds` (10; 3 to 30), with the usual listening sound and pill.

- It opens only when the speaker has finished. The end of speech is not estimated: the overlay, which plays the
  audio, reports it. After the question's last sentence the sidecar sends a mark; the overlay answers the mark when
  every buffer handed over before it has ended (the audio player's own "ended" event), and the output has then been
  silent for the delay the output device reports plus a margin (at least 0.4 s). The microphone is opened on that
  answer and on nothing else. If the answer never comes, the window never opens.
- While the window is open nothing is played: speech is held back until it closes. The voice helper also mutes the
  Mac's output while it listens, as it always did.
- Only answers count. A yes/no question takes the yes and no phrases; a read-only hand-off the send words; a
  hand-off that can edit only "send" or "send it" (with "please"). Anything else is dropped: it is not sent to the
  model, not kept in the conversation or the activity record, and logged only by its shape (size, whether a yes, no
  or send word was in it). It is shown as the bubble's last line (`Heard "…". Say yes or no.`), on screen only.
  The window stays open until it runs out: after a phrase that wasn't an answer the microphone opens again for the
  time that is left, without a second sound.
- A read-only countdown still sends itself when nothing is said. The microphone opening by itself doesn't stop it;
  anything you say does.
- A key press to talk works at any time and takes the window over: what you say then is judged the wider way (the
  send words, filler words allowed), and the bubble waits as it used to. A click always works.
- The microphone is closed at the window's end three times over, each on its own: the voice helper is given the
  window's length and stops listening at that time itself; the sidecar's timer sends the cancel at the same time; and
  a phrase marked with a window that is over is discarded. A phrase you finished inside the window is still judged
  if its words arrive within 3 seconds of the end; the microphone is already closed by then.
- Speech is turned into text on the Mac: on macOS 26 and later by Apple's SpeechAnalyzer, which runs on the device.
  (On older macOS, upstream's fallback is Apple's dictation, kept on the device only where the Mac supports that.)
  The helper keeps audio in memory only while it listens and writes none to disk.

**No answer.** When the window runs out with no answer, the bubble closes and the question becomes pending, in
`state.json` under `pending`. Nothing is sent or changed. The model is told that the question is kept and not to ask
again.

**Pending questions come back.** When your next exchange ends (not the one the question went unanswered in),
Roamies asks the oldest pending question again, one at a time, spoken and with its answer window.

- A pending hand-off is asked again in full: a new Send bubble with the whole prompt, a new undo snapshot if it can
  edit, and no countdown, even when it is read only. It is never sent because it was pending.
- The same question is pending once. Asked again while it is pending (you made the request again and again didn't
  answer), the new one takes the old one's place. "The same" is: for a hand-off, the same prompt for the same folder
  in the same mode; for the folder question, the same project; for an overlap and for a deleted task, the same to-do;
  for a day plan, the same day; for "which Friday?", the same block (its to-do, or its title when it has none yet);
  for "move it, or make a second one?", the same to-do; for "is this ..., or a new task?", the same title asked
  about the same to-do;
  the sorting proposal and the first-time question exist once each.
- When a question is answered, every pending copy of it is cleared without a word: by a spoken yes or no, by a
  click, or because a later request asked the same thing and you answered there.
- A question whose thing was done meanwhile is dropped without a word: the to-dos are sorted, the block or the plan
  is on the calendar, the to-do is done or gone, pi already works in that folder.
- You are told, in one line, only when something you still wanted is lost: the time of a block or a plan has passed,
  a to-do in a plan is no longer open, pi now works in another folder, the project is off the list.
- A question older than `limits.pendingKeepHours` is dropped. The morning briefing mentions the ones that remain, a
  question about a to-do by what it is about and without the title, and "what's pending?" has them read out
  (`show_pending`).
- If it goes unanswered again it stays pending, as old as it was. If Super Productivity isn't answering, a calendar
  question stays pending until it is.
- Pending questions are never written to the notes vault. A hook for the daily note (feature 18: a Log line when a
  question becomes pending, and one when it is answered or dropped) is in place and connected to nothing yet.

## Standing down

Say "stand down" or press ⌃⌥. (Control-Option-Period), and Roamies stops everything at once. The phrase and the
shortcut are settings (`standDown`). Code decides it; the model is never asked. (`standdown.mjs`; the shell's half
is `src-tauri/src/stand.rs` and `voice.rs`.)

**The phrase counts only when it is all you said.** Small words around it are fine, in any order: "please", "now",
"okay", the persona's name and its form of address. "Jarvis, stand down, please" and "okay Jarvis, stand down now
please" stand it down; "take a note: the committee will stand down in March" and "that's enough for today, you can
stand down" do nothing. It works whenever the microphone is open: holding the talk keys, and in an answer window. Typed alone in the ask
field it does the same (the owner, 2026-11-26); so does a closing phrase such as "thanks", which ends the exchange
with the closing line and sends nothing to the model, typed as spoken.
The shell matches it on the words heard so far: once they have been the phrase alone for `standDown.waitSeconds`
(1.5 seconds) with nothing more said, or at once in the final words. A sentence that goes on past it ("stand down the committee") does nothing. The
words are never logged and never reach the model.

**The shortcut works at any moment**, also while Roamies speaks and the microphone is closed. It is held for as long
as Roamies runs. If another app or another Roamies shortcut has it, a bubble says so once and the phrase still works.

**What stops:**

- speech, at once (the page stops playing before the sidecar hears of it);
- the microphone and any answer window;
- the request to the model, and any request still waiting behind it;
- pi, and what its commands left running;
- bubbles, cards, the step trail, drawings, the list and the ask field. The character rests at home; if it was
  hidden, it stays hidden.

**Questions.** A question on screen is closed as if its answer window had run out: one that is kept when nobody
answers is kept in `pending` and asked again after a later exchange. A read-only hand-off whose countdown was running
is kept the same way and never sent by itself: it is asked again in full, with no countdown. A missed-task round
ends unanswered, and its to-dos come back the next morning. Pending questions stay kept.

**While it lasts nothing is said or shown unless you ask.** Since features 25 and 31, what would be said or shown
unasked goes to the quiet queue (see "Speaking budget and quiet queue" below), the same queue the speaking budget
fills, logged with the reason `stood`. Questions wait for a quiet moment, as they always did. Three things are as
the owner chose them:

- a briefing whose window passes meanwhile is skipped, as before. One that was already waiting behind a request
  when you stood down is not counted as given: it is held like the others, given later if its window is still open;
- a calendar line about a block that has ended by then is dropped and counted;
- reminders are never dropped: they are given late.

The day's review is written in the daily note at `calendar.reviewAt` as usual; its line waits in the queue. What you
ask for still works: the list shortcut, the panel, Esc. A line that would have gone to the screen from anywhere else
is kept in the queue (up to 20) and shown afterwards. The count on the character is hidden while it lasts.

**It ends** when you next start a conversation the usual way: a request, spoken or typed. Pressing the talk keys
alone doesn't end it. With `standDown.endsAtDayTurn` (on by default) it also ends by itself at `calendar.dayTurnsAt`,
saying nothing aloud. What it stopped goes to the queue, which is given at the end of your next exchange: a typed
request once its reply is done, a spoken one when the exchange ends (when it ended at the day turn, the first one
after it; over a restart too). First comes one line worded by the app for what happened meanwhile ("While I stood
down: pi was stopped and 2 processes it had left running were ended; 1 calendar line went by, its block over."),
shown, and said when `speakNotices` is on; then what was held, most urgent first, with the review's line and
questions if it is still that day.

**The look.** Grey, dim and still: every look is drawn in grey at about half its brightness and holds still where it
rests, so the page stops drawing. JARVIS's globe stops turning and its heart is a flat dash. Normal rest is in colour
with JARVIS's globe turning slowly and its heart a dot.

**Kept** in `state.json` under `standDown` while it lasts, and what it held under `quiet`: a restart and a new
overlay page keep both, look and all.

**Recorded** as two log lines, with true/false and counts only: `stand_down {by, speech, request, pi, window,
bubbles}` when it starts (`by`: `key`, `phrase` or `typed`) and `stand_down_end {by, minutes, held}` when it ends.
Opening the ask field yourself while it lasts is not logged as a leak (`stand_down_leak` is for a question that
reached the screen). Nothing goes in the daily note.

```json
"standDown": { "phrase": "stand down", "shortcut": "Control+Alt+Period", "endsAtDayTurn": true, "waitSeconds": 1.5 }
```

- `phrase`: one to four words, letters only. Not a phrase Roamies already acts on (yes, no, send, the closing
  phrases, "leave it", "drop it", "review my day" and the like) and not only small words.
- `shortcut`: a key with at least one modifier, written as the shell writes shortcuts (`Command+Shift+KeyD`).
- `endsAtDayTurn`: `true` or `false`.
- `waitSeconds`: 0.5 to 3. How long the words heard so far must have been the phrase alone before it counts. Shorter
  acts sooner; longer leaves more time to go on past it (a pause after "stand down" in a longer sentence).

## Check-ins

When a to-do's block ends, or its due time passes, Roamies asks whether it is done. Code words the question, reads
the answer and acts on it; nothing of it reaches the model. (`checkin.mjs`, with the daily note's `daily.mjs`.)

**When.** At the end of a to-do's block today ("Your block for Write methods has ended. Is it done?"), or, for a to-do
with no block today, when its due time today passes ("Send slides was due at 11:30. Is it done?"). For to-dos this
takes the place of the due-time nudge; reminders keep theirs. Once for each time a to-do had. At most
`limits.checkInsPerDay` (6) a day, and none after the day's review.

**Not for what ended long before start-up.** A block or due time that ended more than 60 minutes before Roamies
started gets no check-in (the owner, 2026-11-26); the day's review lists it as missed and asks about it like any
other.

**Not in the middle of a block.** A block's own check-in comes at its end, even when the next block starts right
then. One for a due time, and one asked again, waits until a block has ended or none is running.

**The answers**, by button (Done, Still on it, Not yet) or by voice:

- **done** ("done", "yes", "it's done", "finished"…): the to-do is marked done and its "Done" line follows in the
  Log. A block it still had to come is taken off the calendar, so the time is free.
- **not yet** with a time ("not yet, Friday at 10"): read the way the answers to "When will you do it?" are; the
  block moves there, or the due time is set, with a "Rescheduled" line. "Next Friday" is asked about first, in the
  calendar's own bubble between the two Fridays it can be ("Friday the 27th or Friday the 4th?", by click or voice);
  no answer changes nothing. "Not yet" alone, or the button, asks "When
  will you do it?" with Leave it and Drop it, as after the review.
- **still on it**: asked again `limits.checkInAgainMinutes` (30) later, twice at most, with a "Check-in: … still on
  it" line. At the review it counts as still open, not missed; not done by the day turn, it needs a new time the
  next morning.
- **no answer**: nothing changes, and it is not kept as a pending question ("Check-in: … no answer").

A to-do answered in a check-in is not asked about again at that day's review.

**The Plan's boxes.** Every line of the Plan's three lists (planned, needs a new time, coming up) is a checkbox with
the to-do's id at its end (`^td-<id>`). Tick one in Obsidian and that to-do is marked done (the recent notes are read
every 5 minutes at most). Unticking does nothing, and the app never ticks a box after it has written the Plan.

**Deadlines at risk.** An open to-do due within `limits.atRiskHours` (24) with no block that ends before its due time
is said once for each due time it has: "Grant report is due tomorrow at 10:00 and has no time planned before then."

## Speaking budget and quiet queue

Everything Roamies says or shows unasked goes through one gate (`quiet.mjs`). It is given only when:

1. Roamies is not stood down;
2. its kind is switched on (`speaking.briefing`, `review`, `checkIn`, `deadlineAtRisk`, `calendarLine`, `notice`);
3. you are not away: there has been keyboard or mouse input in the last `speaking.awayMinutes` (10; 0 is off);
4. no other app is using a microphone, with `speaking.quietInCalls` on;
5. fewer than `speaking.perHour` (3) things were given unasked in the last hour, spoken or shown.

Anything else waits in the **quiet queue**: nothing is said, nothing is shown, and the character carries a small
count (hidden while stood down). The log says which rule held it back, as one word: `quiet_queued {kind, why}` with
`why` one of `stood`, `off`, `away`, `call`, `budget`, checked in that order.

**Reminders you set** never go through it: they always speak (after a stand down, late) and are not counted. Neither
does what you asked for (a reply, pi's result).

**The queue is given** at the end of your next exchange (a typed request once its reply is done, a spoken one when
the exchange ends), before the morning questions and any pending question; or when you say or type "anything
waiting?" alone, which the app answers ("Nothing is waiting." when nothing is). Most urgent first: deadlines at risk,
check-ins, the review, calendar lines, briefings, notices. At most `limits.queueGiveMost` (3) at a time; one line says
how many still wait. Giving the queue doesn't count against the budget.

**Out of date.** A calendar line whose block has ended, a check-in whose to-do was done or moved (or the review has
run, or the day turned), a deadline that passed or got a block, a briefing whose window closed, a review line from
another day: each is dropped and counted, and one line worded by the app says so before the rest ("Dropped as out of
date: 2 calendar lines and 1 check-in."). After a stand down that line is stand down's.

**Away and in a call.** Every 5 seconds the shell reads two numbers and sends them to the sidecar: the seconds since
the last keyboard or mouse input, and whether any input device is running for some app (`src-tauri/src/presence.rs`,
macOS only). Neither needs a permission: nothing is recorded or listened to and no app is named. Roamies' own
listening, and 10 seconds after it, is not taken for a call. A change is logged as `presence {away, call}`, true or
false only.

**Kept** in `state.json` under `quiet` (the queue, and the last hour's count), over a restart.

```json
"speaking": { "perHour": 3, "briefing": true, "review": true, "checkIn": true, "deadlineAtRisk": true,
              "calendarLine": true, "notice": true, "awayMinutes": 10, "quietInCalls": true }
```

- `perHour`: 0 to 30. 0: nothing is given unasked; it all waits.
- the six kinds: `true` or `false`.
- `awayMinutes`: 0 to 240, whole minutes. 0: off.
- `quietInCalls`: `true` or `false`.

Nothing of the queue reaches the model: not its items, its count, "anything waiting?" or the answer.

## What goes with each request

Every request to the AI provider carries the instructions, the tool definitions (together about 16,000 tokens)
and the conversation so far. Two things keep that from growing without end.

- **The live state is sent only when it changes.** The live state is what the model must know as of now: the app
  in front, whether this reply uses the form of address, where pi works and your routines, the notes vault, the
  calendar's state, whether clicking and typing is allowed, the voice, the shortcuts, and the memory section (the
  to-do list in outline and the facts it knows). It is made of named parts. The first request of a conversation,
  and the first after a fold, carries all of them. After that a request carries only the parts that differ from
  what the conversation already holds, and nothing when none does; a part that no longer exists is sent once as
  removed. The instructions tell the model that a later part replaces an earlier one of the same name. A part
  that was sent stays on the message it was sent with: taking it off would change that message and the provider
  could no longer reuse what it has already read. (`live.mjs`; before this every request carried a full copy,
  about 500 tokens, and kept it.)
- **The older part is folded.** When a request reaches `limits.historyTokens` (40,000) tokens as the provider
  counts them, the older exchanges are replaced by a summary, written by the same model in a request of its own,
  and the newest quarter of the fold point (10,000 tokens) is kept as it is. The raw exchanges that were folded
  stay on the Mac, next to the conversation's file. What is folded is planned on what was really sent (the live
  state included, and counted the way the provider counted), so a fold that is due can happen.
- The log's `live` line says which parts were sent and how many characters, never their text.
- **A fresh conversation each day** (feature 18, see "The daily note"). The first request of a new day starts a new
  conversation. Its first message is the handover, marked as background: what was decided, what is worth
  remembering, and the open items with their ids, at most 300 words. Part one of the handover, the daily note and
  the to-do list are never in it.

## Safeguards

**Undo snapshots.** Before a "Can edit" hand-off, Roamies saves the project as it is: the tracked files with their
uncommitted changes, plus new files up to 2 MB each that `.gitignore` doesn't exclude. It is stored as a git ref,
`refs/roamies/<date_time>`, without touching your branch, your staging area or any file. The Send bubble says
"Undo snapshot taken", or why there isn't one (the project isn't a git repository). To put the files back:

```bash
git -C <project> restore --source=refs/roamies/<date_time> --worktree -- .
```

The exact command is in the hand-off's record, and Roamies can tell you it. Files pi created stay; `git status`
shows them. Large and ignored files (raw data, images) are not in snapshots. `git for-each-ref refs/roamies` lists
snapshots; `git update-ref -d <ref>` removes one.

**Warnings in the Send bubble.** If `settings.json` has changed since the last hand-off (Roamies never changes it, so
that was you or something else), or pi is started with a command other than `pi`, the bubble says so.

**What the AI provider is given of your to-do list.** Your to-do list holds every open task you have in Super
Productivity (below), so their titles, times and deadlines can become part of the conversation with your AI
provider. They do when you ask about them, not with every request:

- With every request goes an outline: how many to-dos are open, how many are due today, due this week, overdue and
  without a date, how many were done today, and today's planned blocks in full (time, title). Nothing else of the
  list is in it. The morning briefing uses the same outline.
- A title outside today's plan is sent only when you ask: "what's due this week?", "what's overdue?", "which have
  no date?", "what's in urgent and important?", or naming a to-do ("move the flow test"). The app then hands over
  the to-dos that fit, ten at most, and says how many more there are; you can ask for the next ten.
- Asked "what's open?", Roamies gives the numbers and today's plan first, and offers the details.
- "Show the matrix" gives the number in each quadrant; the to-dos of a quadrant come when you ask for them.
- What the app shows you itself never goes through the provider: the list on screen, and every bubble (the first-time
  question with its titles, an overlap, a deleted task, the offer of a block), and every line a sync leaves (a
  conflict, a failed step, a to-do taken off the list).
- A reminder that comes due (since feature 25 a to-do gets a check-in instead, see Check-ins): Roamies builds the
  nudge itself, from a fixed pattern ("Write report is due at 17:00.";
  "was due" once it is five minutes late, with the day when that isn't today), shows it and says it. No request is
  made for it and nothing about it is sent to the AI provider, whether the to-do was yours or came from Super
  Productivity. Up to three are named in one nudge; more are counted ("And 2 more are due: the list shows them.").
  If you answer a nudge in words, that is an ordinary request; the model was not told of the nudge, so it looks the
  to-do up among the overdue ones when you don't name it.
- What you asked about stays in the conversation afterwards, like anything else said in it, until the conversation
  is folded or you start a new one.

This is fixed in code (`calendar.mjs`), not left to an instruction.

**The never-look list.** Apps in `neverLook` are never captured, read or worked in. A screenshot or read of such an
app, or of the front window while it is in front, is refused. A whole-screen screenshot is refused while one has a
window open, because it could be in the picture. Its windows are left out of window lists, and its name and window
title are hidden from what is sent with each request. If the open windows can't be listed, nothing is captured.

Only the app's name decides. A window title, a web address or any other wording never hides or unhides an app:
Safari showing a page titled "Messages" is still Safari. What is in front is asked once per request, and the line
sent to the AI and the name checked against the list come from that one answer. If the name is missing, the line is
hidden.
"Ask About an Area", where you draw the box yourself, is not covered.

## Notes

Roamies keeps notes as plain Markdown files in `~/Documents/roamies-vault/` (the `vault` setting). Open that folder
in Obsidian as a vault to browse them, see the links between them and edit them; Obsidian doesn't need to be running
for Roamies to use it.

- "Note this down…" makes a new note, named by its title, with the date at the top.
- "Add to my note on…" adds to the end of an existing note under the date and time.
- "What do my notes say about…" searches titles and text, in subfolders too, and can read a note back.
- Related notes are linked the Obsidian way, `[[Title]]`.

These are the only files Roamies writes itself, besides its own folder. In code, a title is only ever a file name
inside the vault, and nothing is deleted or renamed. A note is changed only as below ("Changing a note"). What it
reads from your notes to answer you becomes part of the conversation with your AI provider, stays in that day's
conversation and is sent again with each later request until the conversation is folded, and is counted in the
ledger (note texts), once.

Everything Roamies writes in the vault goes through one writer in `notes.mjs` (`createVault`, feature 18). It can
make a file that isn't there, add to the end of one that is, on a line of its own, and (feature 14) put a note's new
text in place of its old one, only while the note still holds exactly what you were shown. It never deletes or
renames anything. It refuses a path with an empty part, a part that starts with a dot, or `..`. It also
refuses a folder or file that is a link, and anything that would land outside the vault.

**Changing a note** (feature 14, the owner's answers of 2026-11-26).
- Only a note you name in that request, typed or spoken, judged as for a file (see "Reading your files"): its
  title, or all its words ("change my lab plan: the threshold is 0.7" names "Lab plan"). Otherwise nothing is shown
  and nothing changes.
- The change is exact pieces of the note's text, each found once, and what replaces them. A whole new text only when
  your words in that request say rewrite.
- A bubble shows it first: "Change Lab plan?", the removed lines (`- `) and the added ones (`+ `), at most
  `limits.noteEditLines`, with **Save it** and **Keep it as it is**. It is said too in a spoken exchange.
- Only "save" or "save it" saves, said alone, with the usual small words around it (um, please, so, just… and the
  persona's name), hands-free too. "Yes" doesn't. "Keep it", "no" or "cancel" keep the note as it is. No answer saves
  nothing, and the question is not kept.
- Before the note is changed, its previous version is written to `~/Documents/roamies-pi/note-versions/` (outside
  the vault, never deleted). The new text goes in through a temporary file beside the note, renamed over it, and only
  if the note still holds exactly what you were shown: if Obsidian or you changed it meanwhile, nothing is saved and
  Roamies says so. A change that would leave the note empty is refused.
- "Undo the last note edit" (or "put back my lab plan") shows the version from before the last edit and saves it the
  same way, on "save"; the version it replaces is kept too.
- Daily notes and task pages can't be changed this way (the app writes them). On the provider's route a private note
  can't be seen, so it can't be changed either; the local model doesn't change notes.
- The daily note's Log gets "Edited: [[<title>]]".
- A note open in Obsidian with unsaved typing can still write over Roamies' change afterwards: Roamies can't see
  Obsidian's unsaved text.

**Task pages** (feature 18, as agreed on 2026-11-21). A to-do or a reminder can have a page of its own in the
vault, `Tasks/<its title>.md`.
- It is made the first time a note is linked to it: "note this down for the slides to-do" (`write_note` with the
  to-do's id), or "link my note on X to that to-do" (`link_note`). One with no notes has no page.
- The page holds the title and the due time if it had one, then a line for each note linked and each day the to-do
  was planned or finished, each linking that day's daily note. A new title adds a line; nothing is renamed.
- A new note made for a to-do has the page and the day in its front matter (`task:`, `day:`). A note linked, or
  added to for a to-do, gets one line at its end linking the page and the day. The daily note's Log files the note
  under its to-do.
- Two to-dos with the same title get `Title (2)`, `Title (3)`. A page you delete is made again at the next link.
- "Which notes do I have for that to-do?" (`notes_for`) finds the notes the page links to and the notes that link
  to the page, including links you add by hand. Task pages and daily notes are not counted as notes.
- Which page belongs to which to-do is kept in `state.json` under `taskPages`.
- What reaches the AI: the to-do's id it passes, and the note titles `notes_for` finds. A page's text and the
  to-do's title are not sent.

## Reading your files

Feature 14 (the owner's answers of 2026-11-26). Roamies reads files itself, only when you ask; changing them, or
running anything, still goes to pi. Four tools, in `files.mjs`, all in code: nothing is written and no program is
started (no `rg` or `grep`).

| Tool | What it gives the model |
| --- | --- |
| `read_file` | A text file's text, in parts of `limits.fileReadChars` (20,000 characters); each part says where the next starts |
| `list_files` | The names in one folder, folders ending in `/`, links marked and not followed |
| `find_files` | The paths of files whose name has the words you gave (or matches `*` and `?`) |
| `search_files` | Each line with the words, with its file and line number, in one folder |

- **Where.** The current project, the folders under `projects`, and `readOnly`, by real path (links are resolved
  first). Refused wherever they sit: the sandbox's blocked list (the same list pi's sandbox has), what Roamies never
  reads (keys, passwords, tokens, `.env` files, other apps' data), the notes vault (notes have their own tools),
  Roamies' own files in `~/Documents/roamies-pi` (its `workspace` folder aside), a file with more than one hard link,
  and a file that isn't text. A listing, find or search never goes through a link, and finds and searches skip
  `.git`, `node_modules`, `.venv`, `venv` and `__pycache__`. A whole home folder, Library or drive is never searched.
- **When.** Only in a request you typed or spoke: never in a briefing, pi's summary, a system note or anything else
  the app sends, never on Roamies' own initiative, and not while pi works. At most `limits.filesPerRequest` (10) reads
  in one request.
- **Names** (`list_files`, `find_files`) in any request you made.
- **Contents** (`fileContents`, "ask" by default). A file's text goes to a model only when your own words in that
  request name the file, or you say yes to a bubble naming exactly the files ("Read this file? - ~/Projects/thesis/
  src/dataLoader.py", **Read it** / **Don't**). No answer reads nothing. Each further read, a further part too, needs
  your words or your yes again; after a no, that file isn't asked about again in that request. Text in a file never
  counts as your words. A search finds the lines on the Mac first; the lines from files your words name are sent,
  and the other files with matches are listed in one bubble: with no yes, nothing from them is sent, not even their
  names. With `"free"`, any read in a request you typed or spoke.
- **How "names the file" is judged**, by code: the whole file name, with or without its extension, is in your words
  ("segment.py", "segment dot py", "segment"), or every word of the name is, the name split at `_`, `-`, `.`,
  spaces, capitals and digits, and "the", "a", "my", "of" and the like aside. "The data loader" names `dataLoader.py`;
  "the final report" names `final_report.md`; "the report" or "the loader" names neither. A name of one word
  counts without its extension only when your sentence is plainly about a file: it also has "file", "read", "open",
  "show", "look at", "look in" or "check" (the owner, 2026-11-27). "What's the plan for today?" doesn't name
  `plan.md`; "read the plan" and "plan dot md" do. The same for a note's title when changing a note, where "note"
  counts too ("add milk to my groceries note" names "Groceries"; "add milk to groceries" doesn't).
- **Shown.** The bubble's tag names the file being read ("reading segment.py"), the folder listed, or the words
  searched for; the activity list says the same.
- **The local model** (private mode, or no network) reads and finds files the same way, with parts of
  `limits.localFileChars` (6,000). "Read segment.py" (or "read the methods file") as your whole sentence is read by
  code first, and the local model only words the answer. In private mode a file's text goes only to the local model.
- **Logged** by tool, characters and whether it was refused; never a path, a file name or any text.
- **The ledger** counts the file texts each request carried and their characters; "What left the Mac today?" says
  them ("File texts: 2 (1,240 characters).").
- **What to know.** A file's or a note's text, once read, stays in that day's conversation and is sent again with
  each later request to the same model until the conversation is folded; the ledger counts it once, when it is read. A secret in a file that
  doesn't look like one (a token inside a YAML file) can reach the model when you ask for that file. A folder in
  Desktop, Documents, Downloads or iCloud Drive can bring up macOS's one-time "Roamies would like to access" prompt.

## The daily note

Feature 18. Roamies keeps one note per day in the vault: `Daily/YYYY-MM-DD.md` (the `dailyFolder` setting). Code
alone writes it, through the vault's one writer. It is only ever added to, so what you type in it stays. A day starts
at `calendar.dayTurnsAt` (04:00): at 02:00 it is still the day before. The note links to the day before and the day
after.

- **Plan.** Written once a day, by the morning briefing, or by the first thing written in the note that day. It holds:
  - the to-dos with a block or a due time that day, with "(done)" for one already finished;
  - **Needs a new time:** open to-dos whose every time (block and due time) has passed, oldest first;
  - **Coming up:** deadlines in the next 14 days.
- **Log.** A line when a to-do is finished: in Roamies, at the next check (every 30 seconds); in Super Productivity,
  right after the sync that finds it (every `calendar.syncSeconds`); and when a note is taken (`[[its title]]`). A Log line after another section starts a new
  `## Log`; after the review, `## Log (after the review)`.
- **Review.** At `calendar.reviewAt` (18:00), by the evening briefing when that comes first (not when `reviewAt` is
  `""`), or when you say or type "review my day" (or another phrase in
  `reference.dailyNote.reviewPhrases`) on its own. It lists each planned to-do as **done**, **missed** (its time is
  over) or **still open today** (its time is still ahead). Two sentences worded by code follow, then the missed ones
  again under **Needs a new time**. Roamies then says the counts. A second review adds `## Review update (HH:MM)`
  with only what changed.
- **Questions.** Roamies never picks a new time itself; it asks "When will you do it?", in a bubble that is said and
  gets its answer window.
  - When: after the review, about each missed to-do. In the morning, about each to-do under Needs a new time: after
    the morning briefing, or, with no briefing, at the end of your first exchange of the day.
  - How many: at most `limits.reviewQuestions` (3) each time, oldest first. If more remain, one line says how many
    and that they are in today's note under Needs a new time.
  - Your answer is judged by code, never by the AI:
    - **A day and a time** ("tomorrow at 10", "Friday 14:30", "half past three on Monday"). An hour without am or
      pm is the one inside the working day; when neither is, before 7 means the afternoon. The block moves there
      (the usual question if it overlaps something), or the due time is set when the to-do has no block. A
      `Rescheduled` line goes in the Log.
    - **A day alone** ("Monday", "the 28th"): the due time is set to that day at `calendar.dayEnd`.
    - **"Leave it"** (or the button): nothing changes; it is asked again the next morning.
    - **"Drop it"** (or the button): no more questions about it while it keeps that time, and a `Let go` line goes
      in the Log. The to-do itself is left exactly as it is, in Roamies and in Super Productivity: never deleted,
      never marked done.
    - **"Next Friday"** (with a time or not): which Friday is asked first, in the calendar's own bubble between the
      two it can be ("Friday the 27th or Friday the 4th?", a button each, or said: "the first one", "the 4th"),
      then the answer is taken as if that date had been said. No pick changes nothing (the owner, 2026-11-26).
    - The full lists are in `reference.dailyNote.questions`. A time that has passed is not taken: the bubble shows
      what it heard and stays open.
  - No answer changes nothing and ends the round. These questions are not kept as pending questions; they come back
    the next morning.
- **The first request of the day**, typed or spoken, writes the day's Plan if it isn't written yet.
- **Handover, and a fresh conversation each day.** At the first request of a new day (typed, spoken, or a
  briefing), the conversation that ends is handed over in two parts, both written under `## Handover` in the daily
  note of its last day:
  - **Part one, by code:** the to-dos and reminders made, changed, done or dropped that day, each to-do linked to
    its task page when it has one; the questions still waiting; the blocks kept until Super Productivity is open.
  - **Part two, by one request to the AI** (the same route as the fold), given the conversation that ends and the
    open items' text: at most 8 lines under **Decided**, **Left open** and **Worth remembering**. Under Left open the
    note lists every open item, oldest first, as a checkbox with its block id (`- [ ] … ^oi-…`).
  - While part two is made, Roamies shows "One moment: I'm wrapping up yesterday." (said too, in an exchange
    started by voice). It waits at most 30 seconds.
  - Then a new conversation starts, with the handover as its first message (see "What goes with each request"),
    and your request goes on in it. The old conversation gets the usual memory pass.
  - If part two fails, part one stays written, the old conversation carries on, and part two is tried again at the
    next request.
  - A day with no conversation makes no request. After a gap of several days, the new conversation gets the most
    recent handover and the open items.
- **Open items.** Each new "Left open" line becomes an open item, kept in `state.json` under `handover` with its
  day. A line that matches an open item makes nothing: the same words (small words aside), or all of one's words
  in the other's. Nothing looser, since a duplicate is harmless and a lost item is not. The AI lists only new lines; the open items are carried
  from one handover to the next by code. An item is closed, with one ticked line in that day's Log
  (`- [x] HH:MM Closed: … (how)`; earlier notes are not rewritten), when:
  - the to-do or reminder it is about is done;
  - you tick its box in one of the last 14 daily notes in Obsidian (read every 5 minutes at most);
  - you say it's dealt with (`item_dealt_with`). It closes at once only when your own words in that message say so:
    "done", "dealt with", "sorted", "finished", "close it" and the like (the full list is in
    `reference.handover.openItems.dealtWith.doneWords`), not after a "not" in the three words before, and not in a
    question. When the AI suggests it on its own, a bubble asks "Close the open item …?" first. Either way Roamies
    says which item it closed.

  After `limits.openItemAskDays` (7) days, the evening review asks about the item: "… has been open since …. Keep
  it open?". "Keep it" asks again after as many days; "Let it go" closes it with a ticked `Let go` line. At most
  `limits.reviewQuestions` each time, oldest first; no answer ends the round and changes nothing.
- Only to-dos count in the Plan, the Log and the Review. Reminders and timers appear only in the handover's part
  one; pi's work never appears (it stays in the records folder).
- Nothing in the daily note is sent to the AI, and making it involves no request, apart from part two of the
  handover (above). "Review my day" is answered by the
  app and never reaches the model, and so are the questions and your answers. The activity log records counts
  only (`daily_plan`, `daily_log`, `daily_review`, `daily_questions`, `daily_handover`, `handover`,
  `handover_items`, `handover_new`); a failure is logged once per reason (`daily_failed`, `handover_failed`).
- `state.json` keeps, under `daily`, what was written for each of the last 14 days. This stops a line being written
  twice and lets the review find a to-do finished earlier in the day.

## To-dos in Super Productivity

Roamies' to-do list is mirrored in Super Productivity, through that app's local REST API (Settings > Misc > Enable
local REST API). Requests go only to `127.0.0.1:3876`, on this Mac.

**Every open task in the app is a to-do** (feature 26, 2026-11-19). Roamies sees every open task in Super
Productivity, in any project, with or without a time, whoever made it, and keeps it on its to-do list, synced both
ways like a to-do of its own.

- The first time, a bubble shows how many open tasks aren't on the list yet, with the first ten titles and "and N
  more", and waits for your yes. Before it nothing is added. "Not now" leaves everything as it was, and it is
  offered again at the next start.
- After the yes, a task you add in the app is on Roamies' list at the next sync, without a bubble and without a
  line. The log records how many, never a title.
- Read from a task: its title, start, length, whether it is done, its deadline, and the two matrix tags. Never its
  notes, attachments, other tags, project or sub-tasks. A sub-task is not adopted; its parent is. A sub-task with a
  time still counts as taken time.
- Done and archived tasks are not adopted. A task opened again in the app comes back: to its old to-do if that is
  still on the list, else as a new one.
- A repeating task: each occurrence that is open in the app is adopted like any task, and the link notes that it
  repeats. The repeat rule is never read or changed. A daily task therefore adds a to-do a day.
- Roamies writes to a task only what you changed in Roamies: its title, done, the block (start and length), the due
  time, urgent, important. It creates no task for an adopted to-do, and never deletes one.
- A to-do that came from the app, taken off Roamies' list: its task stays in the app exactly as it is, time
  included. Roamies only forgets it, and says so in one line. It is not brought back while it stays open in the
  app, and it still counts as taken time. (It was yours before Roamies knew of it; taking it off Roamies' list
  means "stop tracking this", not "undo it".)
- The same title twice: a to-do that has no task yet and an open task that has no to-do, of the same title (capitals,
  spaces and a leading "the" aside), one of each, are linked instead of a second task being made; where they
  differ, the app's title and deadline are taken. Two tasks of the same title in the app are two to-dos: nothing is
  merged, because merging would mean deleting one. Asked for by that title, Roamies asks which.
- A deadline in the app is the to-do's due time. An adopted task whose deadline had already passed gets no check-in;
  one that comes due later gets one like any to-do (see Check-ins).
- How a link came about is kept with it in `state.json`: `from: "app"` for an adopted task, nothing for one Roamies
  made; `repeats: true` for a repeating one. `calendar.adopt` is the yes; `calendar.released` lists the tasks taken
  off Roamies' list.

**The mirror.** Every to-do that is something you said you'd do has a task in the app, with or without a time. Plain
reminders ("remind me at five") have none. The first time, Roamies shows how many to-dos would be added, with their
titles, and waits for your yes; before it, nothing is created. A new task appears in the app's Today list, as any
task added there does.

**To-do or reminder: the word you use decides.** "To-do" or "task" ("add a task: send the abstract, in ten minutes")
makes a to-do, even when its time is only minutes away: it stays open until you say it is done, and has a task in
the app. "Remind me" makes a reminder: it clears itself once you have been nudged, and has no task. "Make that a
to-do" (or "a task") turns a reminder into a to-do: the same entry, with its words and its time, from then on open
until it is done, with a task in the app at the next sync. A to-do is not turned back into a reminder. Which word
was used is read by the model, from the rule in the two tools' descriptions (`KIND_RULE` in `calendar.mjs`); the
conversion itself is code (`makeCommitment` in `store.mjs`).

**The sync.** For a to-do and its task, seven things are kept the same on both sides: the title, whether it is done,
the start time, the length, urgent, important, and the due time (the app's deadline). A change on either side
reaches the other.

- When: before any to-do tool runs, before each briefing, and every `calendar.syncSeconds` (60) while the app
  answers.
- The pair is known by the task's id, kept in `state.json`. A title never identifies anything: two to-dos with the
  same words are two tasks, and a renamed task stays with its to-do.
- If both sides changed different things, both changes are kept. If both changed the same thing, the app's value
  wins, and Roamies tells you in one line.
- What a sync reads is never written back: after each run both sides hold the same values, so the next run has
  nothing to do. A run with nothing to do costs two requests: "are you there", and the task list.
- A task deleted in the app: Roamies forgets the pair and asks, in a bubble, whether the to-do goes too. Until you
  answer, the to-do gets no new task; if you keep it, it gets one.
- A to-do Roamies made, taken off its list: its task loses its time and stays in the app, and Roamies tells you to
  delete it there if you don't want it. (One that came from the app is left as it is: above.) Either way it is not
  brought back onto the list. Roamies never deletes a task.
- Done on both sides: the pair is retired and no longer synced. A task the app has archived counts as done. A to-do
  you open again in Roamies takes its old task up again if it is still in the app's list.
- The app closed, or its API off: to-dos work as always, and the two are brought in step at the next sync. The
  check that the app is there gives up after one second, so a closed or hung app never holds up a to-do. The
  activity log has `calendar_closed` once when the app is found closed (nothing listening on its port) and
  `calendar_closed_end` (with the minutes) once when it answers again, not a line at every sync; any other failed
  sync is logged each time as `calendar_failed`.
- The due time is the app's deadline: a time (`deadlineWithTime`) when Roamies sets it. A deadline you set in the
  app as a day without a time is taken as that day at `calendar.dayEnd`. Roamies never sets the app's deadline
  reminder.

**Blocks.** A block is a to-do's start time and length, which is what puts a task on the app's calendar. Every
block has a to-do behind it, and a to-do has one block at most.

- "Put the paper on Monday at ten for ninety minutes": the block goes straight in. If you name something that isn't
  a to-do yet, it becomes one first. A title that exactly one open to-do has (ignoring capitals, the spaces around
  it and a leading "the") is that to-do: no second one is made, and Roamies says it used the one already on your
  list. If several have it, Roamies asks which, telling them apart by their due times, and nothing is made or
  changed until you say. The same holds while Super Productivity is closed. If you don't say how long and the
  to-do has no length yet, Roamies asks.
- When that to-do already has a block (or a slot kept for it), Roamies asks before doing anything: "Flow test is
  already booked for Friday 20 November at 10:00. Move it, or make a second one?", with the buttons Move it and
  New one. It is a question like the others: said, with an answer window, kept when unanswered and asked again
  later. Answer by clicking, or by saying "move it" or "the same one", "a new one" or "a second one" (the phrases
  are under `reference.spokenAnswers.moveOrSecond`). "No" changes nothing: no block moves and no to-do is made.
  The question is the app's own; the model can't answer it and is told never to rename what you called something
  to get round it. Naming a to-do by its id (as the model does after you have picked one) moves its block without
  asking, as before.
- When no to-do has the title but one comes close, Roamies asks: "Is this Flow test, or a new task?", with the
  buttons That one and New task. Close means: one title holds the other as whole words in a row, ignoring capitals,
  punctuation and a leading "the" ("Flow test, second run" and "Flow test"; not "Flow tests"). A title of fewer
  than two words never matches this way. If that to-do has a block, the bubble says where, and that it would
  move. Answer by clicking or by saying "that one" or "a new task" (`reference.spokenAnswers.thatOrNew`); "no"
  changes nothing. It is said, has its answer window, and is kept when unanswered, like the others. If several
  come close, the one sharing most words is asked about. This is the guard in code for a title the model has
  reworded.
- "Book Friday from 10 to 11 for the experiment": a day and two times make a block. The length is worked out from
  the two times by the code, and the date of a weekday by the code, not by the model: a weekday is the next day of
  that name counting today (today itself until the block's time is over, then a week on). "Today", "tomorrow" and a
  date (YYYY-MM-DD) work too. Roamies says back the day and times that were used. An end time and a length said
  together are taken when they agree; when they don't, nothing is changed and Roamies asks which you meant.
- "Next Friday" is a question, not a guess: the code works out the two it can be, the coming one and the one a
  week later, and a bubble asks "Friday the 20th or Friday the 27th?" with the two as its buttons. It is a question
  like the others: said in an exchange, with an answer window, kept when unanswered and asked again later. Answer
  by clicking, or by saying the day of the month ("the 27th", "Friday the twentieth"), "the first one" or "the
  later one"; "no" is neither, and nothing changes. The model is never asked for the date. Reading or planning
  "next Friday" asks the same way, but that question is not kept.
- What Roamies says matches what was done: "on the calendar", "booked" or "scheduled" only when the block is on the
  calendar. The tool's result says which it was, in words the model is told to pass on.
- Scheduling a to-do that already has a block moves the block. "Move it to Wednesday" and "take it off the calendar"
  do what they say; off the calendar, the to-do and its task stay and keep their length.
- A block you dictate is placed at the time you said, also outside the working day. If it would overlap something
  already there, a bubble shows what it overlaps, with the times, and asks; without your yes nothing changes, and the model is
  told only that the time overlaps something and that you declined, not what was in the way. Blocks
  that touch end to start don't overlap.
- "Plan my day": Roamies gives the to-dos and how long each takes (asking you where it doesn't know), and the times
  are worked out by the app's code, not the model: in the order given, each at the first free stretch between
  `dayStart` and `dayEnd`, keeping `lunch` and everything already scheduled free, `gapMinutes` apart. Today, a plan
  starts from now. The whole plan is shown in a bubble, with what found no room, and is created only after your yes.
  "Plan until 20:00 today" stretches the day for that plan only.
- "What's on Monday?": your to-dos' blocks, with times and lengths. Tasks you scheduled in the app yourself are given
  as taken time, without their names: what they are called is used only in the question about an overlap.
- Ticking a to-do marks its task done in the app; its time stays where it was.
- A block is never placed, moved or planned without the app's task list having just been read. If the list isn't
  mirrored yet, these refuse and say why. Taking a block off the calendar still works, and reaches the app at the
  next sync.
- **Super Productivity closed: a block is kept, not refused.** Asked to place or move one block while the app
  isn't answering, Roamies says the task is saved and the slot will be booked when Super Productivity is open. It
  does not say "booked" or "scheduled". A new to-do is made straight away (the to-do list works without the app);
  the slot is kept in `state.json`, under `calendar.actions`.
  - The first sync that reaches the app (within `calendar.syncSeconds` of opening it) mirrors the to-do, reads the
    task list, places the block, and you are told in one line. If it overlaps something you get the usual question
    instead, and nothing is placed without your yes.
  - One kept slot for a to-do: asking again for the same to-do replaces it. It is taken off the list in the same
    write that places it, so it never runs twice. Taking the to-do off the calendar drops it.
  - A slot whose time has passed before the app was open, or that is older than `limits.pendingKeepHours`, is
    dropped and you are told once. One whose to-do is done or gone is dropped without a word. A request for a time
    that has already passed is not kept at all.
  - Kept slots are read out with "what's pending?" and counted in the morning briefing, as not yet on the calendar.
  - A day plan is not kept: it needs the whole day in view, so `plan_day` still refuses while the app is closed, as
    does reading a day.
- The morning briefing says how the list stands and what is planned today, from the outline (see Safeguards).
- These tools work while pi is busy, like the to-do list.

**Urgent and important** (the Eisenhower matrix). Each to-do has two flags, urgent and important. In the app they
are its two matrix tags, `EM_URGENT` and `EM_IMPORTANT`, which is what its Eisenhower board goes by unless you have
changed that board. They are synced like the other fields, so a task dragged to another quadrant in the app changes
the to-do's flags.

- "That one is urgent and important", "the email isn't urgent": only what you said changes.
- "Sort my to-dos": Roamies proposes a quadrant for each to-do that has no place yet. The whole proposal is shown in
  a bubble, quadrant by quadrant, and applied only after your yes. A to-do that already has its place is not
  re-sorted this way.
- "Show me the matrix": the four quadrants and what isn't sorted yet, said briefly.
- A to-do that is urgent and important and has no block: the app asks, once for each to-do, whether it became so
  here or in the app: "Write report is urgent and important and has no block. Book one?", with Yes and No. It is a
  question like the others: said, with an answer window in a spoken exchange, kept when unanswered and asked again
  later, and dropped without a word once the to-do has a block, is done, or is no longer urgent and important. A
  yes books nothing by itself: Roamies then asks you for the day and time in the usual way (that one to-do is
  handed to the model for it, because you said yes to it). A no changes nothing. (A task adopted from the app that
  is already urgent and important gets no such question.)
- A to-do counts as sorted once it has been given a place, here or in the app, "neither" included.
- With the app not answering, what you say is kept and reaches the app at the next sync.

**What a sync has to say** (a clash, a deleted task, the first-time question) when nobody asked for one waits until
nothing else is going on: no reply being made or read out, nobody talking, no bubble waiting for an answer. Then it
is shown in a bubble. It is kept in `state.json` until shown, so quitting doesn't lose it. During a request of
yours it is the same: the sync's lines go to a bubble after the reply, worded by the app, and never into what the
model is given (2026-11-19). When a step of a sync fails during a request and the reason names a to-do, the model
is told only that a step failed; the bubble has the reason.

A line that reports something Roamies did or lost on your behalf is a **notice**, and is spoken as well as shown,
in one short sentence (the bubble keeps the full wording), whether or not you are in a spoken exchange:

- a kept block placed ("... is on the calendar now, Friday 20 November, 10:00 to 11:00."), also when it was placed
  after its overlap question;
- a kept block dropped because its time passed or it waited too long;
- a conflict resolved (the same field changed on both sides, and the app's value was kept);
- a sync that failed ("I couldn't bring my to-do list and Super Productivity in step: the bubble says why.");
- a task deleted in the app: its question is said, in one sentence. Outside an exchange it gets no answer window:
  click, or hold the talk keys and answer.

They wait for the same quiet moment as before. `"speakNotices": false` turns the voice off for them outside an
exchange. The offer of a block for an urgent and important to-do is a question, said the same way as the one
about a deleted task. A to-do taken off the list is said only inside an exchange, as before. Nothing is said when spoken replies are off.

**Answering its bubbles.** Every bubble this feature opens (the first time, an overlap, a day plan, a sorting
proposal, a task deleted in the app) has two buttons and can also be answered by voice: hold the talk keys and say
it. The bubble's last line says so.

- Yes: "yes", "yes please", "go ahead", "do it". No: "no", "don't", "cancel". Only these, said alone, or several of
  the same kind together ("no, no", "yes, go ahead"); capitals and punctuation don't matter. They are listed under `reference.spokenAnswers` in `settings.default.json`.
- Anything else you say while the bubble is open does nothing: the bubble stays open, and the words are not taken as
  a new request either. Afterwards the bubble is as ready for an answer as when it opened, any number of times, and
  the listening pill by the cursor goes away (no reply is coming for those words).
- What was said and not taken is logged by its size only (characters, words, whether a yes or no word was in it),
  never the words.
- Starting to talk doesn't close the bubble or cancel what Roamies was doing. The bubble stays on screen as it is
  (the character doesn't step away while you talk), so clicking still works, and so do the Y and N keys.
- With no such bubble open, "yes" is ordinary speech, as before.
- The same change in the overlay page keeps pi's Send bubble on screen while you talk; which words send is unchanged.

**When a sync fails**, you are told what failed, not that it failed: which step it was (making a task for a to-do,
changing its title, its time, its tags, reading the task list), and why: the app's own reason with its code and
HTTP status when it refused; that it didn't answer within the time allowed; that nothing is listening on its port;
that it is still starting; that it didn't accept the token; or that the token file is missing or not in the form
Roamies knows (said by its length, never shown). A fault in Roamies' own code is said as that. On the timer the same
failure is said once, not every minute, and the app simply being closed is not said at all until you ask for
something that needs it. The log records only that a run failed, because the reason names a to-do.

**Fixed in code, and listed under `reference` in `settings.default.json`:**

- Only these requests are ever sent: `GET /health`, `GET /tasks`, `GET /tasks/:id`, `POST /tasks`,
  `PATCH /tasks/:id`. There is no `DELETE`.
- The access token is read from the app's own file (`~/Library/Application Support/superProductivity/local-rest-api-token`)
  for each request and kept nowhere: not in a setting, `state.json`, a log, a record or a bubble, and the model never
  sees it. pi can't read that folder.
- Only linked tasks are written to (the ones Roamies made and the ones adopted), only the seven synced fields, and
  only what was changed in Roamies. The app's task list arrives whole (the API can't send less); notes,
  attachments, other tags, the project, sub-tasks and the repeat rule are dropped as the answer is read, and nothing
  from them is written anywhere. From a task that has no to-do (a sub-task, one taken off the list, any task before
  your yes), four things are kept, in memory only, to see clashes: title, start, length, done.
- A title is sent marked "as written", so the app doesn't read `@`, `#` or `+` in it as its short syntax.
- Only the two matrix tags (`EM_URGENT`, `EM_IMPORTANT`) are ever added to or taken from a task. Its other tags are
  read just before and sent back as they were.
- Before each create, the intent is written to `state.json`, and cleared when the pair is saved. If Roamies stops in
  between, it says so once at the next start: the title, and that a stray task may be in the app.

**The app's own reminder** (seen in 20.0.0): a task given a start time after it was made gets the app's reminder at
that time; the API can neither set nor remove it. Roamies' own reminder stays on the to-do's due time, which is a
different thing from a block's start.

The logs record what kind of change a sync made (which fields), never a title.

## What the patch changes besides pi

| Area | Upstream | This build |
| --- | --- | --- |
| Update checks | GitHub, 20 s after launch and every 6 hours | Never |
| Photo and source cards | Wikipedia thumbnails, picture URLs, site favicons | No lookups (map cards use outlines shipped in the app) |
| Spoken replies | Fish Audio (cloud), with your key | Kokoro, running on the Mac with no network; the Mac's own voice through `/usr/bin/say` as the fallback |
| Personality | Set by the look ("warm, funny, a little cheeky") | The `persona` setting: a manner only |
| Claude Code (Anthropic sign-in) | Usage metrics and error reports on | Switched off by environment variables |

Voice input is unchanged: on macOS 26 it is Apple's on-device speech recognition.

## The local model and the ledger (features 23 and 32)

Off until `local.address` is set in `settings.json`. Then a Gemma 4 model served on this Mac answers in two cases,
decided by code: when the Mac has no network (the shell reads the system's status; nothing is sent to find out) or a
request fails with a network error before any reply; and in private mode. A slow provider never switches.

- **The second loopback exception.** Requests to the local model go only to the one `http://127.0.0.1:<port>/v1`
  address in `local.address`, through a fetch that refuses any other host. Roamies can't tell where that port leads:
  with an SSH tunnel to another Mac, what goes to the local model leaves this Mac over your network, encrypted by
  SSH. "Private" means "not to the provider".
- **One more fixed helper.** With `local.start.python` set and the address at `local.start.port`, Roamies starts the
  model server itself (`mlx_vlm.server`, the version tested, the pinned model files by path; it downloads no model),
  under `sandbox-exec`: no network except listening on 127.0.0.1 at that port, writing only in its own temporary
  folder, reading in the home folder only the pinned models' files, starting no other program. It is started on
  first need and stopped after `local.start.sleepAfterMinutes` without a request, and at quit. A start that hasn't
  loaded the model and answered within `local.start.waitSeconds` (45) is stopped, and the request gets only "The local
  model could not start, so nothing was sent." To see that it runs sandboxed: `p=$(pgrep -f mlx_vlm.server); for x in
  $p $(ps -o ppid= -p $p); do /usr/bin/python3 -c "import ctypes,sys; l=ctypes.CDLL('/usr/lib/libsandbox.1.dylib');
  print(sys.argv[1], 'sandboxed' if l.sandbox_check(int(sys.argv[1]), None, 0) else 'not sandboxed')" $x; done`
  prints "sandboxed" for the server and "not sandboxed" for Roamies, which started it. Only its own server is used
  (the owner, 2026-11-26): if anything else answers or listens at `local.start.port` before it starts, a notice says
  so once, the request gets the same "could not start" line, and nothing is sent. Without `local.start` (your own
  server or tunnel), whatever answers at `local.address` is used.
- **Never silent.** The first local reply after a switch starts with a line saying so, every local bubble carries a
  "local" tag, and "Claude is answering again." starts the first reply after. The line comes only with an answer
  from the local model: a refusal by code, or a model that can't start or isn't answering, is said as only that.
- **Private mode.** "Keep this private" at the start of a request makes that request private; said alone it is a
  mode, with a mark under the character, until you say "back to Claude" (not at the day turn, not at a restart).
  Private requests go to the local model only; if it can't be reached, nothing is sent anywhere. A to-do, reminder
  or note made in private mode carries a private mark (`private: true` in `memory.json`, or in the note's front
  matter): the provider gets only how many there are, never their titles or text, in the live state, any tool
  result, a search, a side call or the handover. The outline's numbers leave them out, and after a Claude reply given
  a list or a count of the to-dos (a list tool, or a reply that counts them) the app adds one line of its own: how
  many private to-dos or reminders there are, and that only the local model can show them. Private exchanges are summarised by the local model only, into the
  daily note with a mark Claude's note tools leave out. You lift the mark by asking ("lift the private mark from
  ..."), with a yes.
- **What the local model can do.** Your to-dos and reminders, the calendar, notes, today's daily note when you ask,
  reading and finding a file in your project folders (feature 14, see "Reading your files"), and opening an app by
  name. A change it chooses is shown as a question and saved only on your yes
  (`local.confirmChanges`); what code decides from your words is saved at once: only when your whole sentence fits one
  of its frames ("remind me …", "… is due on …", "add a to-do: …", "I'm done with <title>", "open <app>"; the
  persona's name, "please", "can you" or "could you" may come first), and for a
  change to a to-do only with its whole title. An action code decided that needs nothing from the model is done by
  code alone, with no model call (the owner, 2026-11-27): a reminder code reads whole, taking a to-do off the
  calendar, marking one done, a new due time, opening an app, and a day looked up ("What's on Friday?", "show me
  <day>"), whose blocks code says ("Friday 28 November: 09:00 to 10:00, Lab meeting."). The model is asked only for
  what it must supply: a new to-do's or a note's own text, or the answer about a file it read. Times, days and
  lengths are read by code from what you said, never taken from the model. A hand-off to pi, the screen, drawing and
  clicking are refused by a line.
- **A tool call written out as text** (the owner, 2026-11-27). When the local model's reply is a tool call written as
  text instead of made (`unschedule_block{todo:…}`), it is never shown, spoken or run: the reply is "I couldn't do
  that here. Nothing was changed." (after a change that did run, its line, then "I couldn't do the rest of that here;
  nothing more was changed."). It is found by its shape, not by tool names: the model's own control tokens (`<|…|>`),
  or the reply opening with a name joined to braces with a field (`name{field:`), to brackets with a field set or
  nothing (`name(field=`, `name()`), or JSON with a call's fields (`{"name":`). A sentence about code further on in
  a reply ("it defines split(threshold=0.6)") is not taken for one.
- **The ledger.** One line per request to any model in `~/.gg/sidekick/ledger.jsonl`, beside `usage.jsonl`: when, the
  kind, where it went (the provider, or this Mac), the model, its tokens, how many screen captures and window texts it
  carried, the file texts and note texts it carried with their characters (feature 14), whether it was private.
  Never any content. Kept `limits.ledgerDays` (90) days. "What left the Mac today?"
  is answered from it by code and sent to no model, typed or spoken, like "review my day" and "anything waiting?";
  the local model's warm-ups are named apart from the requests that stayed on this Mac. A request that failed at
  sign-in is kept as its own kind (`signInFailed`) and has a sentence of its own in the answer, not counted among
  those sent. The model is kept by its name (`e4b`, or the last part of a path), never a folder. Requests the claude program reports making by itself (its
  per-model usage in each result, beyond the request's own turns) are counted too. Not counted, because Roamies can't
  see them: what the claude program sends to Anthropic by itself without reporting it (it connects when it starts,
  and makes small checks such as counting tokens), and pi's own requests.
- **The activity log's tool lines** (the owner, 2026-11-26): `tool` has the tool's name and each argument's length
  only; `tool_done` and `tool_error` the name, the time and the result's length. No title, note name, path or text.
- **Measuring** (`measureRequests`, off): per request, the hearing, the prompt reading and the voice up to the first
  sound, and the memory of Roamies' processes read by the shell; numbers and tool names only, in the activity log.

## What still uses the network

- Requests to Super Productivity on this Mac (`127.0.0.1:3876`). They don't leave the Mac.
- Requests to the local model at `local.address` (`127.0.0.1` only; where that port leads is your set-up).
- Roamies' conversation with your AI provider: messages, the front app and window title, saved memory, an outline
  of your to-do list (numbers, and today's planned blocks), the to-dos you ask about, and screenshots or window
  text when you ask about your screen.
- pi's own conversation with its provider, using pi's sign-in. Which files pi and the commands it runs can
  touch is limited by the sandbox; what they send over the network is not.
- Signing in to Anthropic the first time: a browser sign-in, and a one-time download of the Claude Code program.
- Links you click in a reply open in your browser.
- Building: `npm ci`, `cargo` and `fetch-node.sh` download dependencies once, at build time.

## Files changed

- `showcase/tauri/sidecar/pi.mjs` (new): the hand-off, the Send approval, the sandbox, the background job, the record, projects,
  and the gate that removes the file tools and narrows `open`, `act_in_app` and `draw`.
- `showcase/tauri/sidecar/notes.mjs` (new): the notes vault, its one writer, the task pages (feature 18), and changing
  a named note with its previous version kept (feature 14).
- `showcase/tauri/sidecar/files.mjs` (new): Roamies' own file reading (feature 14).
- `showcase/tauri/sidecar/guard.mjs` (new): the never-look list.
- `showcase/tauri/sidecar/calendar.mjs` (new): the to-do list mirrored in Super Productivity, and the sync.
- `showcase/tauri/sidecar/answers.mjs` (new): yes/no bubbles that take a spoken answer; which words count; filler
  words, closing phrases, the "Heard" line.
- `showcase/tauri/sidecar/flow.mjs` (new): the exchange, the answer window, pending questions, `show_pending`.
- `showcase/tauri/sidecar/store.mjs`: two functions added: `renameCommitment`, so a title changed in the app reaches
  the list, and `makeCommitment`, which turns a reminder into a to-do. `listItems` also gives `doneAt` for a finished
  item and `createdAt` (feature 18).
- `showcase/tauri/sidecar/daily.mjs` (new): the daily note (feature 18).
- `showcase/tauri/sidecar/handover.mjs` (new): the handover, the open items, and the fresh conversation each day
  (feature 18).
- `showcase/tauri/sidecar/standdown.mjs` (new), `sidekick.mjs`, `flow.mjs`, `calendar.mjs`, `pi.mjs`,
  `showcase/roamies/host.js`, `10-dither.js`, `jarvis.js`, `showcase/tauri/src-tauri/src/stand.rs` (new), `voice.rs`,
  `main.rs`: stand down (feature 33).
- `showcase/tauri/sidecar/quiet.mjs` (new), `checkin.mjs` (new), `sidekick.mjs`, `daily.mjs`, `handover.mjs`,
  `flow.mjs`, `calendar.mjs`, `answers.mjs`, `standdown.mjs`, `pi.mjs`, `showcase/roamies/host.js`, `10-dither.js`,
  `showcase/tauri/src-tauri/src/presence.rs` (new), `main.rs`: check-ins, the speaking budget and the quiet queue
  (features 25 and 31).
- `showcase/tauri/sidecar/reference.mjs` (new): writes `settings.default.json` and words the start-up bubble.
- `showcase/tauri/sidecar/localvoice.mjs` (new): the built-in voice.
- `showcase/tauri/sidecar/kokorovoice.mjs` (new): the natural voice: starts and watches the helper, its sandbox
  profile, the fallback, the splitting of long sentences.
- `showcase/tauri/sidecar/kokoro_server.py` (new): the helper's script, copied into the app by `bundle.sh`.
- `showcase/tauri/sidecar/persona.mjs` (new): the manner: the model's instructions, the form of address on lines
  worded by the app, and the parts of upstream's reply style it replaces.
- `showcase/tauri/sidecar/sidekick.mjs`: wires pi in, the new rules, no update checks, no Fish key, Claude Code switches;
  its own look-up of what is in front (`whereFront`), giving the never-look list the app's name; the start-up
  settings bubble; starts and stops the natural voice and shows its failure bubble; the persona in the model's
  instructions in place of upstream's opening, personality line, voice cues and beats; the form of address on the
  app's own lines.
- `showcase/tauri/sidecar/tools.mjs`: `fetch_url` removed.
- `showcase/tauri/sidecar/speaker.mjs`, `draw.mjs`, `activity.mjs`, `safety.mjs`: voice, no card lookups, labels, logging
  (`write_note`'s to-do id is logged, its text never).
  `speaker.mjs` also has marks (the overlay reports when a line has finished playing) and `hush` (stops what is
  playing without ending the reply's voice). Which voice a reply uses is asked at each reply, the audio's rate
  comes from the voice, and the beats can be replaced (`setBeats`).
- `showcase/roamies/voice-out.js`: answers a mark when what was handed over has finished playing.
- `showcase/tauri/src-tauri/voice/main.swift`: an answer window (`listen` with `seconds`): the helper closes the
  microphone at its end itself, and marks what it heard with the window's id. `--test-window` checks it.
- `showcase/tauri/src-tauri/src/main.rs`, `voice.rs`: pass the window's seconds and id through; the window opening
  by itself doesn't move the overlay to the pointer's display.
- `showcase/roamies/home.js` (new): where the home spot is, and its margins for the reference file.
- `showcase/roamies/agent.js`: a bubble with buttons grows to show its whole question; the home position.
- `showcase/roamies/core.js`: the frame loop stops while the character rests at home; no dozing off there.
- `showcase/roamies/jarvis.js`, `10-dither.js`: JARVIS's globe holds still while it rests at home, so the page stops
  drawing with this look as it does with the others (feature 24).
- `showcase/roamies/10-dither.js`: JARVIS's points are kept in two arrays made once, not in a Map emptied on every
  frame, which made the overlay page grow by megabytes a second (feature 24).
- `showcase/tauri/sidecar/leftovers.mjs` (new), `pi.mjs`: the extension a hand-off that can edit is started with, its
  record, and ending the groups it records when pi stops (feature 24).
- `showcase/tauri/sidecar/pi.mjs`, `sidekick.mjs`: pi's process group is ended with it, at quit and when the
  background process dies; the Claude Agent SDK's warning that our tools are allowed by name is noted once as
  `sdk_notice`, not logged as an error (feature 24).
- `showcase/tauri/sidecar/live.mjs` (new): the live state as named parts, sent only when they change (feature 24).
- `showcase/tauri/sidecar/store.mjs`, `claudecode.mjs`: the fold point from `limits.historyTokens` and a fold plan
  that counts what is really sent; Claude Code starting a session of its own is told so, so the live state goes
  in full (feature 24).
- `showcase/tauri/sidecar/bench/` (new): the measuring tools of feature 24. Not run by `npm test`, not in the app.
- `showcase/tauri/src-tauri/src/pipe.rs` (new), `main.rs`, `voice.rs`, `sidecar.rs`: what goes to the sidecar and
  to the voice helper is written by a thread of its own, so the app always answers a quit, even when a helper has
  stopped reading (feature 24).
- `showcase/tauri/sidecar/kokorovoice.mjs`, `speaker.mjs`, `sidekick.mjs`, `pi.mjs`: the natural voice's helper
  sleeps when quiet and is woken; a reply keeps one voice, its "one moment" line included (feature 24).
- `showcase/tauri/sidecar/rebuild.mjs` (new), `sidekick.mjs`, `showcase/roamies/host.js`, `agent.js`,
  `10-dither.js`, `showcase/tauri/src-tauri/src/main.rs`: the overlay page made afresh after a quiet stretch; the
  page says when it is at rest at home; the shell makes the new page beside the old one and holds what comes for it
  meanwhile; the character comes on in it at once, without an entrance (feature 24). `core.js`, `measure.js` (new),
  `desktop.html`: the new page reports when it has drawn the character, and the old page goes then; settle uses the
  newest size and holds the spot for its first seconds; the `measurePageRebuild` measuring (feature 24, 2026-11-25).
- `showcase/roamies/host.js`: takes the `home` setting; Esc isn't held while the character only rests; a bubble
  with buttons stays on screen as it is while you talk; reports marks; shows the "Heard" line.
- `showcase/desktop.html`: loads `home.js`.
- `showcase/panel/panel.js`, `showcase/onboarding/onboarding.js`: the Fish key controls and update button are gone.
- `showcase/tauri/src-tauri/tauri.conf.json`: no updater endpoints or artifacts.
- `showcase/tauri/sidecar/test/pi.test.mjs`, `test/leftovers.test.mjs`, `test/pi-extension.test.mjs`, `test/notes.test.mjs`, `test/guard.test.mjs`, `test/localvoice.test.mjs`,
  `test/settings.test.mjs`, `test/sandbox.test.mjs`, `test/home.test.mjs`, `test/home-page.test.mjs`,
  `test/looks-rest.test.mjs`, `test/page.mjs`, `test/rebuild.test.mjs`, `test/rebuild-run.test.mjs`, `test/live.test.mjs`, `test/reference.test.mjs`, `test/calendar.test.mjs`, `test/adopt.test.mjs`, `test/flow.test.mjs`, `test/kokorovoice.test.mjs`, `test/persona.test.mjs`, `test/standdown.test.mjs`, `test/stand-page.test.mjs`, `test/standdown-run.test.mjs`, `test/stand-phrases.json` (new),
  `package.json`: tests.

## Build (macOS)

Needs the Xcode Command Line Tools, Rust and Node.js 22 or newer.

```bash
cd showcase/tauri
(cd sidecar && npm ci && npm run test:all)
cargo install tauri-cli --version "^2" --locked
./build.sh
open src-tauri/target/release/bundle/macos
```

Drag `Roamies.app` to Applications. The app is ad-hoc signed, so after each rebuild macOS keeps the old permission:
System Settings shows it as on, but it no longer applies. Before opening the new build, reset both:

```bash
tccutil reset ScreenCapture com.kenkai.roamies
tccutil reset Accessibility com.kenkai.roamies
```

Then grant both again in System Settings > Privacy & Security (Screen & System Audio Recording, and Accessibility)
and reopen Roamies.

## The voice

**The natural voice.** With `"voiceEngine": "kokoro"` replies are spoken by Kokoro (`bm_george` by default), which
runs on the Mac. No cloud voice is used and no voice is cloned: a voice is used only if its file is in the model's
own `voices` folder.

- Roamies starts one helper at start-up and keeps it loaded: the Python at `kokoro.python`, running
  `kokoro_server.py`, a script shipped in the app. It is started directly, never through a shell, with a fixed list
  of arguments. `kokoro.python` is used only if it is a full path to a program that exists.
- There is no port. Each sentence goes in on the helper's input pipe and the audio comes back on its output pipe.
  What is to be said is never on a command line.
- The script never writes or logs the text it is given. Everything the helper prints on its error stream is thrown
  away, so none of it reaches Roamies' logs. A failure reaches Roamies only as the kind of error (one word), without
  the sentence.
- It runs under `sandbox-exec`: every kind of network is denied; it may write only in its own temporary folder (made
  at start, owner-only, removed at quit; Roamies puts a copy of the script there and runs it from there); in your
  home folder it may read only the model's own files (and its Python's folder, if that is in the home folder); it
  may start no other program. Its environment is a fixed list with the libraries' offline switches
  (`HF_HUB_OFFLINE` and the like) and nothing of Roamies' own: no proxy settings, no tokens.
- A sentence longer than `limits.kokoroSentenceChars` is split at a clause (a comma, semicolon, colon or dash), else
  between words, so each piece is made quickly. A piece being made when you start talking is finished and thrown
  away; what you say next waits for it.
- Its memory: about 650 to 700 MB between sentences (the model and the libraries that turn text into sounds).
  While a sentence is made it rises for under a second, more for a longer sentence: to about 1.3 GB for one at
  `limits.kokoroSentenceChars` (120), then back. `kokoro.cacheMB` and `kokoro.memoryMB` are what bound it: without
  them the same sentence took the helper to 3.8 GB. `bench/kokorocheck.py` measures it with the real model.
- If the helper can't start, stops, answers wrongly or takes longer than `limits.kokoroTimeoutSeconds` over a
  sentence, one bubble says so ("My natural voice isn't working (…), so I'm using the Mac's voice until you restart
  me.") and the Mac's voice speaks from that sentence on, until Roamies is restarted. While the helper is still
  loading at start-up, the Mac's voice speaks.
- **One voice per reply.** A reply is spoken by the natural voice only if the helper is ready when the reply
  starts, and then to its end; otherwise by the Mac's voice to its end, even if the helper becomes ready meanwhile.
  A short "one moment" line kept in the other voice is said afresh in the reply's own. (Only a helper that fails in
  the middle of a reply makes the rest of it the Mac's.)
- **Asleep when quiet.** With `kokoro.sleepAfterMinutes` above 0 (0, the default, is never), the helper is ended
  after that many minutes in which it was asked for no sentence and no reply in its voice was open, which gives its
  650 to 700 MB back. Nothing is said or shown; the log has `kokoro_sleep`. It is started again (`kokoro_wake`) when
  you press the talk keys, when an answer window opens, when a spoken request arrives, and 2 minutes before a
  briefing is due. Until it is ready again, replies are spoken by the Mac's voice. A typed request and the app's own
  lines (a nudge, a notice) don't wake it.
- It ends when Roamies does: its input closes, it checks every 3 seconds that Roamies is still its parent, and at
  Quit it is killed after 2 seconds if it is still there.

**The Mac's own voices** speak with `"voiceEngine": "system"`, and whenever the natural voice can't. Which one is set in `~/Documents/roamies-pi/settings.json` (`voice` and
`voices`, above), using names exactly as `say -v '?'` lists them in Terminal, for example `Daniel (Enhanced)`.
Download better voices in System Settings > Accessibility > Spoken Content > System voice > Manage Voices. A change
to the file is picked up the next time Roamies speaks. A voice that isn't installed is skipped and the system voice
speaks instead.

## The manner

How Roamies speaks is the `persona` setting: a calm, capable butler by default, brief and exact, who addresses you
as "sir". It is a manner only.

- The model's instructions are built from it by code (`persona.mjs`). `manner` and `humour` go in as quoted
  descriptions of a tone. The text always ends with a fixed paragraph that no setting can change: the manner grants
  no permission and lifts no limit, every rule of this build comes first, and nothing is said to be done that was
  not. "Rules of this build" still follows it.
- It replaces upstream's opening ("a tiny glowing pixel creature"), its personality line, "the way you'd talk to a
  friend", the emoji, and the voice cues in square brackets, which only Fish Audio performed.
- A reply is at most `maxSentences` sentences unless you ask for an explanation, a list or a story.
- Lines worded by the app (nudges, notices, failures, the closing reply, the app's questions) get the form of
  address once, by code, closing their first sentence: "Nudge test is due at 14:05, sir.". Button labels, pi's own
  reply, quoted text and anything the model wrote are left as they are. With `"address": ""` nothing is added.
- When the form of address is used is decided by code, not by the model (`createAddressClock` in `persona.mjs`):
  at most once in `addressEverySeconds` (180 by default), counting the app's lines and the model's replies
  together. The live state tells the model either to use it once in a reply (told again for each such reply) or
  to leave it out until told otherwise; a
  line of the app's gets it only when the clock allows. A line that is both shown and said carries it in both. Two
  things carry it whatever the clock says, and count as a use: the first thing said after start-up, and the
  closing reply to "thanks". With `0` every reply and every line carries it. The model's reply is not checked or
  changed: it is told, and no more.
- The short line before something slow is one of `beats`, picked by code and spoken from audio made beforehand. The
  model is told to say nothing first; no request is made for a beat. A beat comes just before a reply, so it is said
  with the form of address taken out ("One moment."), unless `addressEverySeconds` is 0.
- The name is for the model only. Menus and labels keep the look's name.

## Updating

Nothing updates by itself. To move to a newer upstream version, get a patch made for that version and rebuild.
