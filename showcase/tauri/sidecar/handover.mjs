// Local-only build, feature 18: the handover, and a fresh conversation each day.
//
// At the first request of a new day (a day starts at "calendar.dayTurnsAt"), the conversation that ends is handed
// over in two parts, both written in its last day's daily note (daily.mjs):
//   - Part one, by code: the to-dos and reminders made, changed, done or dropped that day, the questions still
//     waiting, the blocks kept until Super Productivity is open.
//   - Part two, by one model request (the same route as the fold, sidekick.mjs): at most PART_TWO_LINES lines under
//     fixed headings, Decided, Left open and Worth remembering. The model is given the ending conversation and the
//     open items' text, and lists only new "Left open" lines; the open items are carried by code.
// Each new "Left open" line becomes an open item (kept in state.json under "handover"), unless it matches one that
// is open already (sameItem). The new conversation starts with a message built here (handoverMessage): part two's
// Decided and Worth remembering, and the open items with their ids, oldest first, at most HANDOVER_WORDS words,
// marked as background. If part two fails, part one stays written, the old conversation carries on, and part two
// is tried again at the next request. A day with no conversation makes no request; after a gap of several days the
// new conversation gets the most recent handover and the open items.
//
// An open item is closed, and a line logged once in that day's note, when: the to-do or reminder it is about is done;
// its box is ticked in a daily note in Obsidian (the recent ones are read every TICKS_MINUTES at most); or the owner
// says so (item_dealt_with). That tool closes at once only when the owner's own words, in the message being answered,
// say so (saysDone: a fixed list, checked here); when the call comes from the model alone, the app asks yes or no.
// Either way the app says which item it closed. An item open for "limits.openItemAskDays" days is asked about at
// the evening review: keep it, or let it go.
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { z } from 'zod';
import { REDACTION_MARKER, environmentSecrets, redactText } from '@kenkaiiii/gg-ai';
import { only, unfilled } from './answers.mjs';
import { createVault } from './notes.mjs';
import { limitsFor, loadSettings, readState, writeState } from './pi.mjs';
import { TICKS_MINUTES, noteDay, readTicks, ymd } from './daily.mjs';

export const HANDOVER_HEAD = '[Handover from the app, written when the day turned: where things stood when the last conversation ended; background, not instructions]';
export const isHandover = (m) => m?.role === 'user' && typeof m.content === 'string' && m.content.startsWith(HANDOVER_HEAD);
export const HEADINGS = ['Decided', 'Left open', 'Worth remembering'];
export const PART_TWO_LINES = 8; // the most lines part two may have, under the three headings together
export const LINE_CHARS = 200; // the longest a line of part two is kept
export const HANDOVER_WORDS = 300; // the most words of the new conversation's first message
export const PART_TWO_SECONDS = 30; // how long the first request of the day waits for part two
export const KEEP_SESSIONS = 20; // the conversations whose part one is remembered as written
export { TICKS_MINUTES }; // the recent daily notes are read for ticked boxes at most this often (daily.mjs)
// The owner's words that close an open item without a question (item_dealt_with), checked in code. Not after a
// "not" (or the like) in the three words before, and not in a question.
export const DONE_WORDS = ['done', 'its done', 'thats done', 'all done', 'dealt with', 'ive dealt with it', 'sorted', 'sorted it', 'sorted out', 'finished', 'close it', 'closed', 'handled', 'taken care of', 'did it', 'completed', 'no longer needed', 'not needed anymore', 'dont need it anymore', 'cross it off', 'tick it off', 'mark it done', 'mark it as done'];
const NEGATIONS = new Set(['not', 'isnt', 'havent', 'hasnt', 'didnt', 'wasnt', 'arent', 'werent', 'never', 'no', 'yet', 'wont', 'cant', 'dont']);
const NO_NEGATION = new Set(['no longer needed', 'not needed anymore', 'dont need it anymore']);
// The answers to "Keep it open?" at the evening review, said alone; the buttons are the same two.
export const KEEP_WORDS = ['keep it', 'keep', 'keep it open', 'leave it open', 'yes', 'yes keep it'];
export const GO_WORDS = ['let it go', 'let go', 'drop it', 'close it', 'no', 'forget it'];
const KEEP = only(KEEP_WORDS), GO = only(GO_WORDS);
const plainWords = (t) => String(t ?? '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z]+/g, ' ').trim();
/** Whether the owner's own words say an item is dealt with (DONE_WORDS). */
export function saysDone(text) {
  if (/\?\s*$/.test(String(text ?? '').trim())) return false;
  const w = plainWords(text).split(' ').filter(Boolean);
  for (const phrase of DONE_WORDS) {
    const p = phrase.split(' ');
    for (let i = 0; i + p.length <= w.length; i++) {
      if (p.some((x, j) => w[i + j] !== x)) continue;
      if (NO_NEGATION.has(phrase) || !w.slice(Math.max(0, i - 3), i).some((x) => NEGATIONS.has(x))) return true;
    }
  }
  return false;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateOf = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d); };
