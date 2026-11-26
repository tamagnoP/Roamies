// Local-only build, feature 23 (stage 3): a request to the local model, made by the app. The lite request
// (lite.mjs) with the checks (checks.mjs), the real tools by their names, the yes/no bubble for a change the model
// chose, its own short history, and a ledger line per call (feature 32), "this Mac". When it is used is stage 4's.
//
// What is fixed here, in code:
//   - The address is local.address and nothing else (local.mjs); every call goes through the guarded fetch.
//   - Before the first request to a server, the warm-up doubles as the live check (localserver.mjs). A problem is a
//     notice, and the local model is not used until the server is started again.
//   - The model's own words never reach a tool unchecked: the runner turns a call into the real tools' arguments.
//   - Its history is its own last local exchanges (local.historyExchanges), never the provider's conversation.
import { chat as chatOnce, localAddress, probe } from './local.mjs';
import { createLiteRunner, liteRequest, liteState } from './lite.mjs';
import { liveCalls, liveCheck } from './localserver.mjs';
import { dayFrom } from './calendar.mjs';

export const NOT_ANSWERING = 'The local model isn\'t answering; nothing was sent.';
const plain = (t) => String(t ?? '').replace(/\s*\[[A-Za-z0-9_-]{2,}\]/g, '').trim();
const dayStartMs = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** The counts and today's blocks for the state line. todos: [{ id, title, due }]; blocks: { id: { start, minutes } }. */
export function liteFacts(todos, blocks, now = Date.now()) {
  const t0 = dayStartMs(now), t1 = t0 + 864e5, week = t0 + 7 * 864e5;
  const dated = todos.filter((t) => typeof t.due === 'number');
  const plan = Object.entries(blocks ?? {}).filter(([, b]) => b && b.start >= t0 && b.start < t1).map(([id, b]) => ({ todo: id, title: todos.find((t) => t.id === id)?.title ?? '', start: b.start, minutes: b.minutes })).filter((b) => b.title).sort((a, b) => a.start - b.start);
  return { open: todos.length, today: dated.filter((t) => t.due >= t0 && t.due < t1).length, week: dated.filter((t) => t.due >= t0 && t.due < week).length, overdue: dated.filter((t) => t.due < now).length, none: todos.length - dated.length, plan };
}

/**
 * settings() → loadSettings's (local, calendar, persona); userName; tool(name) → the app's tool ({ execute }) by its
 * real name; todos() → the open to-dos [{ id, title, due (ms or null) }]; blocks() → { id: { start, minutes } };
 * readDaily() → today's daily note as text; confirm({ question }) → true, false or null (the yes/no bubble);
 * record(line) → the ledger; log(kind, data); fetchImpl (tests).
 * → { request(said, { signal }) → { reply, by, calls, ... } or { problem } (a code-worded line), ready() → '' or the
 *   problem, reset() (the server was started again: check it again), history() }
 */
export function createLocalRoute({ settings, userName = 'the user', tool, todos = () => [], blocks = () => ({}), readDaily = async () => '', confirm = async () => null, record = () => {}, log = () => {}, now = () => Date.now(), fetchImpl } = {}) {
  let checked = null; // { address, problem, model }: the live check of the server at that address
  const history = [];
  async function ready() {
    const s = settings().local, address = localAddress(s.address);
    if (!address) return { problem: 'The local model is off: local.address is empty.' };
    if (checked?.address === address) return checked;
    const models = await probe(address, { fetchImpl });
    if (!models?.length) return { problem: NOT_ANSWERING, retry: true };
    const model = s.model && models.includes(s.model) ? s.model : s.model ? null : models[0];
    if (!model) return { problem: `The local model server doesn't have the model "${s.model}" (local.model).` };
    const t0 = now();
    let r;
    try { r = await liveCheck({ ...liveCalls(address, fetchImpl), model, name: userName }); } catch (e) { return { problem: NOT_ANSWERING, retry: true, why: String(e?.message ?? e).slice(0, 120) }; }
    record({ kind: 'warmup', where: 'mac', provider: 'local', model });
    log('local_checked', { ms: now() - t0, problem: !!r.problem, cached: r.cached ?? null });
    checked = { address, model, problem: r.problem };
    return checked;
  }
  async function request(said, { signal } = {}) {
    const r = await ready();
    if (r.problem) { if (r.retry) checked = null; return { problem: r.problem }; }
    const s = settings(), local = s.local, address = localAddress(local.address);
    const open = (() => { try { return todos(); } catch { return []; } })(), b = (() => { try { return blocks(); } catch { return {}; } })();
    const items = open.map((t) => ({ id: t.id, title: t.title }));
    const planOf = async (day) => { const d = dayFrom(day, now()); if (!d) return []; const t0 = d.getTime(); return Object.entries(b).filter(([, x]) => x.start >= t0 && x.start < t0 + 864e5).map(([id, x]) => ({ todo: id, title: open.find((t) => t.id === id)?.title ?? '', start: x.start, minutes: x.minutes })); };
    const dueOf = async (id) => { const t = open.find((x) => x.id === id); return typeof t?.due === 'number' ? { ms: t.due, dayOnly: false } : null; };
    const call = (name) => { const t = tool(name); return t ? { execute: (a, ctx) => t.execute(a, { ...ctx, signal }) } : null; };
    const blockLine = (name) => async (a) => { const text = String(await tool(name).execute(a, { signal }) ?? ''); return { text, say: plain(text) }; };
    const run = createLiteRunner({ tool: call, blocks: { schedule_block: blockLine('schedule_block'), move_block: blockLine('move_block') }, todos: async () => items, readDaily, now, said: () => said, planOf, dueOf });
    const hours = { dayStart: s.calendar.dayStart, dayEnd: s.calendar.dayEnd };
    const t0 = now();
    let out;
    try {
      out = await liteRequest({
        chat: async (body) => { const res = await chatOnce({ address, body, signal, fetchImpl }); record({ kind: 'request', where: 'mac', provider: 'local', model: r.model, tokens: { new: (res.usage?.prompt_tokens ?? 0) - (res.usage?.prompt_tokens_details?.cached_tokens ?? 0), cacheRead: res.usage?.prompt_tokens_details?.cached_tokens ?? 0, out: res.usage?.completion_tokens ?? 0 } }); return res; },
        run, name: userName, model: r.model, said, state: liteState({ name: userName, now: now(), facts: liteFacts(open, b, now()) }),
        history: history.slice(-local.historyExchanges), maxSteps: local.maxSteps, now: now(), hours, items,
        confirm: async (p) => confirm(p), confirmChanges: local.confirmChanges,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      checked = null;
      log('local_failed', { why: String(e?.message ?? e).slice(0, 160) });
      return { problem: NOT_ANSWERING };
    }
    log('local_request', { ms: now() - t0, by: out.by, calls: out.calls.map((c) => c.name), steps: out.usage.length, firstMs: out.firstMs, retries: out.noStreamRetries });
    if (out.reply) history.push({ said, reply: out.reply });
    while (history.length > 20) history.shift();
    return out;
  }
  return { request, ready: async () => (await ready()).problem ?? '', reset: () => { checked = null; }, history: () => [...history] };
}
