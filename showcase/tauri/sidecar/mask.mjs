// Local-only build, feature 34: masking. The words on the owner's list ("mask" in settings.json: people,
// organisations, projects and other) are swapped by code for stand-ins ("Person 1", "Organisation 2", "Project 3",
// "Term 4") in everything sent to the provider, and swapped back in everything that comes back before it is shown,
// spoken, written or passed to a tool. The conversation on the Mac stays in his words; the local model gets them as
// they are. A stand-in's number is the word's for good: kept in state.json "masks", never given to another word.
//
// Matching (the plan of 2026-11-27, section 2): case, accents and the kinds of apostrophe are not told apart; a word
// inside another never matches, but _ - . / a digit or a lower-to-upper change is an edge ("AnaNotes", "acme.com");
// "'s", "s" and "es" after a word stay outside its stand-in; the words of a longer entry may be split by spaces, a
// line break or a hyphen; the longest entry wins. An entry with "exactCase" matches only as written.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const GROUPS = ['people', 'organisations', 'projects', 'other'];
export const LABELS = { people: 'Person', organisations: 'Organisation', projects: 'Project', other: 'Term' };
const LABEL_RE = 'person|organi[sz]ation|project|term';
const LABEL_CASED = '[Pp]erson|PERSON|[Oo]rgani[sz]ation|ORGANI[SZ]ATION|[Pp]roject|PROJECT|[Tt]erm|TERM';
const groupOfLabel = (l) => { const x = l.toLowerCase(); return x === 'person' ? 'people' : x.startsWith('organi') ? 'organisations' : x === 'project' ? 'projects' : 'other'; };
/** The sentence added to the provider's instructions while the list has words. The same whatever the list holds. */
export const MASK_NOTE = 'Some names reach you as stand-ins such as "Person 1", "Organisation 2", "Project 3" or "Term 4": the app swaps real names for them before you see anything, and swaps them back before anything you write is shown, spoken or used. Write a stand-in exactly as given (the same word, number and case), never guess who or what it stands for, and never ask.';
/** Said by code when web search is asked for while masking has turned it off (the owner, 2026-11-27, answer 3). */
export const WEB_OFF = 'Web search is off while your masking list has words in it, so nothing was searched or sent.';

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);
const WORD = /[\p{L}\p{M}]/u, LOWER = /\p{Ll}/u, UPPER = /\p{Lu}/u, MARK = /\p{M}/u;
const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
/** The text with case, accents, apostrophes, dashes and spaces folded, and where each folded unit came from. */
const foldChar = (ch) => {
  const g = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /^[’‘ʼ`´′]$/u.test(g) ? '\'' : /^[‐‑‒–—―]$/u.test(g) ? '-' : /^\s$/u.test(g) ? ' ' : g;
};
export function fold(s) {
  const ascii = (t) => t.toLowerCase().replace(/[`]/g, '\'').replace(/\s/g, ' ');
  if (isAscii(s)) return { f: ascii(s), map: null };
  // Most text folds unit for unit (an accented letter to its letter, a curly apostrophe to a straight one): then the
  // positions are the same and no map is needed. Only text that grows or shrinks (combining marks, ligatures) is
  // walked character by character.
  let same = true;
  const quick = s.replace(/[^\x00-\x7f]/gu, (ch) => { const g = foldChar(ch); if (g.length !== ch.length) same = false; return g; });
  if (same) return { f: ascii(quick), map: null };
  let f = '';
  const map = [];
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
    let g = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (/^[’‘ʼ`´′]$/u.test(g)) g = '\'';
    else if (/^[‐‑‒–—―]$/u.test(g)) g = '-';
    else if (/^\s$/u.test(g)) g = ' ';
    for (let k = 0; k < g.length; k++) map.push(i);
    f += g;
    i += ch.length;
  }
  map.push(s.length);
  return { f, map };
}
const at = (map, i) => (map ? map[i] : i);
const canon = (folded) => folded.replace(/[ -]+/g, ' ').trim();
/** An entry's key in the table: its main form, folded. A spelling fix is a new word. */
export const keyOf = (form) => canon(fold(String(form).trim()).f);
const norm = (s) => s.normalize('NFC').replace(/[\s\u00a0‐-―-]+/gu, ' ').trim();

// ---------- the list ----------
const STANDIN_SHAPE = new RegExp(`^(?:${LABEL_RE}) ?#? ?\\d+$`, 'iu');
const LABEL_WORDS = new Set(['person', 'organisation', 'organization', 'project', 'term']);
/** Why a form can't be used, or ''. */
function formProblem(v) {
  if (typeof v !== 'string') return 'isn\'t text';
  const t = v.trim();
  if ([...t].length < 2) return 'is under 2 characters';
  if (!/\p{L}/u.test(t)) return 'has no letter';
  if (/["\\\u0000-\u001f\u007f]/u.test(t)) return 'has a quotation mark, a backslash or a control character';
  if (LABEL_WORDS.has(keyOf(t)) || STANDIN_SHAPE.test(t)) return 'is a stand-in\'s own word';
  return '';
}
const quoted = (v) => (typeof v === 'string' ? `"${v.trim().slice(0, 60)}"` : 'an entry');
/**
 * The list as written → { entries: [{ group, name, forms, exactCase, key }], problems: [line] }. What can't be used
 * is left out and named in problems (for the start-up bubble only: problems name words, so they are never logged).
 */
export function cleanMask(raw, { maxEntries = 500 } = {}) {
  const entries = [], problems = [], taken = new Map();
  if (raw === undefined || raw === null) return { entries, problems };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { entries, problems: ['"mask" should be an object with the groups people, organisations, projects and other. Nothing is masked until it is fixed.'] };
  for (const g of Object.keys(raw)) if (!GROUPS.includes(g)) problems.push(`"mask" has a group I don't know, "${g.slice(0, 40)}"; its words are not masked. The groups are people, organisations, projects and other.`);
  let over = false;
  for (const group of GROUPS) {
    const list = raw[group];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) { problems.push(`mask.${group} should be a list; its words are not masked.`); continue; }
    for (const item of list) {
      const obj = item && typeof item === 'object' && !Array.isArray(item);
      const name = obj ? item.name : item;
      const why = formProblem(name);
      if (why) { problems.push(`mask.${group}: ${quoted(name)} ${why}, so it isn't used.`); continue; }
      if (obj && item.also !== undefined && !Array.isArray(item.also)) problems.push(`mask.${group}: "also" of "${name.trim()}" should be a list; it isn't used.`);
      if (obj && item.exactCase !== undefined && typeof item.exactCase !== 'boolean') problems.push(`mask.${group}: "exactCase" of "${name.trim()}" should be true or false; it is taken as false.`);
      const key = keyOf(name);
      if (taken.has(key)) { problems.push(`mask.${group}: "${name.trim()}" is already listed${taken.get(key) === group ? '' : ` under ${taken.get(key)}`}; the first is used.`); continue; }
      if (entries.length >= maxEntries) { over = true; continue; }
      taken.set(key, group);
      const forms = [name.trim()];
      for (const a of obj && Array.isArray(item.also) ? item.also : []) {
        const w = formProblem(a);
        if (w) { problems.push(`mask.${group}: ${quoted(a)} (also of "${name.trim()}") ${w}, so it isn't used.`); continue; }
        const k = keyOf(a);
        if (taken.has(k)) { problems.push(`mask.${group}: "${a.trim()}" (also of "${name.trim()}") is already listed; the first is used.`); continue; }
        taken.set(k, group); forms.push(a.trim());
      }
      entries.push({ group, name: name.trim(), forms, exactCase: obj && item.exactCase === true, key });
    }
  }
  if (over) problems.push(`"mask" has more than ${maxEntries} entries (limits.maskEntries); the first ${maxEntries} are used.`);
  return { entries, problems };
}

/** Numbers for the entries: kept ones stay, new words get the next free number of their group. table: state.json
 *  "masks" ({ people: { key: n }, … }); never loses a word. → { table, changed } */
export function assignNumbers(entries, table = {}) {
  const t = {};
  for (const g of GROUPS) t[g] = { ...(table && typeof table[g] === 'object' && !Array.isArray(table[g]) ? table[g] : {}) };
  let changed = false;
  for (const e of entries) {
    if (Number.isInteger(t[e.group][e.key]) && t[e.group][e.key] > 0) continue;
    t[e.group][e.key] = Math.max(0, ...Object.values(t[e.group]).filter(Number.isInteger)) + 1;
    changed = true;
  }
  return { table: t, changed };
}

/** Single-word forms (exactCase off) that are words in the system's word list (macOS: /usr/share/dict/words), so
 *  they are swapped in any case wherever they appear. [] when the file isn't there. */
export function everydayForms(entries, file = '/usr/share/dict/words') {
  const want = new Map();
  for (const e of entries) if (!e.exactCase) for (const f of e.forms) if (!/[\s-]/.test(f)) want.set(f.toLowerCase(), f);
  if (!want.size) return [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const found = new Set();
  for (const line of text.split('\n')) if (want.has(line) && line === line.toLowerCase()) found.add(want.get(line));
  return [...found];
}
/** The start-up line for everydayForms, or ''. */
export const everydayLine = (forms) => (forms.length ? `On your masking list, ${forms.slice(0, 8).map((f) => `"${f}"`).join(', ')}${forms.length > 8 ? ` and ${forms.length - 8} more` : ''} ${forms.length === 1 ? 'is also an everyday word, so it is' : 'are also everyday words, so they are'} swapped in any case wherever ${forms.length === 1 ? 'it appears' : 'they appear'}. To match one only as written, give it "exactCase": true.` : '');

// ---------- the masker ----------
const KEEP_KEYS = new Set(['type', 'id', 'toolCallId', 'toolUseId', 'tool_use_id', 'isError', 'signature', 'data', 'encrypted_content', 'mediaType']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SUFFIXES = ['es\'', 's\'', '\'s', 'es', 's', '\'', ''];
const caseOf = (s) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  if (letters.length && letters.every((c) => c === c.toLowerCase() && c !== c.toUpperCase())) return 'lower';
  if (letters.length >= 2 && letters.every((c) => c === c.toUpperCase() && c !== c.toLowerCase())) return 'upper';
  return 'title';
};
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const spell = (n) => NUMBER_WORDS[n] ?? `no. ${n}`;
const inCase = (s, c) => (c === 'lower' ? s.toLowerCase() : c === 'upper' ? s.toUpperCase() : s);
const prevChar = (s, i) => { let j = i; while (j > 0) { const c = s[j - 1]; if (!MARK.test(c)) return c; j--; } return ''; };

/**
 * The masker for a list: entries from cleanMask, numbers from assignNumbers. Inactive (nothing swapped) when the list
 * is empty or masking is off. A use object ({ swaps, swapsBack }) given to a call counts what it swapped.
 *   out(text, use) → text with stand-ins          back(text, use) → text with the words
 *   outDeep / backDeep: the same over every string in a value (tool arguments and results; images untouched)
 *   stream(use) → { push(chunk) → text, flush() → text }: back() for a reply that arrives in pieces
 *   count(text) → how many listed words a text holds          standIns(text) → how many stand-ins a masked text holds
 *   leftovers(text) → stand-in shapes that match no entry ("Person 7" with no seventh, "Person One")
 */
export function createMasker(entries = [], table = {}, { on = true } = {}) {
  const items = on ? entries.map((e) => ({ ...e, n: table?.[e.group]?.[e.key], label: LABELS[e.group] })).filter((e) => Number.isInteger(e.n)) : [];
  const active = items.length > 0;
  const sig = active ? sha(JSON.stringify(items.map((i) => [i.group, i.n, i.forms, i.exactCase]).sort((x, y) => (x[0] + x[1] < y[0] + y[1] ? -1 : 1)))) : ''; // the order it's written in is no change
  const byCanon = new Map(), byNum = new Map(), seen = new Map();
  for (const it of items) {
    byNum.set(`${it.group}|${it.n}`, it);
    for (const form of it.forms) { const c = canon(fold(form).f); if (!byCanon.has(c)) byCanon.set(c, { it, form }); }
  }
  const sorted = [...byCanon.keys()].sort((a, b) => b.length - a.length);
  const pats = sorted.map((c) => esc(c).replace(/ /g, '[ -]+'));
  const re = active ? new RegExp(pats.join('|'), 'gu') : null;
  const sticky = new Map();
  const stickyFor = (c) => { let r = sticky.get(c); if (!r) { r = new RegExp(esc(c).replace(/ /g, '[ -]+'), 'uy'); sticky.set(c, r); } return r; };

  /** A match at folded [a, b): its span in the text with the suffix, or null when its edges or case don't fit. */
  function fit(s, f, map, a, b, c) {
    const hit = byCanon.get(c);
    if (!hit) return null;
    const A = at(map, a), B = at(map, b);
    const slice = s.slice(A, B);
    if (hit.it.exactCase && !hit.it.forms.some((form) => norm(form) === norm(slice))) return null;
    const first = s[A], before = prevChar(s, A);
    if (before && WORD.test(before) && !(LOWER.test(before) && UPPER.test(first))) return null;
    for (const suf of SUFFIXES) {
      if (f.slice(b, b + suf.length) !== suf) continue;
      const E = at(map, b + suf.length), last = prevChar(s, E), next = s[E] ?? '';
      if (next && WORD.test(next) && !(LOWER.test(last) && UPPER.test(next))) continue;
      return { A, B, it: hit.it, fb: b };
    }
    return null;
  }
  const BACK = new RegExp(`(?:(?<![\\p{L}\\p{M}])|(?<=\\p{Ll})(?=\\p{Lu}))(${LABEL_CASED})( ?#? ?)(\\d+)(?:#(?=\\d)|(?!\\d))`, 'gu');
  // Text that already looks like a stand-in in use ("Term 2" in a note) is sent spelled out ("Term two"), so what comes
  // back as "Term 2" is always the listed word's.
  const plainShape = (seg) => seg.replace(BACK, (whole, label, _sep, num) => (byNum.has(`${groupOfLabel(label)}|${Number(num)}`) ? `${label} ${spell(Number(num))}` : whole));
  function out(text, use) {
    if (!active || typeof text !== 'string' || !text) return text;
    const { f, map } = fold(text);
    let res = '', from = 0, count = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(f))) {
      const a = m.index;
      let got = fit(text, f, map, a, a + m[0].length, canon(m[0]));
      if (!got) {
        // A shorter entry may still fit where the longer one didn't ("Max" where "Max Planck Institute" is exact).
        const whole = canon(m[0]);
        for (const c of sorted) {
          if (c.length >= whole.length || !whole.startsWith(c)) continue;
          const r = stickyFor(c); r.lastIndex = a; const mm = r.exec(f);
          if (mm && (got = fit(text, f, map, a, a + mm[0].length, c))) break;
        }
      }
      if (!got || got.A < from) { re.lastIndex = a + 1; continue; }
      const slice = text.slice(got.A, got.B), cls = caseOf(slice);
      // A digit straight after would run into the number: "#" keeps them apart, and goes again on the way back.
      const stand = inCase(`${got.it.label} ${got.it.n}`, cls) + (/\d/.test(text[got.B] ?? '') ? '#' : '');
      seen.set(`${cls}|${got.it.group}|${got.it.n}`, slice.replace(/\s*\n\s*/g, ' '));
      res += plainShape(text.slice(from, got.A)) + stand;
      from = got.B; count++;
      re.lastIndex = Math.max(a + 1, got.fb);
    }
    if (!count) return plainShape(text);
    if (use) use.swaps = (use.swaps ?? 0) + count;
    return res + plainShape(text.slice(from));
  }
  function back(text, use) {
    if (!active || typeof text !== 'string' || !text) return text;
    let count = 0;
    const res = text.replace(BACK, (whole, label, _sep, num) => {
      const g = groupOfLabel(label), it = byNum.get(`${g}|${Number(num)}`);
      if (!it) return whole;
      const cls = caseOf(label);
      count++;
      return seen.get(`${cls}|${g}|${it.n}`) ?? inCase(it.name, cls);
    });
    if (count && use) use.swapsBack = (use.swapsBack ?? 0) + count;
    return res;
  }
  const LEFT = new RegExp(`(?<![\\p{L}\\p{N}])(?:Person|Organi[sz]ation|Project|Term) ?#? ?(?:\\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)(?![\\p{L}\\p{N}])`, 'gu');
  const leftovers = (text) => (active && typeof text === 'string' ? (text.match(LEFT) ?? []).length : 0);
  const deep = (fn) => function walk(v, use) {
    if (typeof v === 'string') return fn(v, use);
    if (Array.isArray(v)) return v.map((x) => walk(x, use));
    if (v && typeof v === 'object') {
      if (v.type === 'image') return v;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEEP_KEYS.has(k) ? x : walk(x, use)]));
    }
    return v;
  };
  const outDeep = deep(out), backDeep = deep(back);
  const PREFIXES = ['person', 'organisation', 'organization', 'project', 'term'];
  /** Whether the end of a reply so far could still be, or grow into, a stand-in. */
  const partial = (s) => {
    const l = s.toLowerCase();
    return PREFIXES.some((p) => (l.length <= p.length ? p.startsWith(l) : l.startsWith(p) && /^ ?#? ?(?:\d+#?)?$/.test(l.slice(p.length))));
  };
  function stream(use) {
    let held = '';
    return {
      push(chunk) {
        if (!active) return chunk;
        const buf = held + chunk;
        held = '';
        for (let i = Math.max(0, buf.length - 20); i < buf.length; i++) {
          if (i > 0 && /[\p{L}\p{N}]/u.test(buf[i - 1])) continue;
          if (/[\p{L}]/u.test(buf[i]) && partial(buf.slice(i))) { held = buf.slice(i); return back(buf.slice(0, i), use); }
        }
        return back(buf, use);
      },
      flush() { const t = held; held = ''; return active ? back(t, use) : t; },
    };
  }
  const count = (text) => { const u = { swaps: 0 }; out(text, u); return u.swaps; };
  /** The stand-ins of this list in a text already masked. */
  const standIns = (text) => { let n = 0; if (active && typeof text === 'string') for (const m of text.matchAll(BACK)) if (byNum.has(`${groupOfLabel(m[1])}|${Number(m[3])}`)) n++; return n; };
  return { active, sig, size: items.length, out, back, outDeep, backDeep, stream, count, standIns, leftovers, note: active ? MASK_NOTE : '' };
}

/** How many words on the list a text holds (the Send bubble's count for pi, which isn't masked). */
export const listedCount = (text, entries) => (entries.length ? createMasker(entries, assignNumbers(entries, {}).table).count(String(text ?? '')) : 0);

// ---------- messages ----------
const textKey = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '');
/** A message as the provider gets it. dropThinking: the list changed since its reasoning was made (it is signed). */
export function maskMessage(m, mk, { use, dropThinking = false } = {}) {
  if (!mk.active) return m;
  if (typeof m.content === 'string') return { ...m, content: mk.out(m.content, use) };
  if (!Array.isArray(m.content)) return m;
  if (m.role === 'tool') return { ...m, content: m.content.map((r) => ({ ...r, content: mk.outDeep(r.content, use) })) };
  const parts = dropThinking && m.role === 'assistant' ? m.content.filter((p) => p.type !== 'thinking') : m.content;
  return { ...m, content: parts.map((p) => (p.type === 'text' ? { ...p, text: mk.out(p.text, use) } : p.type === 'image' || p.type === 'thinking' ? p : p.type === 'tool_call' ? { ...p, args: mk.outDeep(p.args) } : mk.outDeep(p))) };
}
/** A message from the agent as it is kept on the Mac: his own messages as he made them (plain: masked text → his
 *  content), everything else with the words back. Reasoning stays as it came (it is signed). */
