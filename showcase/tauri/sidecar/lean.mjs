// What the model is shown of each tool's parameters, kept short: every request carries all of them. The length and
// count limits on every field came to about a quarter of it; the check still enforces them, and a call that breaks
// one comes back to the model with what was wrong. Field types and choices stay: without draw's typed fields DeepSeek
// guessed shapes ({x, y, z} for [x, y, z]) and lost drawings.
//
// Local-only build, feature 23 stage 1: taken whole from upstream (leanSchema, stripNulls, leanTools), and our own
// tools' descriptions in shorter words (SHORT), applied by name, so the files that define the tools stay as they are.
// A rule the code doesn't enforce stays in the short words; repetition and what the code enforces itself go.
import { z } from 'zod';
import { SP } from './pi.mjs';

const NOISE = new Set(['$schema', 'minLength', 'maxLength', 'additionalProperties']); // item counts stay: models overran them (9 labels for 8)
// Local-only build: zod 4 gives every int() the safe-integer bounds; those say nothing and go too.
const SAFE = (k, x) => (k === 'minimum' && x === Number.MIN_SAFE_INTEGER) || (k === 'maximum' && x === Number.MAX_SAFE_INTEGER);
const quiet = (v) => (Array.isArray(v) ? v.map(quiet) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !NOISE.has(k) && !SAFE(k, x)).map(([k, x]) => [k, quiet(x)])) : v);

