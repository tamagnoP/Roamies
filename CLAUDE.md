# Roamies, local-only build

This is a personal fork of [KenKaiii/Roamies](https://github.com/KenKaiii/Roamies), a desktop AI companion built with
Tauri. All work happens on the `local-only` branch of `tamagnoP/Roamies`. `LOCAL-ONLY.md` describes every change
made to upstream and is the user-facing reference: read it before changing anything.

## What this build must guarantee

These are the reasons the fork exists. A change that weakens one needs the owner's explicit yes first.

1. **Nothing leaves the Mac except the conversation with the AI provider.** No update checks, telemetry, web
   fetches, card image lookups or cloud voices. Do not add a network call, a new dependency, or a download.
   One exception, which stays on the Mac: requests to Super Productivity's local REST API on the loopback address
   (`127.0.0.1:3876`), made only by `calendar.mjs`, only the requests listed in `SP.requests` (never `DELETE`), with
   the app's access token read from its own file for each request and kept nowhere.
2. **Roamies does not touch files or run commands itself.** File work is handed to pi (`pi.mjs`). The only files it
   writes are notes inside the Obsidian vault (`notes.mjs`), where it can create and append but never change or delete,
   and its own files in `~/Documents/roamies-pi` (`state.json`, the records in `log`, `pending.txt`, and
   `settings.default.json`). It never writes `settings.json` after making it, and never reads `settings.default.json`.
3. **A hand-off that can edit is sent only after the owner says send.** Read-only hand-offs may send themselves after
   the `autoSendReadOnly` countdown. The exact prompt, folder and mode are always shown first.
4. **An undo snapshot is taken before any hand-off that can edit** (git ref under `refs/roamies/`).
5. **Apps on the never-look list are never captured, read or worked in** (`guard.mjs`), and the check fails closed.
6. **`open` takes an app name only; `act_in_app` works the front app only.** Both limits live in `gateTools`.
7. **pi is never started in the folder that holds `settings.json`**, or in any folder containing it.

Limits enforced in code stay in code. Do not replace one with an instruction in the model's prompt.

## Layout

| Path | What it is |
| --- | --- |
| `showcase/tauri/sidecar/` | The Node.js sidecar: the agent, its tools and prompts. Most work happens here. |
| `showcase/tauri/sidecar/sidekick.mjs` | Main sidecar file: prompts, turn handling, menu, voice wiring. Upstream's, with marked edits. |
| `showcase/tauri/sidecar/pi.mjs` | Ours. Hand-off to pi, Send approval, background job, records, settings loader, `gateTools`. |
| `showcase/tauri/sidecar/notes.mjs` | Ours. The Obsidian vault tools. |
| `showcase/tauri/sidecar/guard.mjs` | Ours. The never-look list. |
| `showcase/tauri/sidecar/calendar.mjs` | Ours. The to-do list mirrored in Super Productivity: the requests, the sync, its tools. |
| `showcase/tauri/sidecar/store.mjs` | Upstream's storage (sessions, to-dos, memory). One marked function of ours: `renameCommitment`. |
| `showcase/tauri/sidecar/reference.mjs` | Ours. Writes `settings.default.json`; the start-up bubble for missing or unusable settings. |
| `showcase/tauri/sidecar/localvoice.mjs` | Ours. Spoken replies through `/usr/bin/say`. |
| `showcase/tauri/sidecar/test/` | One test file per module, plain `node:assert`, no framework. |
| `showcase/roamies/` | The overlay (character, bubbles), browser JavaScript drawn on a canvas. |
| `showcase/panel/`, `showcase/onboarding/` | Settings panel and setup guide. |
| `showcase/tauri/src-tauri/` | Rust shell and the Swift helpers (voice, screen, app control). |

Settings the owner edits live outside the repo, in `~/Documents/roamies-pi/settings.json`, read by `loadSettings`
in `pi.mjs`. Add new settings there, with a default that keeps existing files working, and document them in
`LOCAL-ONLY.md`.

**No setting has a value that lives only in code.** Every new setting goes into `settings.default.json` in the same
commit: its default in `DEFAULTS` (or `LIMITS`, for a size, time or count) and its check in `CLEAN`, both in
`pi.mjs`, which is all `loadSettings` and the reference file are built from. A guard or fixed fact that stays in
code is shown under `reference` (`codeReference` in `pi.mjs`), generated from the constant itself. The sandbox's
blocked list stays in code and no setting reaches it. `test/reference.test.mjs` fails if `loadSettings` reads a
setting the reference file lacks, or if anything reads `settings.default.json`.

## Commands

Run from `showcase/tauri`.

```bash
(cd sidecar && npm ci)          # only after a lockfile change
(cd sidecar && npm test)        # full sidecar suite; must pass before any commit
(cd sidecar && ./bundle.sh)     # bundles the sidecar; build.sh does this too
./build.sh                      # full app build, output in src-tauri/target/release/bundle/macos
```

To install a build (ask before reinstalling):

1. Quit Roamies and replace `/Applications/Roamies.app` with the built one.
2. Reset its two screen permissions:

   ```bash
   tccutil reset ScreenCapture com.kenkai.roamies
   tccutil reset Accessibility com.kenkai.roamies
   ```

3. Tell the owner to grant both again (System Settings > Privacy & Security > Screen & System Audio Recording, and
   Accessibility) and to reopen Roamies.

The app is ad-hoc signed, so a rebuilt app keeps a stale grant: macOS shows the switch as on but does not apply it.
The reset is what makes macOS ask again.

## How to make a change

- **Read first.** Read the code you are changing and the tests that cover it.
- **Mark edits to upstream files** with a comment starting `Local-only build:` saying what and why. Keep those diffs
  small; put new logic in our own modules.
- **Leave `tools.mjs` as upstream wrote it**, apart from the removed `fetch_url`. Upstream's Mac-only tests
  (`hands.test.mjs`) exercise `open` and `act_in_app` directly. Narrow tools in `gateTools` instead.
- **Every change gets a test** in `sidecar/test/`, added to the `test` script in `sidecar/package.json`. Stand in
  for pi, `say` and the window helper with fakes, as the existing tests do. Never call a real model from a test.
- **Update `LOCAL-ONLY.md`** in the same commit as the behaviour it describes.
- **If a test fails, find the cause.** Do not weaken or delete a test to get a pass; say what failed.
- **Update `ROADMAP.md`** in the same commit as any change of status: when a feature is started, finished, merged,
  or its plan changes, move its entry, fill in the branch and commit, and add a dated line to the decisions log for
  anything decided or reversed. `ROADMAP.md` is a record, not an instruction: only build a feature when the owner
  gives you its prompt.

## Git

- Work on a branch off `local-only`, named for the feature. Do not commit to `main`, and do not force-push.
- One commit per coherent change, with a plain message saying what changed.
- Push the branch and stop. The owner has it reviewed before it is merged into `local-only`.
- Never push to, or open a pull request against, `KenKaiii/Roamies`.

## Do not

- Read, change or delete anything in `~/Documents/roamies-pi`, the notes vault, `~/.pi` or `~/.gg`, except
  when a test needs a throwaway copy in a temp folder.
- Start pi with a real task, or sign in to anything, without asking.
- Change the model's prompt rules in `sidekick.mjs` beyond what the task needs.
- Refactor, rename or reformat code the task does not require.

## Working with the owner

- Do exactly what was asked. No unsolicited recommendations, refactors or extra features.
- If a request is ambiguous or has more than one reasonable design, ask one clarifying question and stop.
- Before a change that touches a guarantee above, or that cannot be tested on this Mac, say so and wait.
- Reports are short and factual: what changed, what was tested and how, what was not tested.
