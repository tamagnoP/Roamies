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

- `~/Documents/roamies-pi/settings.json`, `state.json` and the hand-off records in `log`;
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
  morning one within four hours of its time, the evening one any time after it. Leave a time out to switch it off.
- `sandbox`: `true` unless you write `false`. Switch it off only if it breaks pi; the Send bubble then warns on
  every hand-off (see "The sandbox pi runs in").
- `readOnly`: folders pi may read but never write, in every project. Default: none.
- `toolFolders`: more folders (or single files) that tools need to read, added to the built-in list in "The
  sandbox pi runs in". pi can read them, never write them. Default: none added.
- `toolFoldersOff`: built-in tool folders to take off that list, written as they appear there (`"~/.npm"`).
- `docker`: the projects in which pi may reach Docker and OrbStack. Default: none. A project listed here is not
  fully confined.
- These five are read from this file only, which pi can neither read nor write. A file from before they existed
  works as if it had the defaults.
- `neverLook`: apps Roamies never screenshots, reads or works in (see Safeguards). `[]` switches the check off.
- `vault`: the Obsidian vault Roamies keeps notes in (see below). It must be a folder inside your home folder.
- `voice`: the Mac voice every character speaks in; `""` means the system voice.
- `voices`: a voice per character, which wins over `voice`. The characters are `classic` (Roamie), `jarvis`, `anime`,
  `sarah` and `adrian`. If you leave `voices` out, JARVIS speaks as `Daniel` (British English).

`log/`: one `.jsonl` file per hand-off, named by date, time and mode. The first line is what was sent (prompt,
folder, mode, whether you approved by click or by voice, and the undo snapshot if there is one), then pi's events as
it emitted them (without the letter-by-letter streaming updates), then the result. Records older than `keepLogsDays`
are deleted.

`state.json`: Roamies' own memory, which it writes itself: the project you last switched to (with what `project` was at
that moment, so a later edit of yours is noticed), and the days the
briefings were given. Deleting it is safe.

`pending.txt`: appears only while a Send bubble is open for a prompt too long to fit in it, and holds the whole
prompt.

## Talking with it

- **Answering without a key.** With "Auto Listen" on (the menu, or the panel's Voice page), the microphone opens by
  itself after Roamies asks you something. That now includes questions pi sends back: Roamies ends its spoken gist
  with pi's question and listens for your answer.
- **Long tasks.** While pi works, Roamies says now and then that it's still going and what it's on.
- **Read-only trust.** A read-only pi can still read any file the sandbox lets it reach, and what it reads goes to pi's AI
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
- `showcase/tauri/sidecar/localvoice.mjs` (new): the built-in voice.
- `showcase/tauri/sidecar/sidekick.mjs`: wires pi in, the new rules, no update checks, no Fish key, Claude Code switches.
- `showcase/tauri/sidecar/tools.mjs`: `fetch_url` removed.
- `showcase/tauri/sidecar/speaker.mjs`, `draw.mjs`, `activity.mjs`, `safety.mjs`: voice, no card lookups, labels, logging.
- `showcase/roamies/agent.js`: a bubble with buttons grows to show its whole question.
- `showcase/panel/panel.js`, `showcase/onboarding/onboarding.js`: the Fish key controls and update button are gone.
- `showcase/tauri/src-tauri/tauri.conf.json`: no updater endpoints or artifacts.
- `showcase/tauri/sidecar/test/pi.test.mjs`, `test/notes.test.mjs`, `test/guard.test.mjs`, `test/localvoice.test.mjs`,
  `test/settings.test.mjs`, `test/sandbox.test.mjs` (new), `package.json`: tests.

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
