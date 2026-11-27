// Feature 40: a stand-in for the hands helper in findany-run.test.mjs. find answers from the items in FIND_ITEMS
// (each kept when its name holds every word asked for, as Spotlight's LIKE would); reveal says whether the file is
// there. Each find and reveal is noted in FIND_RECORD with its arguments and what came on stdin. Every other command
// gets a bare { ok: true }.
import fs from 'node:fs';
import path from 'node:path';

const [cmd] = process.argv.slice(2);
const say = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); process.exit(0); };
if (cmd !== 'find' && cmd !== 'reveal') say({ ok: true });
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FIND_RECORD, `${JSON.stringify({ args: process.argv.slice(2), input })}\n`);
const ask = JSON.parse(input);
if (cmd === 'reveal') say(fs.existsSync(ask.path) ? { ok: true, shown: true } : { ok: true, gone: true });
const all = JSON.parse(fs.readFileSync(process.env.FIND_ITEMS, 'utf8'));
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
say({ ok: true, items: all.items.filter((it) => ask.words.every((w) => fold(path.basename(it.path)).includes(fold(w)))), drives: ask.drives ? all.drives : [], timedOut: false });
