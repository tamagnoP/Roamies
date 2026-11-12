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
   replies on, it is read out too.
3. A task that can edit is sent only when you click Send, press Y, or say "send". A read-only task goes by itself
   after a few seconds (`autoSendReadOnly`), so you only act to stop it: click Don't send, or say anything other than
   "send". Starting to talk pauses the countdown.
4. pi starts in the background, in the project folder, as `pi --mode json`. What it's doing ("Pi's reading
   segment.py…") shows in a bubble, at most one every few seconds.
5. When pi finishes, Roamies tells you the gist in its own voice (with spoken replies on), and then pi's full reply,
   or its question back to you, goes on screen word for word. With text replies, the full reply is shown straight
   away. Your answer to a question goes back to the same pi session, after another Send.
6. While pi is working, Roamies can only talk, keep the to-do list and notes, or stop pi (say "stop pi", or Stop in
   the menu).

**Modes.** "Read only" starts pi with `--tools read,grep,find,ls`, so it cannot change anything. "Can edit" starts
it with its normal tools (read, bash, edit, write). The mode is in the Send bubble.

**pi runs as it does in Terminal**: same sign-in, same `~/.pi/agent` settings, rules and packages, started through
your login shell so `pi` and `node` are found. The model and thinking level are whatever pi's own settings say.

## The roamies-pi folder

`~/Documents/roamies-pi/` is made the first time it's needed.