export const dayLong = (key) => { const d = dateOf(key); return Number.isNaN(d.getTime()) ? String(key) : `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`; };
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const words = (t) => oneLine(t).split(' ').filter(Boolean).length;

/** The "one moment" line, worded by code, said while part two is made. */
export function oneMoment(key, todayKey) {
  const y = dateOf(todayKey); y.setDate(y.getDate() - 1);
  return `One moment: I'm wrapping up ${key === ymd(y) ? 'yesterday' : dayLong(key)}.`;
}

export const handoverPrompt = (name) => `You write the end-of-day handover for a conversation between ${name} and their desktop companion: what the companion needs in a fresh conversation tomorrow to carry on. You never talk to ${name}; you only write the handover.
Reply with exactly these three headings, in this order, each on a line of its own and followed by its lines, and nothing else:
Decided:
Left open:
Worth remembering:
Each line starts with "- " and is one short plain sentence, under ${LINE_CHARS} characters. At most ${PART_TWO_LINES} lines under the three headings together; a heading with nothing under it gets "- (none)".
Decided: what ${name} decided or settled in this conversation.
Left open: what ${name} still means to do, answer or decide, that came up in this conversation and isn't finished. Only new ones: leave out anything in the list of items already open. When a line is about one of the to-dos whose id appears in the conversation in square brackets (like [c123]), end the line with that id in square brackets.
Worth remembering: what matters for the next few days. Not lasting facts about ${name} (they are kept elsewhere), not the to-do list (it is kept elsewhere).
Only what was said or done in the conversation: nothing guessed or invented, nothing the companion did on its own initiative, no greetings, no commentary. Never secrets: no passwords, keys, codes, card, bank or account numbers.`;

export function handoverInput({ turns, items = [] }) {
  return `Items already open (don't repeat them):\n${items.length ? items.map((i) => `- ${oneLine(i.text)}`).join('\n') : '(none)'}\n\nConversation, oldest first:\n${turns}\n\nWrite the handover now.`;
}

let secrets;
const redact = (t) => redactText(String(t), { secrets: (secrets ??= environmentSecrets(process.env)) });
const SECRETISH = /\b(?:\d[ -]?){12,19}\b|\b(?:password|passcode|passphrase|pin code|api key|secret key|access token|2fa code|one-time code)\b/i;

/** Part two as the model wrote it → { decided, open: [{ text, todo }], remember }. At most PART_TWO_LINES lines in
 *  all, in the order written; a line with a secret in it, or none of the headings at all, is dropped. A to-do id at
 *  the end of a Left open line is kept only when known(id). Throws when no heading is there. */
