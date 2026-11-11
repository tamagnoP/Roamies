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
| Hand a task to pi | Only after you say send |

Its own file and command tools (`read_file`, `list_files`, `search_files`, `write_file`, `run_command`) and
`fetch_url` are removed. The limits themselves are enforced in code: apps only, the front app only, the switch for
clicking and typing, and Send before anything reaches pi. Whether you asked for it (that you referred to your screen,
or named an app) is a rule in its instructions, which the model follows but the code can't check.

## Handing a task to pi

1. You ask Roamies for something that needs a file ("ask pi to explain segment.py").
2. A bubble shows exactly what will be sent, the folder, and the mode, with **Send** and **Don't send**. With spoken
   replies on, it is read out too.
3. Nothing is sent until you click Send, press Y, or say "send". Saying anything else, or Don't send, cancels it.
4. pi starts in the background, in the project folder, as `pi --mode json`. Each step it takes ("pi · reading
   segment.py") shows in a bubble.
5. pi's reply, or its question back to you, is shown in full and read aloud by the app itself, not retold by the
   model. Your answer to a question goes back to the same pi session, after another Send.
6. While pi is working, Roamies can only talk, keep the to-do list, or stop pi (say "stop pi", or Stop in the menu).

**Modes.** "Read only" starts pi with `--tools read,grep,find,ls`, so it cannot change anything. "Can edit" starts
it with its normal tools (read, bash, edit, write). The mode is in the Send bubble.

**pi runs as it does in Terminal**: same sign-in, same `~/.pi/agent` settings, rules and packages, started through
your login shell so `pi` and `node` are found. The model and thinking level are whatever pi's own settings say.

## The roamies-pi folder

`~/Documents/roamies-pi/` is made the first time it's needed.

`settings.json`:

```json
{
  "project": "~/Documents/roamies-pi",
  "projects": ["~/Documents/roamies-pi", "~/Documents/cell-segmentation"],
  "pi": "pi",
  "maxMinutes": 60,
  "voice": "",
  "voices": { "jarvis": "Daniel (Enhanced)" }
}
```

- `project`: the folder pi starts in (its working directory).
- `projects`: the folders you can switch between by telling Roamies ("work on cell-segmentation"). Each is named by
  its last part; write `{"name": "folder"}` instead of a list to choose the names. Only you add to this list: Roamies
  can switch between listed projects, after a yes, and nothing more. A project must be a folder inside your home
  folder.
- `pi`: the command that starts pi. If Roamies says it couldn't start pi, put the full path here (run `which pi`).
- `maxMinutes`: a task running longer than this is stopped.
- `voice`: the Mac voice every character speaks in; `""` means the system voice.
- `voices`: a voice per character, which wins over `voice`. The characters are `classic` (Roamie), `jarvis`, `anime`,
  `sarah` and `adrian`. If you leave `voices` out, JARVIS speaks as `Daniel` (British English).

`log/`: one `.jsonl` file per hand-off, named by date, time and mode. The first line is what was sent (prompt,
folder, mode, whether you approved by click or by voice), then pi's events as it emitted them (without the
letter-by-letter streaming updates), then the result. Nothing deletes these; clear the folder when you like.

`pending.txt`: appears only while a Send bubble is open for a prompt too long to fit in it, and holds the whole
prompt.

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
- `showcase/tauri/sidecar/localvoice.mjs` (new): the built-in voice.
- `showcase/tauri/sidecar/sidekick.mjs`: wires pi in, the new rules, no update checks, no Fish key, Claude Code switches.
- `showcase/tauri/sidecar/tools.mjs`: `fetch_url` removed.
- `showcase/tauri/sidecar/speaker.mjs`, `draw.mjs`, `activity.mjs`, `safety.mjs`: voice, no card lookups, labels, logging.
- `showcase/roamies/agent.js`: a bubble with buttons grows to show its whole question.
- `showcase/panel/panel.js`, `showcase/onboarding/onboarding.js`: the Fish key controls and update button are gone.
- `showcase/tauri/src-tauri/tauri.conf.json`: no updater endpoints or artifacts.
- `showcase/tauri/sidecar/test/pi.test.mjs`, `test/localvoice.test.mjs` (new), `package.json`: tests.

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