export function unmaskMessage(m, mk, plain = new Map()) {
  if (!mk.active) return m;
  if (m.role === 'user' || m.role === 'system') {
    const had = plain.get(textKey(m.content));
    if (had !== undefined) return { ...m, content: had };
  }
  if (typeof m.content === 'string') return { ...m, content: mk.back(m.content) };
  if (!Array.isArray(m.content)) return m;
  if (m.role === 'tool') return { ...m, content: m.content.map((r) => ({ ...r, content: mk.backDeep(r.content) })) };
  return { ...m, content: m.content.map((p) => (p.type === 'text' ? { ...p, text: mk.back(p.text) } : p.type === 'image' || p.type === 'thinking' ? p : p.type === 'tool_call' ? { ...p, args: mk.backDeep(p.args) } : mk.backDeep(p))) };
}
export { textKey };

// ---------- web search asked for ----------
const SEARCH_VERB = /\b(?:search|look(?:\s+\w+)?\s+up|look\s+for|find|google|check|browse)\b/i;
const WEB_PLACE = /\b(?:on|in|across|from|through|via|using)\s+(?:the\s+)?(?:web|internet|google|bing|duckduckgo)\b(?!\s*(?:page|site|app|form|version|browser|server|design|developer|dev))|\bsearch\s+(?:the\s+)?(?:web|internet)\b|\bweb\s+search\b|\b(?:look(?:\s+\w+)?\s+up|search|find|check)\b[^.?!]*\bonline\b|^\s*(?:please\s+)?google\b/i;
/** Whether a request asks for a web search in so many words ("search the web for…", "look it up online", "google
 *  …"). Not "search my notes", "find the file", or "the web page in front". */
export const isWebAsk = (text) => { const t = String(text ?? ''); return WEB_PLACE.test(t) && (SEARCH_VERB.test(t) || /^\s*(?:please\s+)?google\b|\bweb\s+search\b/i.test(t)); };