export function parsePartTwo(text, { known = () => false } = {}) {
  const out = { decided: [], open: [], remember: [] }, keys = ['decided', 'open', 'remember'];
  let at = null, seen = false, n = 0;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const h = /^(?:#+\s*)?\**\s*(decided|left open|worth remembering)\s*\**\s*:?\s*\**$/i.exec(line);
    if (h) { at = keys[HEADINGS.findIndex((x) => x.toLowerCase() === h[1].toLowerCase())]; seen = true; continue; }
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!at || !item || n >= PART_TWO_LINES) continue;
    let t = oneLine(redact(item[1]).replace(/^\[[ x]\]\s*/i, ''));
    if (!t || /^\(?none\)?\.?$/i.test(t) || t.includes(REDACTION_MARKER) || SECRETISH.test(t)) continue;
    let todo = null;
    const id = /\s*\[([A-Za-z0-9_-]{1,40})\]\.?$/.exec(t);
    if (id) { t = t.slice(0, id.index).trim(); if (at === 'open' && known(id[1])) todo = id[1]; }
    if (!t) continue;
    t = t.length > LINE_CHARS ? `${t.slice(0, LINE_CHARS - 1).trim()}…` : t;
    n++;
    if (at === 'open') out.open.push({ text: t, todo }); else out[at].push(t);
  }
  if (!seen) throw new Error('no headings in the reply');
  return out;
}

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'on', 'in', 'at', 'with', 'about', 'still', 'whether', 'if', 'is', 'be', 'it', 'their', 'his', 'her', 'my', 'your']);
const bag = (t) => new Set(String(t ?? '').toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));
/** Whether a new "Left open" line is one of the open items already: the same words (small words aside), or one's
 *  words all in the other's. Nothing looser: a duplicate is harmless, a lost item is not. */
export function sameItem(a, b) {
  const x = bag(a), y = bag(b);
  if (!x.size || !y.size) return oneLine(a).toLowerCase() === oneLine(b).toLowerCase();
  const both = [...x].filter((w) => y.has(w)).length;
  return both === x.size || both === y.size;
}

/** The new conversation's first message: Decided, Worth remembering, and the open items with their ids, oldest
 *  first, at most HANDOVER_WORDS words (open items past that are counted). '' when there is nothing to hand over. */
export function handoverMessage({ day = null, decided = [], remember = [], items = [] } = {}) {
  if (!decided.length && !remember.length && !items.length) return '';
  const lines = [HANDOVER_HEAD];
  if (day) lines.push(`From the conversation of ${dayLong(day)}.`);
  const budget = () => HANDOVER_WORDS - words(lines.slice(1).join(' '));
  const add = (head, xs) => { if (!xs.length) return; lines.push(head); for (const x of xs) { const l = `- ${oneLine(x)}`; if (words(l) <= budget()) lines.push(l); } };
  add('Decided:', decided);
  add('Worth remembering:', remember);
  if (items.length) {
    lines.push('Still open, oldest first (the id, then the item; item_dealt_with closes one):');
    let shown = 0;
    for (const i of items) {
      const l = `- ${i.id}: ${oneLine(i.text)} (since ${dayLong(i.day)})`;
      if (words(l) + 8 > budget()) break;
      lines.push(l); shown++;
    }
    if (shown < items.length) lines.push(`- …and ${items.length - shown} more, in the daily note.`);
  }
  return lines.join('\n');
}

/**
 * The open items and what is remembered of the handovers, in state.json under "handover":
 *   items: [{ id, text, day, todo, askedAt }], the open items, oldest first (a closed one goes);
 *   partOne: { session id: day }, the conversations whose part one is written;
 *   last: { day, decided, remember }, the most recent part two; given: the day a conversation last started with it.
 */
