# Lessons

Feature 37. After each mistake found in review or testing, three lines: what went wrong, why, and what to do
differently. Read this file at the start of each feature (CLAUDE.md, "How to work"). Newest last.

## A run test that failed after 18:00 (feature 24, 2026-11-25)

- **What went wrong:** `test/rebuild-run.test.mjs` failed when run in the evening: "the rebuild is asked for" didn't
  come in time.
- **Why:** the test home used the default settings, so the day's review fired at `calendar.reviewAt` (18:00) during
  the run, and its line restarted the quiet minute the test was waiting for. The test depended on the wall clock and
  had only ever run in the daytime.
- **Do differently:** in every run test, set each clock-driven setting (`reviewAt`, briefings, `dayTurnsAt`,
  `syncSeconds`) to off or far away unless the test is about it, and ask of each new test "what happens if this runs
  at 18:00, at midnight, at the day turn?". When a run test fails, have it print the activity log's kinds and times.

## The plan that was not saved (feature 23, 2026-11-25)

- **What went wrong:** the accepted plan for features 23 and 32, with the owner's answers, existed only in the
  conversation; when the context was compacted it was gone, and the owner had to put it together again
  (`offline-plan-and-answers.md`).
- **Why:** building started from the plan in the chat, before it was written to the reports folder or the repo.
- **Do differently:** before building anything, save the plan, the owner's answers verbatim and every bench set to
  `~/Documents/roamies-reports/` (file named with the real clock time) and record it in ROADMAP.md, then commit. If
  the context is lost and neither holds what is needed, ask the owner instead of reconstructing it.

## Bench sets tuned against (feature 23, 2026-11-26)

- **What went wrong:** the held-out set C and the new set D were meant to measure requests the local route had never
  seen, but the completeness check was designed from their misses; afterwards C scored 6 of 6, while the new set E,
  written after the check, had a wrong save.
- **Why:** changes to the prompt, the tools or the checks were made in answer to what an untuned set showed, which
  made it a tuning set; its score then overstated what an unseen request would get.
- **Do differently:** tune on A and B only. Never change a set, the prompt, the tools or the checks because of what C,
  D, E or F show; report their numbers as they are. Write a new set, committed before its first run, whenever an
  untuned measure is needed again.

## A model's raw output reported as a bench miss (feature 14, 2026-11-27)

- **What went wrong:** after the feature 14 bench, a local reply that was a tool call written out as text
  (`unschedule_block{todo:<|"|>…}`) would have reached the owner as the spoken reply; I reported it as a miss to
  decide on, and the owner had to ask for it never to be shown, spoken or run.
- **Why:** I read the bench as a score, and didn't ask what the owner would see and hear from that reply.
- **Do differently:** for each bench miss, say what reaches him (shown, spoken, saved, run); anything that isn't
  meant for him is a defect to fix in code by its shape (not tuned to the set), and reported as such.

## A file named by one common word (feature 14, 2026-11-27)

- **What went wrong:** "what's the plan for today?" counted as naming `plan.md`, so its text could be sent with no
  bubble; the review had to narrow it.
- **Why:** `namedIn` was written for the cases in the answers ("segment", "the data loader") without asking which
  everyday sentences also fit them.
- **Do differently:** for every rule that lets something through without a yes, write the everyday sentences that
  must not pass (a one-word name, a common word) as tests next to the ones that must.