/** The JSON schema the model sees for a zod schema: the same fields, types and choices, without the limits. */
export const leanSchema = (schema) => quiet(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

// Some models send null for a field they leave out. The agents strip those and check again, except for a tool with its
// own model-facing schema, so the check here does it first (no Roamies field takes null).
export function stripNulls(v) {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  return v;
}

/** Our own tools' descriptions, shorter. u: the owner's name. */
export const SHORT = (u) => ({
  remember_commitment: `Save a to-do or a reminder. The kind comes only from their word: "to-do" or "task" is 'commitment' (even minutes away), "remind me" is 'reminder', neither is 'commitment' (the default). Never choose the kind by how soon it is due. A reminder needs a time; without one it is kept as a commitment. due: "in 90s", "in 5m", "in 1h30m", "in 2 days", or local YYYY-MM-DDTHH:mm(:ss), or YYYY-MM-DD for a day only; omit when there is no time. Resolve "Thursday", "at 2", "tonight" from the timestamp on their message.`,
  update_commitment: 'Mark a to-do or reminder done or dropped, change its due (as in remember_commitment; "none" clears it), or make a reminder a to-do with kind \'commitment\' ("make that a to-do"): it keeps its text and time. Never save it again with remember_commitment for that.',
  list_commitments: `The to-do list. Without a filter: the outline (open, due today, this week, overdue, without a date, today's blocks); say it first when they ask what is open, then offer details. With a filter, when they ask about some or name one: those open to-dos with their ids, ${SP.titlesShown} at most, then "and N more" (say how many; skip: ${SP.titlesShown} gives the next). due: "today", "tomorrow", a weekday, YYYY-MM-DD, "this week", "overdue" or "none". words: from a title (to find a to-do's id). quadrant: an Eisenhower quadrant or "unsorted". Filters together all have to fit. Never read the whole list filter by filter.`,
  write_note: `Save a note in ${u}'s vault (Markdown), only when they ask to note, write down or save something. title: a few plain words, no folders. content: ${u}'s own words and meaning, tidied; add nothing. Link related notes as [[Title]] (titles search_notes found, or a new title worth a note of its own). A new title makes a new note; append true adds to the end of an existing one, which is otherwise never touched. task: a to-do's id, only when ${u} says the note is about it. A note is changed only with edit_note, and never deleted.`,
  search_notes: `Search ${u}'s notes by words in titles and text (empty: the most recently changed). Use when they ask what their notes say, and before writing a note that should link to others. Gives titles and matching lines.`,
  read_note: 'Read one note by its title, as search_notes gave it.',
  link_note: 'Link a note already in the vault to a to-do, when they ask (a line on the to-do\'s page and one at the end of the note). title: as search_notes gave it. task: the to-do\'s id.',
  notes_for: 'The notes about a to-do: on its page or linking to it. task: its id. Titles only.',
  schedule_block: 'Put a to-do on the calendar (Super Productivity) as a block: a start and a length. Give todo (an open to-do\'s id) or title (what they called it, in their words: never add to it, number it or reword it to tell it from a to-do on the list; whether it is the same one is not yours to decide). With a title the app finds the to-do, asks them itself when it is unclear or already has a block, and makes a new one when none fits; when several fit, the result lists them: ask which, then give its id. One block per to-do: scheduling it again moves it. minutes is needed unless the to-do has a length; if they didn\'t say how long, ask. The app asks about overlaps itself. If Super Productivity is closed the app keeps the slot and books it later: say what the result says, never that it is booked. date: the day as they said it: "today", "tomorrow", a weekday, "next friday" (the app asks them which), or YYYY-MM-DD for a date they named. Never work out a weekday\'s date or turn "next friday" into a date, and never ask which one yourself. For "from 10 to 11" give start and end (HH:MM, 24-hour) and no minutes. Say the day and times the result names.',
  move_block: 'Move a to-do\'s block to another day or time, or change its length. Give only what changes. If Super Productivity is closed the app keeps the move and makes it later: say what the result says, never that it is moved. date, start, end: as in schedule_block (the day as they said it; never a weekday\'s date of your own). Say the day and times the result names.',
  unschedule_block: 'Take a to-do\'s block off the calendar; the to-do stays.',
  show_day: 'What is on the calendar on a day: their to-dos\' blocks with times, and the time other Super Productivity tasks take. date: as in schedule_block.',
  plan_day: 'Plan a day: the to-dos in the order to do them, each with how long it takes (ask when they haven\'t said and it has no length). The app places them inside the working day around lunch and what is booked, shows the plan and creates it after their yes. from, until (HH:MM): only when they say to stretch or shorten the day. date: as in schedule_block.',
  set_priority: 'Mark a to-do urgent or not, important or not (the Eisenhower matrix), when they say so. Give only what they said.',
  sort_tasks: 'Propose a quadrant for each unsorted to-do: first list_commitments with quadrant "unsorted" (ten at a time), then urgent and important for each one listed, judged from its text and due time. The app applies it after their yes. For one to-do they placed themselves, use set_priority.',
  show_matrix: 'How many open to-dos are in each Eisenhower quadrant, and how many are unsorted; no titles. Say the numbers briefly and offer details (list_commitments with quadrant).',
  sync_todos: 'Sync the to-do list with Super Productivity now (it also syncs about once a minute): when they ask, or to put the list there the first time (the app waits for their yes).',
  show_pending: 'The app\'s unanswered questions waiting to be asked again, and the blocks kept until Super Productivity is open. When they ask what is pending, read them briefly. The app asks and books them itself: don\'t ask them or act on them.',
  item_dealt_with: `Close one of ${u}'s open items (the handover lists them with ids) when they say it is done or no longer needed. item: its id ("oi-…"). The app closes it at once when ${u}'s own words in this message say so, else asks; it says which it closed, so don't repeat it. Never for a to-do: use update_commitment.`,
  ask_pi: `Hand a task to pi, ${u}'s coding agent: the only way to change, make or run anything in ${u}'s files (reading them: read_file and the other file tools, when ${u} asks). prompt: a complete instruction in ${u}'s own words and intent, adding nothing they didn't ask for; pi hasn't seen this conversation or the screen, so include what it needs (file names, what was said, text read on screen if they asked about it). mode "read": read and search only; "edit": also change files and run commands, only when ${u} asked for something to be changed, made or run. follow_up true continues the last pi task in this project (e.g. ${u}'s answer to pi's question). ${u} sees the prompt first: a read task goes after a few seconds unless stopped, an edit task when they say send. Don't wait for pi: you're told when it has finished.`,
  stop_pi: `Stop pi's task, when ${u} says to stop or cancel it.`,
  switch_project: `Change the folder pi works in to one of the projects in the <live-state> block (you can't add to that list), only when ${u} asks. They confirm.`,
});

/** Gives each tool its short model-facing schema, and a check that drops nulls first; with `describe` (SHORT's map),
 *  our own tools their shorter descriptions. Changes the tools in place. */
export function leanTools(tools, { describe = {} } = {}) {
  for (const t of tools) {
    if (describe[t.name]) t.description = describe[t.name];
    if (t.rawInputSchema || !t.parameters) continue;
    const full = t.parameters;
    t.rawInputSchema = t.modelSchema ? t.modelSchema(leanSchema(full)) : leanSchema(full); // a tool may trim its own further
    t.parameters = z.preprocess(stripNulls, full);
  }
  return tools;
}
