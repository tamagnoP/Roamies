// Feature 23: a tool-call set through the real lite request and code check, against the local server.
// SET=C node bench/local/run.mjs [port]   (REPEAT=2 runs the set twice; the second run shows the reused opening)
// The tools are stand-ins that take what code worked out of his words and report success; nothing is saved.
import { chat } from '../../local.mjs';
import { createLiteRunner, liteRequest, liteState, warmBody } from '../../lite.mjs';
import { NEEDS_CALL, SETS } from './sets.mjs';

const port = Number(process.argv[2] || 8099);
const address = `http://127.0.0.1:${port}/v1`;
const name = 'Office';
const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // Wednesday 25 November 2026, 14:05, as in stage 0
const facts = { open: 14, today: 3, week: 6, overdue: 1, none: 4, plan: [{ title: 'Budget review', todo: 'k3f9', start: new Date(2026, 10, 25, 10, 0).getTime(), minutes: 60 }, { title: 'Grant report draft', todo: 'p2x7', start: new Date(2026, 10, 25, 15, 0).getTime(), minutes: 60 }] };
const RESULTS = {
  remember_commitment: (a) => `Saved as c1${a.due ? `, due ${a.due}` : ''}.`,
  update_commitment: (a) => `${a.id} is now ${a.status ?? 'open'}${a.due ? `, due ${a.due}` : ''}.`,
  list_commitments: () => '1 open to-do with "thesis" in the title:\n- t5: Thesis chapter 2',
  schedule_block: (a) => `"${a.title ?? a.todo}" is on the calendar ${a.date}, ${a.start}${a.end ? ` to ${a.end}` : ''}.`,
  move_block: (a) => `"Budget review" is moved to ${a.date ?? 'today'}, ${a.start ?? ''}.`,
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
if (process.env.WARM !== '0') { const t0 = performance.now(); await chat({ address, body: warmBody(model, name), stream: false }); console.log(JSON.stringify({ warmMs: Math.round(performance.now() - t0) })); }
let right = 0, refusals = 0, retries = 0, replaced = 0;
const rows = [];
for (let rep = 0; rep < Number(process.env.REPEAT || 1); rep++) {
  right = 0;
  for (const [said, check] of tasks) {
    seen.length = 0;
    const run = createLiteRunner({ tool, readDaily: async () => '## Plan\n- [ ] Budget review', now: () => NOW, said: () => said });
    const t0 = performance.now();
    const out = await liteRequest({ chat: (body) => chat({ address, body }), run, name, model, said, state: liteState({ name, now: NOW, facts }) });
    const ms = performance.now() - t0;
    const first = out.calls.find((c) => !c.refused);
    const call = first ? { name: first.name, a: first.args } : undefined;
    const good = NEEDS_CALL[set] ? !!call && !!check(call, out) : !!check(call, out);
    right += good; refusals += out.refusals; retries += out.noStreamRetries; replaced += out.by === 'replaced' ? 1 : 0;
    const u = out.usage.filter(Boolean);
    const outTok = u.reduce((n, x) => n + (x.completion_tokens ?? 0), 0);
    const row = { set, said, good, by: out.by, firstMs: Math.round(out.firstMs ?? 0), ms: Math.round(ms), calls: out.calls.map((c) => ({ n: c.name, a: c.args, ...(c.refused ? { refused: c.unsaid ?? true } : {}) })), ran: seen.map((s) => ({ n: s.n, a: s.a })), reply: out.reply.slice(0, 160), prompt: u[0]?.prompt_tokens, cached: u[0]?.prompt_tokens_details?.cached_tokens, out: outTok, outs: u.map((x) => x.completion_tokens), steps: out.usage.length };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  console.log(`RIGHT ${right} of ${tasks.length} (set ${set}${rep ? `, run ${rep + 1}` : ''})  refusals ${refusals}  no-stream retries ${retries}  replies replaced ${replaced}`);
}
