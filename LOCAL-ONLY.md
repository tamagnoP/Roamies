# Local-only build, with file work handed to pi

This copy of Roamies is patched so that, while running, the only thing it sends anywhere is the conversation with
the AI provider you sign in to, and so that anything involving your files goes through pi (the pi coding agent)
after you approve it. Made against upstream commit `fa798b4` (app version 0.1.34), for macOS, with pi 1.5.0.

## What Roamies does itself

| It can | When |
| --- | --- |
| Look at the screen or a window | Only when your message refers to what's on screen |
| Open an app by name (Zotero, Inkscape) | Only when you name it. No websites, files or folders |
| Click and type in an app | Only when you ask, only in the app in front, and only with "Allow File Edits & Commands" on |
| Keep the to-do list and reminders | As before |
| Keep notes in your Obsidian vault | Writes only when you ask; can add to a note, never change or delete one |
| Hand a task to pi | Read-only tasks after a short countdown you can stop; tasks that can edit only after you say send |

Its own file and command tools (`read_file`, `list_files`, `search_files`, `write_file`, `run_command`) and
`fetch_url` are removed. The limits themselves are enforced in code: apps only, the front app only, the switch for
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
  "autoListenQuestions": true,
  "closingReply": "Any time.",
  "speakNotices": true,
  "voiceEngine": "kokoro",
  "kokoro": { "python": "/opt/homebrew/anaconda3/envs/localai/bin/python", "model": "mlx-community/Kokoro-82M-bf16",
              "voice": "bm_george", "lang": "b", "speed": 1.05, "cacheMB": 0, "memoryMB": 400 },
  "persona": { "name": "Jarvis", "address": "sir", "manner": "calm, precise, formally polite, loyal",
               "humour": "dry and rare", "maxSentences": 2,
               "beats": ["One moment, sir.", "Checking now, sir.", "Right away, sir."],
               "addressEverySeconds": 180 },
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
    "kokoroSentenceChars": 120
  },
  "calendar": { "dayStart": "09:00", "dayEnd": "18:00", "lunch": ["12:30", "13:30"], "gapMinutes": 0, "syncSeconds": 60 }
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
  end-of-day summary (saved to the vault as "Daily log <date>"). Each is given once a day, when Roamies is idle: the
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

`settings.default.json`: the reference described above. Written by Roamies at every start, never read by it.

`log/`: one `.jsonl` file per hand-off, named by date, time and mode. The first line is what was sent (prompt,
folder, mode, whether you approved by click or by voice, and the undo snapshot if there is one), then pi's events as
it emitted them (without the letter-by-letter streaming updates), then the result. Records older than `keepLogsDays`
are deleted.

`state.json`: Roamies' own memory, which it writes itself: the project you last switched to (with what `project` was at
that moment, so a later edit of yours is noticed), the days the
briefings were given, under `pending` the questions nobody answered (see "Conversation flow"; a pending hand-off's
prompt is kept there as plain text), and under `calendar` which to-do goes with which Super Productivity task, with the values both
had after the last sync. Deleting it is safe for the first two, and forgets the pending questions; without `calendar`, Roamies no longer knows which
tasks are its own: it asks again before putting the list in the app, and the tasks already there would be made a
second time.

`pending.txt`: appears only while a Send bubble is open for a prompt too long to fit in it, and holds the whole
prompt.

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
- A to-do that comes due: Roamies builds the nudge itself, from a fixed pattern ("Write report is due at 17:00.";
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

These are the only files Roamies touches itself. In code, a title is only ever a file name inside the vault, an
existing note is never written over, and nothing is changed or deleted. What it reads from your notes to answer you
becomes part of the conversation with your AI provider.

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
- A deadline in the app is the to-do's due time. An adopted task whose deadline had already passed gets no nudge;
  one that comes due later is nudged like any to-do (see Safeguards).
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
  check that the app is there gives up after one second, so a closed or hung app never holds up a to-do.
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

## What still uses the network

- Requests to Super Productivity on this Mac (`127.0.0.1:3876`). They don't leave the Mac.
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
- `showcase/tauri/sidecar/notes.mjs` (new): the notes vault.
- `showcase/tauri/sidecar/guard.mjs` (new): the never-look list.
- `showcase/tauri/sidecar/calendar.mjs` (new): the to-do list mirrored in Super Productivity, and the sync.
- `showcase/tauri/sidecar/answers.mjs` (new): yes/no bubbles that take a spoken answer; which words count; filler
  words, closing phrases, the "Heard" line.
- `showcase/tauri/sidecar/flow.mjs` (new): the exchange, the answer window, pending questions, `show_pending`.
- `showcase/tauri/sidecar/store.mjs`: two functions added: `renameCommitment`, so a title changed in the app reaches
  the list, and `makeCommitment`, which turns a reminder into a to-do.
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
- `showcase/tauri/sidecar/speaker.mjs`, `draw.mjs`, `activity.mjs`, `safety.mjs`: voice, no card lookups, labels, logging.
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
- `showcase/tauri/sidecar/live.mjs` (new): the live state as named parts, sent only when they change (feature 24).
- `showcase/tauri/sidecar/store.mjs`, `claudecode.mjs`: the fold point from `limits.historyTokens` and a fold plan
  that counts what is really sent; Claude Code starting a session of its own is told so, so the live state goes
  in full (feature 24).
- `showcase/tauri/sidecar/bench/` (new): the measuring tools of feature 24. Not run by `npm test`, not in the app.
- `showcase/roamies/host.js`: takes the `home` setting; Esc isn't held while the character only rests; a bubble
  with buttons stays on screen as it is while you talk; reports marks; shows the "Heard" line.
- `showcase/desktop.html`: loads `home.js`.
- `showcase/panel/panel.js`, `showcase/onboarding/onboarding.js`: the Fish key controls and update button are gone.
- `showcase/tauri/src-tauri/tauri.conf.json`: no updater endpoints or artifacts.
- `showcase/tauri/sidecar/test/pi.test.mjs`, `test/notes.test.mjs`, `test/guard.test.mjs`, `test/localvoice.test.mjs`,
  `test/settings.test.mjs`, `test/sandbox.test.mjs`, `test/home.test.mjs`, `test/live.test.mjs`, `test/reference.test.mjs`, `test/calendar.test.mjs`, `test/adopt.test.mjs`, `test/flow.test.mjs`, `test/kokorovoice.test.mjs`, `test/persona.test.mjs` (new),
  `package.json`: tests.

## Build (macOS)

Needs the Xcode Command Line Tools, Rust and Node.js 22 or newer.

```bash
cd showcase/tauri
(cd sidecar && npm ci && npm test)
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