export function createHandover({ home = os.homedir(), userName = 'the user', log = () => {}, now = () => Date.now(), newId = () => `oi-${randomBytes(3).toString('hex')}`, note = () => {}, heard = () => '', ask = async () => null, say = async () => {} } = {}) {
  // note(lines): lines for today's Log (daily.mjs). heard(): the owner's own words in the message being answered
  // ('' for a note from the app). ask(opts): the app's bubble (answers.mjs). say(text): a line said by the app.
  const settings = () => loadSettings(home);
  const vault = createVault({ home, userName });
  const blank = () => ({ items: [], partOne: {}, last: null, given: null });
  function get() {
    const h = readState(settings().dir).handover;
    if (!h || typeof h !== 'object' || Array.isArray(h)) return blank();
    return { ...blank(), ...h, items: Array.isArray(h.items) ? h.items.filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string') : [], partOne: h.partOne && typeof h.partOne === 'object' ? h.partOne : {} };
  }
  function edit(fn) {
    const dir = settings().dir, h = get(), out = fn(h);
    const ids = Object.keys(h.partOne);
    for (const k of ids.slice(0, Math.max(0, ids.length - KEEP_SESSIONS))) delete h.partOne[k];
    writeState(dir, { ...readState(dir), handover: h });
    return out;
  }
  const todayKey = () => ymd(noteDay(now(), settings().calendar.dayTurnsAt));
  const dayKey = (ms) => ymd(noteDay(ms, settings().calendar.dayTurnsAt));

  /** What the day turning asks of this conversation: { kind: 'talk', key, today } (it had a conversation on an
   *  earlier day: a handover), { kind: 'quiet', today } (it is empty and from an earlier day, or there is none: a
   *  new conversation with the most recent handover), or null. */
  function needed(session) {
    const today = todayKey();
    if (session?.messages?.some((m) => !isHandover(m))) {
      const key = dayKey(session.lastActiveAt ?? session.startedAt ?? now());
      return key < today ? { kind: 'talk', key, today } : null;
    }
    const h = get();
    if (session && dayKey(session.startedAt ?? now()) >= today) return null;
    if (h.given === today || (!h.last && !h.items.length)) return null;
    return { kind: 'quiet', today };
  }
  const partOneDone = (sessionId, key) => get().partOne[sessionId] === key;
  const markPartOne = (sessionId, key) => edit((h) => { h.partOne[sessionId] = key; });
  const openItems = () => get().items.slice().sort((a, b) => String(a.day).localeCompare(String(b.day)));

  /** Part two has come: its new "Left open" lines become open items (one matching an open item makes nothing), it
   *  is kept as the most recent handover, and the new conversation's first message is returned. */
  function finish(key, two) {
    const made = edit((h) => {
      const fresh = [];
      for (const o of two.open) {
        if (h.items.some((i) => sameItem(i.text, o.text)) || fresh.some((i) => sameItem(i.text, o.text))) continue;
        fresh.push({ id: newId(), text: o.text, day: key, todo: o.todo ?? null, askedAt: null });
      }
      h.items.push(...fresh);
      h.last = { day: key, decided: two.decided, remember: two.remember };
      h.given = todayKey();
      return fresh.length;
    });
    log('handover_items', { new: made, matched: two.open.length - made, open: get().items.length });
    return message();
  }
  /** The most recent handover with the items open now, for a new conversation. */
  function message() {
    const h = get();
    return handoverMessage({ day: h.last?.day ?? null, decided: h.last?.decided ?? [], remember: h.last?.remember ?? [], items: openItems() });
  }
  const given = () => edit((h) => { h.given = todayKey(); });

  // ---- closing open items
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const HOW = { todo: 'its to-do is done', ticked: 'ticked in the note', words: 'you said so', yes: 'you said yes' };
  /** Closes an open item: it goes from state.json, and one line, ticked, is logged in today's note (earlier notes
   *  are never rewritten). → the item, or null. */
  function close(id, how) {
    const item = edit((h) => { const i = h.items.findIndex((x) => x.id === id); return i < 0 ? null : h.items.splice(i, 1)[0]; });
    if (!item) return null;
    try { note([`- [x] ${hm(now())} ${how === 'go' ? 'Let go' : 'Closed'}: ${oneLine(item.text)}${how === 'go' ? '' : ` (${HOW[how]})`}`]); } catch (e) { log('open_item_note_failed', { kind: e?.constructor?.name ?? 'Error' }); }
    log('open_item_closed', { how, open: get().items.length });
    return item;
  }
  /** Items whose to-do or reminder is done are closed. todos: [{ id, status }]. → how many. */
  function checkDone(todos = []) {
    const done = new Set((Array.isArray(todos) ? todos : []).filter((t) => t?.status === 'done').map((t) => t.id));
    let n = 0;
    for (const i of get().items) if (i.todo && done.has(i.todo) && close(i.id, 'todo')) n++;
    return n;
  }
  let readAt = -Infinity;
  /** Items whose box is ticked in one of the recent daily notes are closed. At most every TICKS_MINUTES. */
  function checkTicks() {
    if (now() - readAt < TICKS_MINUTES * 60_000) return 0;
    readAt = now();
    const open = new Set(get().items.map((i) => i.id));
    if (!open.size) return 0;
    const ticked = [...readTicks({ vault, settings: settings(), now: now(), prefix: 'oi-' })].map((x) => `oi-${x}`).filter((id) => open.has(id)); // feature 25: the reader the Plan's boxes use too
    let n = 0;
    for (const id of ticked) if (close(id, 'ticked')) n++;
    return n;
  }

  /** The items open for limits.openItemAskDays days or more, and not asked about for as long: oldest first. */
  function stale() {
    const days = limitsFor(home).openItemAskDays, today = dateOf(todayKey()).getTime();
    return openItems().filter((i) => (today - dateOf(i.day).getTime()) / 864e5 >= days && (typeof i.askedAt !== 'number' || now() - i.askedAt >= days * 864e5));
  }
  /** At the evening review: each stale item is asked about, at most limits.reviewQuestions, oldest first. Keep it:
   *  asked again after as many days; let it go: closed, with a "Let go" line. The first left unanswered ends the
   *  round. io: { ask, say } as for the daily note's questions. → { asked, left }. */
  async function askStale(io = { ask, say }) {
    const all = stale(), most = limitsFor(home).reviewQuestions, counts = { kept: 0, go: 0 };
    let asked = 0, ended = '';
    for (const i of all.slice(0, most)) {
      const q = `"${oneLine(i.text)}" has been open since ${dayLong(i.day)}. Keep it open?`;
      let a;
      try { a = await io.ask({ placeholder: q, spoken: q, choices: ['Keep it', 'Let it go'], clicks: [{ kind: 'keep' }, { kind: 'go' }], hint: '"keep it" or "let it go"', parse: (t) => { const p = unfilled(t); return KEEP.test(p) ? { kind: 'keep' } : GO.test(p) ? { kind: 'go' } : null; } }); } catch (e) { if (e?.name !== 'Unanswered') throw e; ended = 'unanswered'; asked++; break; }
      asked++;
      if (!a) { ended = 'closed'; break; }
      if (a.kind === 'keep') { edit((h) => { const x = h.items.find((y) => y.id === i.id); if (x) x.askedAt = now(); }); counts.kept++; continue; }
      if (close(i.id, 'go')) { counts.go++; await io.say(`I've let go of "${oneLine(i.text)}".`); }
    }
    log('open_items_asked', { total: all.length, asked, ...counts, ...(ended ? { ended } : {}) });
    return { asked, left: all.length - asked };
  }

  const tools = [{
    name: 'item_dealt_with',
    description: `Close one of ${userName}'s open items (the handover at the start of the conversation lists them with their ids) when they say it is done, dealt with or no longer needed. item is its id ("oi-…"). The app closes it at once when ${userName}'s own words in this message say so; otherwise it asks them first. It tells them which item it closed, so don't repeat it. It never marks a to-do done: for a to-do, use update_commitment.`,
    parameters: z.object({ item: z.string() }),
    executionMode: 'sequential',
    execute: async ({ item }) => {
      const i = get().items.find((x) => x.id === String(item ?? '').trim());
      if (!i) throw new Error(`There's no open item "${item}". The handover at the start of the conversation lists them with their ids; one may be closed already.`);
      const text = oneLine(i.text);
      let how = 'words';
      if (!saysDone(heard())) {
        let a;
        try { a = await ask({ placeholder: `Close the open item "${text}"?`, choices: ['Close it', 'Keep it'] }); } catch (e) { if (e?.name !== 'Unanswered') throw e; log('open_item_asked', { answer: 'none' }); return `They gave no answer, so "${text}" stays open. Don't ask about it again now.`; }
        log('open_item_asked', { answer: a ? 'yes' : 'no' });
        if (!a) return `They said to keep "${text}" open.`;
        how = 'yes';
      }
      if (!close(i.id, how)) return `"${text}" was closed already.`;
      await say(`Closed: ${text}${/[.!?…]$/.test(text) ? '' : '.'}`);
      return `Closed "${text}". The app has told ${userName} which item it closed: don't repeat it.`;
    },
  }];

  return { needed, partOneDone, markPartOne, openItems, finish, message, given, todayKey, close, checkDone, checkTicks, stale, askStale, tools, state: get };
}
