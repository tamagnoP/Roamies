// Local-only build, feature 32: the ledger. One line per request to any model, in ledger.jsonl beside usage.jsonl:
// when, what kind (a request, a briefing, pi's summary, a fold, the memory update, the handover's part two, a
// warm-up, a hand-off to pi, the requests the claude program reports it made by itself), where it went (the provider and which one, or this Mac), the model, its tokens (new,
// read from the cache, written to the cache, answered), how many screen captures it carried (a marked area,
// take_screenshot, see_photo) and how many window texts (read_window), and whether it was private. Never any of its
// content. "What left the Mac today?" is answered from it by code (leftLine) and never sent to a model.
import fs from 'node:fs';
import { only, plainNum, unfilled } from './answers.mjs';

export const KINDS = ['request', 'briefing', 'piSummary', 'fold', 'memory', 'handover', 'warmup', 'pi', 'own'];
// What Roamies can't see, said with every answer (LOCAL-ONLY.md says the same).
export const UNSEEN = 'Not counted, because Roamies can\'t see them: what the claude program sends to Anthropic by itself without reporting it (it connects when it starts, and makes small checks such as counting tokens), and pi\'s own requests.';
export const CAPTURE_TOOLS = new Set(['take_screenshot', 'see_photo']);
export const WINDOW_TOOLS = new Set(['read_window']);
export const LEFT_PHRASES = ['what left the mac today', 'what has left the mac today', 'what left this mac today', 'what has left this mac today', 'what left the mac', 'what has left the mac', 'what left my mac today', 'what did you send today', 'what was sent today', 'what went out today', 'what went to the provider today', 'what left today'];
const LEFT = only(LEFT_PHRASES, plainNum);
/** "What left the Mac today?", said alone: the app's to answer, from the ledger. */
export const isLeftAsk = (text) => LEFT.test(unfilled(text, plainNum));

const n = (x) => (Number.isFinite(+x) && +x > 0 ? Math.round(+x) : 0);
/** One ledger line from what a caller knows: only numbers, names and the kind; anything else is dropped. */
export function ledgerLine({ t = Date.now(), kind, where = 'provider', provider = '', model = '', tokens = {}, marked = 0, screenshots = 0, photos = 0, windowTexts = 0, private: priv = false }) {
  if (!KINDS.includes(kind)) throw new Error(`no ledger kind ${kind}`);
  const tok = { new: n(tokens.new), cacheRead: n(tokens.cacheRead), cacheWrite: n(tokens.cacheWrite), out: n(tokens.out) };
  return { t, kind, where: where === 'mac' ? 'mac' : 'provider', provider: String(provider).slice(0, 40), model: String(model).slice(0, 80), tokens: tok, captures: { marked: n(marked), screenshots: n(screenshots), photos: n(photos) }, windowTexts: n(windowTexts), private: !!priv };
}
/** The captures and window texts in a request's tool calls (names only). → { screenshots, photos, windowTexts } */
export function countTools(names = []) {
  return { screenshots: names.filter((x) => x === 'take_screenshot').length, photos: names.filter((x) => x === 'see_photo').length, windowTexts: names.filter((x) => WINDOW_TOOLS.has(x)).length };
}

const fmt = (x) => x.toLocaleString('en-GB');
const plural = (k, one, many = `${one}s`) => `${fmt(k)} ${k === 1 ? one : many}`;
const KIND_WORDS = { request: ['request', 'requests'], briefing: ['briefing', 'briefings'], piSummary: ['summary of pi\'s reply', 'summaries of pi\'s replies'], fold: ['fold of the conversation', 'folds of the conversation'], memory: ['memory update', 'memory updates'], handover: ['handover part two', 'handover parts two'], warmup: ['warm-up', 'warm-ups'] };
const dayOf = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** The answer to "What left the Mac today?", worded by code from today's lines. */
export function leftLine(lines, now = Date.now()) {
  const today = lines.filter((l) => dayOf(l.t) === dayOf(now));
  const out = today.filter((l) => l.where === 'provider' && l.kind !== 'pi'), mac = today.filter((l) => l.where === 'mac' && l.kind !== 'pi'), pi = today.filter((l) => l.kind === 'pi');
  const parts = [];
  if (out.length) {
    const kinds = KINDS.filter((k) => k !== 'own' && out.some((l) => l.kind === k)).map((k) => { const c = out.filter((l) => l.kind === k).length; return `${fmt(c)} ${KIND_WORDS[k][c === 1 ? 0 : 1]}`; });
    const sum = (f) => out.reduce((a, l) => a + f(l), 0);
    const sent = sum((l) => l.tokens.new + l.tokens.cacheRead + l.tokens.cacheWrite), cached = sum((l) => l.tokens.cacheRead), answered = sum((l) => l.tokens.out);
    const where = [...new Set(out.map((l) => l.provider || 'the provider'))].join(' and ');
    const caps = [['marked', 'marked area'], ['screenshots', 'screenshot'], ['photos', 'photo']].map(([k, w]) => [sum((l) => l.captures[k]), w]).filter(([c]) => c).map(([c, w]) => plural(c, w));
    const wins = sum((l) => l.windowTexts), priv = out.filter((l) => l.private).length;
    const ownSent = out.filter((l) => l.kind === 'own').reduce((a, l) => a + l.tokens.new + l.tokens.cacheRead + l.tokens.cacheWrite, 0);
    parts.push(`Sent to ${where} today: ${kinds.length ? `${kinds.join(', ')}; ` : ''}${fmt(sent)} tokens sent (${fmt(cached)} of them read from its cache) and ${fmt(answered)} answered.`);
    if (ownSent) parts.push(`Of these, ${fmt(ownSent)} tokens were requests the claude program reported making by itself.`);
    parts.push(caps.length ? `Screen captures: ${caps.join(', ')}.` : 'No screen captures.');
    parts.push(wins ? `Window texts: ${fmt(wins)}.` : 'No window texts.');
    if (priv) parts.push(`${plural(priv, 'private request')} went to the provider.`);
  } else parts.push('Nothing went to the provider today.');
  if (mac.length) parts.push(`${plural(mac.length, 'request')} stayed on this Mac, with the local model.`);
  if (pi.length) parts.push(`${plural(pi.length, 'hand-off')} to pi.`);
  parts.push(UNSEEN);
  return parts.join(' ');
}

/** The ledger file. file: its path; keepDays(): how many days of lines are kept (limits.ledgerDays). */
export function createLedger({ file, keepDays = () => 90, now = () => Date.now(), log = () => {} }) {
  let checked = 0;
  return {
    record(o) {
      let line;
      try { line = ledgerLine({ t: now(), ...o }); } catch (e) { log('ledger_failed', { why: String(e.message).slice(0, 120) }); return null; }
      try { fs.appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 }); } catch (e) { log('ledger_failed', { why: String(e.code ?? e.message).slice(0, 120) }); }
      if (now() - checked > 6 * 3600_000) { checked = now(); this.prune(); }
      return line;
    },
    lines() {
      try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
    },
    left() { return leftLine(this.lines(), now()); },
    /** Lines older than keepDays go, rewritten atomically. */
    prune() {
      try {
        const cutoff = now() - keepDays() * 864e5, all = this.lines(), keep = all.filter((l) => l.t >= cutoff);
        if (keep.length === all.length) return 0;
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, keep.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 });
        fs.renameSync(tmp, file);
        return all.length - keep.length;
      } catch { return 0; }
    },
  };
}
