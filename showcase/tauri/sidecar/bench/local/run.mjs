// Feature 23: a tool-call set through the real lite request and code check, against the local server.
// SET=C node bench/local/run.mjs [port]   (REPEAT=2 runs the set twice; WARM=0 skips the warm-up and live check)
// The tools are stand-ins that take what code worked out of his words and report success; nothing is saved.
// Each task ends as one of: right (done right, or read right), asked (a code-worded question, nothing changed),
// wrong save (a tool that changes something ran, and the task is not right), miss (anything else).
import { chat } from '../../local.mjs';
import { WRITE_TOOLS } from '../../checks.mjs';
import { createLiteRunner, liteRequest, liteState } from '../../lite.mjs';
import { liveCalls, liveCheck } from '../../localserver.mjs';
import { NEEDS_CALL, SETS } from './sets.mjs';

const port = Number(process.argv[2] || 8099);
const address = `http://127.0.0.1:${port}/v1`;
const name = 'Office';
const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // Wednesday 25 November 2026, 14:05, as in stage 0
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const facts = { open: 14, today: 3, week: 6, overdue: 1, none: 4, plan: [{ title: 'Budget review', todo: 'k3f9', start: at(25, 10), minutes: 60 }, { title: 'Grant report draft', todo: 'p2x7', start: at(25, 15), minutes: 60 }] };
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
  const count = { right: 0, asked: 0, wrongSave: 0, miss: 0 };
  let refusals = 0, retries = 0, replaced = 0;
  for (const [said, check] of tasks) {
    seen.length = 0;
    const run = createLiteRunner({ tool, readDaily: async () => '## Plan\n- [ ] Budget review', now: () => NOW, said: () => said, titleOf: (id) => facts.plan.find((b) => b.todo === id)?.title ?? '', planOf: async (d) => (d === 'today' ? facts.plan : []), dueOf: async (id) => DUE[id] ?? null });
    const t0 = performance.now();
    const out = await liteRequest({ chat: (body) => chat({ address, body }), run, name, model, said, state: liteState({ name, now: NOW, facts }), now: NOW });
    const ms = performance.now() - t0;
    const first = out.calls.find((c) => !c.refused);
    const call = first ? { name: first.name, a: first.args } : undefined;
    const good = NEEDS_CALL[set] ? !!call && !!check(call, out) : !!check(call, out);
    const writes = seen.filter((s) => WRITE_TOOLS.has(s.n));
    const outcome = writes.length ? (good ? 'right' : 'wrongSave') : ['ask', 'refused'].includes(out.by) ? 'asked' : good ? 'right' : 'miss';
    count[outcome]++;
    refusals += out.refusals; retries += out.noStreamRetries; replaced += out.by === 'replaced' ? 1 : 0;
    const u = out.usage.filter(Boolean);
    const row = { set, said, outcome, by: out.by, firstMs: Math.round(out.firstMs ?? 0), ms: Math.round(ms), calls: out.calls.map((c) => ({ n: c.name, a: c.args, ...(c.refused ? { refused: [...(c.unsaid ?? []), ...(c.missing ?? [])].join(',') || true } : {}) })), ran: seen.map((s) => ({ n: s.n, a: s.a })), reply: out.reply.slice(0, 200), prompt: u[0]?.prompt_tokens, cached: u[0]?.prompt_tokens_details?.cached_tokens, outs: u.map((x) => x.completion_tokens), steps: out.usage.length };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  console.log(`SET ${set}${rep ? ` run ${rep + 1}` : ''}: right ${count.right}, asked ${count.asked}, wrong saves ${count.wrongSave}, misses ${count.miss} (of ${tasks.length})  refusals ${refusals}  no-stream retries ${retries}  replies replaced ${replaced}`);
}