`settings.json` is yours alone. Roamies makes it once, with the defaults, when it doesn't exist, and never writes it
again: it only reads it. What Roamies needs to remember goes in `state.json` (below).

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
  "voice": "",
  "voices": { "jarvis": "Daniel (Enhanced)" },
  "vault": "~/Documents/roamies-vault"
}
```

- `project`: the folder pi starts in (its working directory), until you tell Roamies to switch (see `projects`). The
  default is the `workspace` folder inside `roamies-pi`. The `roamies-pi` folder itself, or any folder that contains it, can't be a project, so pi is never
  started where it could rewrite these settings; a settings file that still names it means `workspace`.
- `projects`: the folders you can switch between by telling Roamies ("work on cell-segmentation"). Each is named by
  its last part; write `{"name": "folder"}` instead of a list to choose the names. Only you add to this list: Roamies
  can switch between listed projects, after a yes, and nothing more. A switch is remembered in `state.json`, not
  here, and holds for as long as that folder is still in this list; take it off the list (or delete `state.json`)
  and pi is back in `project`. A project must be a folder inside your home
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
  morning one within four hours of its time, the evening one any time after it. Leave a time out to switch it off.
- `neverLook`: apps Roamies never screenshots, reads or works in (see Safeguards). `[]` switches the check off.
- `vault`: the Obsidian vault Roamies keeps notes in (see below). It must be a folder inside your home folder.
- `voice`: the Mac voice every character speaks in; `""` means the system voice.
- `voices`: a voice per character, which wins over `voice`. The characters are `classic` (Roamie), `jarvis`, `anime`,
  `sarah` and `adrian`. If you leave `voices` out, JARVIS speaks as `Daniel` (British English).

`log/`: one `.jsonl` file per hand-off, named by date, time and mode. The first line is what was sent (prompt,
folder, mode, whether you approved by click or by voice, and the undo snapshot if there is one), then pi's events as
it emitted them (without the letter-by-letter streaming updates), then the result. Records older than `keepLogsDays`
are deleted.

`state.json`: Roamies' own memory, which it writes itself: the project you last switched to, and the days the
briefings were given. Deleting it is safe.

`pending.txt`: appears only while a Send bubble is open for a prompt too long to fit in it, and holds the whole
prompt.

## Talking with it

- **Answering without a key.** With "Auto Listen" on (the menu, or the panel's Voice page), the microphone opens by
  itself after Roamies asks you something. That now includes questions pi sends back: Roamies ends its spoken gist
  with pi's question and listens for your answer.
- **Long tasks.** While pi works, Roamies says now and then that it's still going and what it's on.
- **Read-only trust.** A read-only pi can still read any file it can reach, and what it reads goes to pi's AI
  provider. If a project holds things you'd rather approve each time, set `autoSendReadOnly` to `0`.

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

**The never-look list.** Apps in `neverLook` are never captured, read or worked in. A screenshot or read of such an
app, or of the front window while it is in front, is refused. A whole-screen screenshot is refused while one has a
window open, because it could be in the picture. Its windows are left out of window lists, and its name and window
title are hidden from what is sent with each request. If the open windows can't be listed, nothing is captured.
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

## What the patch changes besides pi

| Area | Upstream | This build |
| --- | --- | --- |
| Update checks | GitHub, 20 s after launch and every 6 hours | Never |
| Photo and source cards | Wikipedia thumbnails, picture URLs, site favicons | No lookups (map cards use outlines shipped in the app) |
| Spoken replies | Fish Audio (cloud), with your key | The Mac's own voice through `/usr/bin/say` |
| Claude Code (Anthropic sign-in) | Usage metrics and error reports on | Switched off by environment variables |

Voice input is unchanged: on macOS 26 it is Apple's on-device speech recognition.

## What still uses the network

- Roamies' conversation with your AI provider: messages, the front app and window title, saved memory, and
  screenshots or window text when you ask about your screen.
- pi's own conversation with its provider, using pi's sign-in. Whatever pi does with its tools, including any
  command it runs in "Can edit" mode, is governed by your pi setup, not by this patch.
- Signing in to Anthropic the first time: a browser sign-in, and a one-time download of the Claude Code program.
- Links you click in a reply open in your browser.
- Building: `npm ci`, `cargo` and `fetch-node.sh` download dependencies once, at build time.

## Files changed

- `showcase/tauri/sidecar/pi.mjs` (new): the hand-off, the Send approval, the background job, the record, projects,
  and the gate that removes the file tools and narrows `open`, `act_in_app` and `draw`.
- `showcase/tauri/sidecar/notes.mjs` (new): the notes vault.
- `showcase/tauri/sidecar/guard.mjs` (new): the never-look list.
- `showcase/tauri/sidecar/localvoice.mjs` (new): the built-in voice.
- `showcase/tauri/sidecar/sidekick.mjs`: wires pi in, the new rules, no update checks, no Fish key, Claude Code switches.
- `showcase/tauri/sidecar/tools.mjs`: `fetch_url` removed.
- `showcase/tauri/sidecar/speaker.mjs`, `draw.mjs`, `activity.mjs`, `safety.mjs`: voice, no card lookups, labels, logging.
- `showcase/roamies/agent.js`: a bubble with buttons grows to show its whole question.
- `showcase/panel/panel.js`, `showcase/onboarding/onboarding.js`: the Fish key controls and update button are gone.
- `showcase/tauri/src-tauri/tauri.conf.json`: no updater endpoints or artifacts.
- `showcase/tauri/sidecar/test/pi.test.mjs`, `test/notes.test.mjs`, `test/guard.test.mjs`, `test/localvoice.test.mjs`,
  `test/settings.test.mjs` (new), `package.json`: tests.

## Build (macOS)

Needs the Xcode Command Line Tools, Rust and Node.js 22 or newer.

```bash
cd showcase/tauri
(cd sidecar && npm ci && npm test)
cargo install tauri-cli --version "^2" --locked
./build.sh
open src-tauri/target/release/bundle/macos
```

Drag `Roamies.app` to Applications. The app is ad-hoc signed, so macOS asks for its permissions again after each
rebuild.

## The voice

Replies are spoken by the Mac's own voices. Which one is set in `~/Documents/roamies-pi/settings.json` (`voice` and
`voices`, above), using names exactly as `say -v '?'` lists them in Terminal, for example `Daniel (Enhanced)`.
Download better voices in System Settings > Accessibility > Spoken Content > System voice > Manage Voices. A change
to the file is picked up the next time Roamies speaks. A voice that isn't installed is skipped and the system voice
speaks instead.

## Updating

Nothing updates by itself. To move to a newer upstream version, get a patch made for that version and rebuild.
