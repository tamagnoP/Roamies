// Local-only build, feature 23 stage 1: the lean tools (lean.mjs). Every model gets the same fields, required fields
// and choices without the limits, and our own tools their descriptions in shorter words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveToolSchema } from '@kenkaiiii/gg-ai';
import { createTools } from '../tools.mjs';
import { SHORT, leanSchema, leanTools, stripNulls } from '../lean.mjs';
import { z } from 'zod';

const noop = async () => {};
const make = () => createTools({ allowActions: false, ui: () => {}, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' }).tools;
const full = make(), lean = leanTools(make(), { describe: SHORT('Test') });

// The same tools, fields, required fields and choices; no length limits.
const shape = (s) => JSON.stringify(s, (k, v) => (['minLength', 'maxLength', 'description', '$schema', 'additionalProperties', 'minimum', 'maximum', 'minItems', 'maxItems'].includes(k) ? undefined : v));
assert.deepEqual(lean.map((t) => t.name), full.map((t) => t.name));
let before = 0, after = 0;
for (const [i, t] of lean.entries()) {
  const a = resolveToolSchema(full[i]), b = resolveToolSchema(t);
  assert.equal(shape(b), shape(a), `${t.name}: fields, required and choices unchanged`);
  assert.ok(!/"(minLength|maxLength)"/.test(JSON.stringify(b)), `${t.name}: no length limits`);
  before += JSON.stringify({ name: t.name, description: full[i].description, input_schema: a }).length;
  after += JSON.stringify({ name: t.name, description: t.description, input_schema: b }).length;
}
console.log(`lean: tools.mjs's ${lean.length} tools ${before} → ${after} characters (about ${Math.round(before / 3.6)} → ${Math.round(after / 3.6)} tokens)`);
assert.ok(after < before);
// The limits are still checked, and a null a model sends for a field it leaves out is dropped first.
const remember = lean.find((t) => t.name === 'remember_commitment');
assert.equal(remember.parameters.safeParse({ text: 'x' }).success, false, 'a text under 2 characters is still refused');
assert.equal(remember.parameters.safeParse({ text: 'call Anna', due: null }).success, true, 'a null is dropped');
assert.deepEqual(stripNulls({ a: null, b: [1, { c: null, d: 2 }] }), { b: [1, { d: 2 }] });
assert.deepEqual(leanSchema(z.object({ n: z.number().int(), s: z.string().max(5) })), { type: 'object', properties: { n: { type: 'integer' }, s: { type: 'string' } }, required: ['n', 's'] }, 'zod\'s safe-integer bounds go too');

// The shorter descriptions: only for tools that exist, by name, and the rules code doesn't enforce are still in them.
const NAMES = ['remember_commitment', 'update_commitment', 'list_commitments', 'write_note', 'search_notes', 'read_note', 'link_note', 'notes_for', 'schedule_block', 'move_block', 'unschedule_block', 'show_day', 'plan_day', 'set_priority', 'sort_tasks', 'show_matrix', 'sync_todos', 'show_pending', 'item_dealt_with', 'ask_pi', 'stop_pi', 'switch_project'];
const S = SHORT('Test');
assert.deepEqual(Object.keys(S).sort(), [...NAMES].sort());
for (const [n, d] of Object.entries(S)) assert.ok(d.length < 1500, `${n} stays short`);
for (const [n, must] of [
  ['remember_commitment', ['Never choose the kind by how soon it is due', '"remind me" is \'reminder\'', 'timestamp']],
  ['schedule_block', ['never add to it, number it or reword it', 'never that it is booked', 'never ask which one yourself', 'Never work out a weekday\'s date']],
  ['move_block', ['never that it is moved']],
  ['write_note', ['add nothing', 'only when they ask']],
  ['ask_pi', ['adding nothing they didn\'t ask for', 'only when Test asked for something to be changed', 'Don\'t wait for pi']],
  ['show_pending', ['don\'t ask them or act on them']],
  ['item_dealt_with', ['Never for a to-do']],
]) for (const m of must) assert.ok(S[n].includes(m), `${n} keeps "${m}"`);
// Applied by name: the files that define the tools don't change.
for (const f of ['tools.mjs', 'calendar.mjs', 'notes.mjs', 'flow.mjs', 'handover.mjs', 'pi.mjs']) assert.ok(!fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').includes('lean.mjs'), `${f} doesn't use lean.mjs`);
console.log('lean tests passed');
