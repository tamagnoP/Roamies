// Local-only build (feature 24): the live state, sent only when it changes.
//
// The live state is what the model must know as of now: the app in front, where pi works, the settings that
// matter, the memory section. It is made of named parts. The first request of a conversation, and the first after
// a fold, carries every part. After that a request carries only the parts that differ from what the conversation
// already holds, and no block at all when none does. A part that no longer exists is sent once as removed.
//
// Why: a block put on a message stays on it (changing an old message would stop the provider reusing everything
// after it), so a full copy on every request made the copies most of what was sent.
//
// The rule that makes it safe: what the model can piece together from the blocks in the conversation (the newest
// of each part, less the removed ones) always equals the real state when the newest request was made
// (test/live.test.mjs).
export const LIVE_OPEN = '<live-state>', LIVE_CLOSE = '</live-state>';
export const GONE = 'no longer applies.';
const FULL_HEAD = 'Live state (current as of this moment; every part):';
const PART_HEAD = 'Live state (only the parts that changed; every part not repeated here still holds as last given):';
const NAME = /^[a-z][a-z-]{0,23}$/;

/** A message's text without the live block at its start. */
export const stripLive = (text) => (typeof text === 'string' && text.startsWith(LIVE_OPEN) && text.includes(LIVE_CLOSE)
  ? text.slice(text.indexOf(LIVE_CLOSE) + LIVE_CLOSE.length).replace(/^\n+/, '') : text);

/** A part's text as it is sent: no empty lines at its ends, and no line that could be read as another part's name. */
const clean = (text) => String(text ?? '').trim().split('\n').map((l) => (/^\[[a-z][a-z-]{0,23}\] /.test(l) ? ` ${l}` : l)).join('\n');

/** [[name, text], …] → Map(name → text), in order, without the empty ones. Throws on a name that isn't one. */
export function partsOf(list) {
  const out = new Map();
  for (const [name, text] of list) {
    if (!NAME.test(name)) throw new Error(`not a name for a part of the live state: ${name}`);
    const t = clean(text);
    if (t) out.set(name, t);
  }
  return out;
}

/** What to send so that `held` becomes `now`: Map(name → text, or null for a part that is gone). A part named in
 *  `again` is sent even when it is the same: one that speaks about the message it is on. */
export function changes(held, now, again = []) {
  const out = new Map();
  for (const [name, text] of now) if (held.get(name) !== text || again.includes(name)) out.set(name, text);
  for (const name of held.keys()) if (!now.has(name)) out.set(name, null);
  return out;
}

/** `held` after a block's changes. */
export function applied(held, delta) {
  const out = new Map(held);
  for (const [name, text] of delta) { if (text === null) out.delete(name); else out.set(name, text); }
  return out;
}

/** The block for a message, or '' when nothing changed. */
export function blockOf(delta, full) {
  if (!delta.size) return '';
  const lines = [...delta].map(([name, text]) => `[${name}] ${text === null ? GONE : text}`);
  return `${LIVE_OPEN}\n${full ? FULL_HEAD : PART_HEAD}\n${lines.join('\n')}\n${LIVE_CLOSE}\n\n`;
}

/** A block read back the way the model reads it: Map(name → text or null). For the tests. */
export function readBlock(text) {
  const out = new Map();
  if (typeof text !== 'string' || !text.startsWith(LIVE_OPEN)) return out;
  const body = text.slice(LIVE_OPEN.length, text.indexOf(LIVE_CLOSE)).split('\n').slice(2);
  let name = null;
  for (const line of body) {
    const m = /^\[([a-z][a-z-]{0,23})\] (.*)$/.exec(line);
    if (m) { name = m[1]; out.set(name, m[2] === GONE ? null : m[2]); } else if (name && out.get(name) !== null && (line || body.indexOf(line) < body.length - 1)) out.set(name, `${out.get(name)}\n${line}`);
  }
  for (const [k, v] of out) if (typeof v === 'string') out.set(k, v.replace(/\n+$/, ''));
  return out;
}

/** The state a reader pieces together from the messages of a conversation, oldest first. For the tests. */
export function pieced(messages) {
  let held = new Map();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : (m.content ?? []).find((p) => p.type === 'text')?.text ?? '';
    held = applied(held, readBlock(text));
  }
  return held;
}

const textOf = (c) => (typeof c === 'string' ? c : (c ?? []).map((p) => p.text ?? '').join(' '));
const cleanOf = (m) => (typeof m.content === 'string' ? stripLive(m.content)
  : m.content.map((p, j) => (j === 0 && p.type === 'text' ? { ...p, text: stripLive(p.text) } : p)));
const keyOf = (c) => textOf(c).slice(0, 300);
const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/**
 * The blocks of one conversation. now(text of the newest request) → [[name, text, { again }?], …], the real state.
 * attach(messages) puts each request's block on it: the newest gets one made now, older ones keep theirs.
 * Each request's block is made once and kept on that message from then on, keyed by the request's own
 * (timestamped) text, so earlier messages never change and the provider keeps reusing them.
 */
export function createLiveBlocks({ now, log = () => {} }) {
  const blocks = new Map(); // key → { block, delta, state }
  return {
    clear() { blocks.clear(); },
    get size() { return blocks.size; },
    /** Characters of live state sent with a message, for counting what a request really holds. */
    charsFor(m) { return m?.role === 'user' ? blocks.get(keyOf(cleanOf(m)))?.block.length ?? 0 : 0; },
    attach(msgs) {
      let last = -1;
      for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { last = i; break; }
      if (last < 0) return msgs;
      // What the conversation holds before the newest request: the blocks still on its (fitted) messages.
      let held = new Map(), earlier = 0;
      for (let i = 0; i < last; i++) if (msgs[i].role === 'user') { const b = blocks.get(keyOf(cleanOf(msgs[i]))); if (b) { held = applied(held, b.delta); earlier++; } }
      return msgs.map((m, i) => {
        if (m.role !== 'user') return m;
        const cleaned = cleanOf(m), key = keyOf(cleaned);
        if (i !== last && !blocks.has(key)) return cleaned === m.content ? m : { ...m, content: cleaned };
        if (i === last) {
          const had = blocks.get(key);
          // Made once. Made again only if it no longer leads to the state it was made for: an older message it
          // built on has been trimmed away since.
          if (!had || !same(applied(held, had.delta), had.state)) {
            const list = now(textOf(cleaned)), state = partsOf(list), full = !earlier;
            const delta = changes(held, state, list.filter((p) => p[2]?.again).map((p) => p[0]));
            const block = blockOf(delta, full);
            blocks.set(key, { block, delta, state });
            log({ full, parts: [...delta.keys()], chars: block.length });
          }
        }
        const block = blocks.get(key).block;
        if (!block) return cleaned === m.content ? m : { ...m, content: cleaned };
        if (typeof cleaned === 'string') return { ...m, content: block + cleaned };
        const [first, ...rest] = cleaned;
        return { ...m, content: first?.type === 'text' ? [{ ...first, text: block + first.text }, ...rest] : [{ type: 'text', text: block.trimEnd() }, ...cleaned] };
      });
    },
  };
}
