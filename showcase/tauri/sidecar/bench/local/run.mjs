// Feature 23: a tool-call set through the real lite request and the checks, against the local server.
// SET=C node bench/local/run.mjs [port]   (REPEAT=2 runs the set twice; WARM=0 skips the warm-up and live check)
// The tools are stand-ins that take what code worked out of his words and report success; nothing is saved. A task
// is judged on the first call that reached them, or on the change shown for a yes (sets.mjs). The stand-in for him
// answers no question: a change the model chose is shown and, with no answer, not saved.
// Each task ends as one of: saved by code, right or wrong (a tool that changes something ran: code decided the
// action); shown for a yes, right or wrong (what would have been saved); asked rightly (the question sets.mjs's ASK
// expects); asked although complete (any other code-worded question, nothing changed); read or answered right (no
// change: the read, or no call, was right); miss (anything else).
import { chat } from '../../local.mjs';
import { WRITE_TOOLS } from '../../checks.mjs';
import { createLiteRunner, liteRequest, liteState } from '../../lite.mjs';
import { liveCalls, liveCheck } from '../../localserver.mjs';
import { ASK, SETS } from './sets.mjs';

const port = Number(process.argv[2] || 8099);
const address = `http://127.0.0.1:${port}/v1`;
const name = 'Office';
const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // Wednesday 25 November 2026, 14:05, as in stage 0
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const facts = { open: 14, today: 3, week: 6, overdue: 1, none: 4, plan: [{ title: 'Budget review', todo: 'k3f9', start: at(25, 10), minutes: 60 }, { title: 'Grant report draft', todo: 'p2x7', start: at(25, 15), minutes: 60 }] };
const TODOS = [{ id: 'k3f9', title: 'Budget review' }, { id: 'p2x7', title: 'Grant report draft' }, { id: 't5', title: 'Thesis chapter 2' }];
const DUE = { k3f9: { ms: at(25, 0), dayOnly: true }, p2x7: { ms: at(27, 0), dayOnly: true } };
const RESULTS = {
  remember_commitment: (a) => `Saved as c1${a.due ? `, due ${a.due}` : ''}.`,
  update_commitment: (a) => `${a.id} is now ${a.status ?? 'open'}${a.due ? `, due ${a.due}` : ''}.`,
  list_commitments: () => '1 open to-do with "thesis" in the title:\n- t5: Thesis chapter 2',
  schedule_block: (a) => `"${a.title ?? a.todo}" is on the calendar ${a.date}, ${a.start}${a.end ? ` to ${a.end}` : ''}.`,
  move_block: (a) => `"${facts.plan.find((b) => b.todo === a.todo)?.title ?? a.todo}" is moved to ${a.date ?? 'today'}, ${a.start ?? ''}.`,
  unschedule_block: () => '"Grant report draft" is off the calendar. It is still on the to-do list.',
  show_day: (a) => `${a.date}:\n09:00 to 10:00 (60 min): Lab meeting [m1]`,
  write_note: (a) => `Saved the note "${a.title}".`,
  search_notes: () => 'Found 1 note: "Confocal booking".',
  read_note: () => 'Lab meeting: bring the slides.',
  open: (a) => `Opened ${a.target}.`,
};
const seen = [];
const tool = (n) => (RESULTS[n] ? { execute: async (a) => { seen.push({ n, a }); return RESULTS[n](a); } } : null);

const set = process.env.SET || 'A';
const tasks = SETS[set];
const model = (await (await fetch(`${address}/models`)).json()).data[0].id;
if (process.env.WARM !== '0') console.log(JSON.stringify({ liveCheck: await liveCheck({ ...liveCalls(address), model, name }) }));
const rows = [];
for (let rep = 0; rep < Number(process.env.REPEAT || 1); rep++) {
  const count = { savedRight: 0, savedWrong: 0, shownRight: 0, shownWrong: 0, askedRight: 0, asked: 0, right: 0, miss: 0 };
  let retries = 0, replaced = 0;
  for (const [k, [said, check]] of tasks.entries()) {
    seen.length = 0;
    const run = createLiteRunner({ tool, todos: async () => TODOS, readDaily: async () => { seen.push({ n: 'read_daily', a: {} }); return '## Plan\n- [ ] Budget review'; }, now: () => NOW, said: () => said, planOf: async (d) => (d === 'today' ? facts.plan : []), dueOf: async (id) => DUE[id] ?? null });
    const t0 = performance.now();
    const out = await liteRequest({ chat: (body) => chat({ address, body }), run, name, model, said, state: liteState({ name, now: NOW, facts }), now: NOW, items: TODOS, confirm: async () => null, confirmChanges: true });
    const ms = performance.now() - t0;
    const writes = seen.filter((s) => WRITE_TOOLS.has(s.n));
    const good = out.shown && !writes.length ? !!check({ n: out.shown.tool, a: out.shown.args }, out) : !!check(seen[0], out);
    const outcome = writes.length ? (good ? 'savedRight' : 'savedWrong') : out.shown ? (good ? 'shownRight' : 'shownWrong') : ['ask', 'one'].includes(out.by) ? (ASK[set]?.[k]?.test(out.reply) ? 'askedRight' : 'asked') : good ? 'right' : 'miss';
    count[outcome]++;
    retries += out.noStreamRetries; replaced += out.by === 'replaced' ? 1 : 0;
    const u = out.usage.filter(Boolean);
    const row = { set, said, outcome, by: out.by, firstMs: Math.round(out.firstMs ?? 0), ms: Math.round(ms), calls: out.calls.map((c) => ({ n: c.name, a: c.args, by: c.by, ...(c.model ? { model: c.model } : {}), ...(c.asked ? { asked: true } : {}), ...(c.notRun ? { notRun: true } : {}) })), shown: out.shown?.question, ran: seen.map((s) => ({ n: s.n, a: s.a })), reply: out.reply.slice(0, 200), prompt: u[0]?.prompt_tokens, cached: u[0]?.prompt_tokens_details?.cached_tokens, outs: u.map((x) => x.completion_tokens), steps: out.usage.length };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  console.log(`SET ${set}${rep ? ` run ${rep + 1}` : ''}: saved by code right ${count.savedRight} wrong ${count.savedWrong}, shown for a yes right ${count.shownRight} wrong ${count.shownWrong}, asked rightly ${count.askedRight}, asked although complete ${count.asked}, read or answered right ${count.right}, misses ${count.miss} (of ${tasks.length})  no-stream retries ${retries}  replies replaced ${replaced}`);
}
