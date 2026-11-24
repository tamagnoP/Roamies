// Feature 24: the extension Roamies gives pi (leftovers.mjs), with the real pi installed on this Mac and no model: a
// second extension, for this test only, stands in for the model with pi's own scripted provider ("faux"). Through the
// real createPi and the real sandbox. Skipped where pi isn't installed (CI).
//   - "Can edit": pi's bash tool is the extension's, and the model is told nothing new (same tools, same description,
//     same system prompt); a command's background job is ended when pi finishes; the line in front of the command is
//     in nothing pi shows or keeps (tool results, events, its session file).
//   - "Read only": no extension, and exactly read, grep, find and ls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPi } from '../pi.mjs';

if (process.platform !== 'darwin') { console.log('pi extension tests: skipped (macOS only)'); process.exit(0); }
const which = (spawnSync('/bin/sh', ['-lc', 'command -v pi'], { encoding: 'utf8' }).stdout ?? '').trim();
if (!which) { console.log('pi extension tests: skipped (no pi here)'); process.exit(0); }
const realPi = fs.realpathSync(which);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ext-')));
process.on('exit', () => fs.rmSync(h, { recursive: true, force: true }));
const proj = path.join(h, 'Documents', 'proj'), d = path.join(h, 'Documents', 'roamies-pi'), bin = path.join(h, 'mytools'), agent = path.join(h, '.pi', 'agent');
for (const x of [proj, d, bin, agent]) fs.mkdirSync(x, { recursive: true });
const model = path.join(bin, 'model.ts');
fs.writeFileSync(model, `import fs from "node:fs";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
const out = process.env.RX_OUT!;
export default function (pi: any) {
  const f = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  f.setResponses([
    fauxAssistantMessage(fauxToolCall("bash", { command: 'sleep 300 & echo $! > child.pid; echo started' }), { stopReason: "toolUse" }),
    (ctx: any) => { fs.writeFileSync(out + ".context.json", JSON.stringify(ctx)); return fauxAssistantMessage("done"); },
  ]);
  pi.registerProvider(f.provider);
  pi.on("before_agent_start", (e: any) => { fs.writeFileSync(out + ".start.json", JSON.stringify({ active: pi.getActiveTools(), all: pi.getAllTools().map((t: any) => ({ name: t.name, description: t.description, from: t.sourceInfo?.path ?? "" })), systemPrompt: e.systemPrompt })); });
}
`);
const wrapper = path.join(bin, 'pi');
fs.writeFileSync(wrapper, `#!/bin/sh\nPI_CODING_AGENT_DIR=${JSON.stringify(agent)} exec ${JSON.stringify(realPi)} -e ${JSON.stringify(model)} --provider faux --model faux-1 "$@"\n`, { mode: 0o755 });
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function run(mode, tag) {
  process.env.RX_OUT = path.join(proj, tag);
  fs.rmSync(path.join(proj, 'child.pid'), { force: true });
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ project: proj, projects: [proj], toolFolders: [bin], pi: wrapper, autoSendReadOnly: 0 }));
  const done = [], logs = [];
  const pi = createPi({ home: h, userName: 'T', shell: '/bin/sh', onDone: (r) => done.push(r), ask: async () => 'yes', log: (k, v) => logs.push([k, v]) });
  await pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt: 'go', mode }, {});
  for (let i = 0; i < 3000 && !done.length; i++) await sleep(10);
  await sleep(2500);
  return { r: done[0], logs, start: JSON.parse(read(`${process.env.RX_OUT}.start.json`) || 'null'), context: read(`${process.env.RX_OUT}.context.json`) };
}

// ---- can edit
const e = await run('edit', 'edit');
assert.equal(e.r?.status, 'done', `pi ran (${e.r?.problem ?? 'no result'})`);
assert.deepEqual(e.start.active, ['read', 'bash', 'edit', 'write'], 'the same tools');
const bash = e.start.all.filter((t) => t.name === 'bash');
assert.equal(bash.length, 1); assert.match(bash[0].from, /\/roamies-pi-[^/]+\/roamies-leftovers\.ts$/, 'bash is the extension\'s');
const child = Number(read(path.join(proj, 'child.pid')));
assert.ok(child > 0, 'the command ran'); assert.ok(!alive(child), 'its background job was ended');
assert.match(e.r.shown, /\n\nPi's commands had left 1 process running\. I ended it\.$/);
assert.ok(!e.logs.some(([k]) => k === 'pi_leftovers_off'), 'the extension loaded and found spawnHook, inside the sandbox');
assert.match(e.context, /"text":"started\\n"/, 'the command\'s output, as it was');
const said = [e.context, read(path.join(d, 'log', fs.readdirSync(path.join(d, 'log')).find((f) => f.endsWith('_edit.jsonl')))).split('\n').filter((l) => !l.includes('"type":"roamies_')).join('\n')];
for (const dir of fs.readdirSync(path.join(agent, 'sessions'))) for (const f of fs.readdirSync(path.join(agent, 'sessions', dir))) said.push(read(path.join(agent, 'sessions', dir, f)));
assert.ok(said.length >= 3, 'the model\'s context, pi\'s events and its session file');
for (const text of said) assert.ok(!/printf|roamies-pi-|\$\$/.test(text), 'the line and the record appear in nothing pi shows or keeps');
assert.match(said.at(-1), /"command":"sleep 300 & echo \$! > child\.pid; echo started"/, 'pi keeps the command as the model wrote it');

// the same pi without the extension: what the model is given is the same
process.env.RX_OUT = path.join(proj, 'plain');
const plain = spawnSync(wrapper, ['--mode', 'json', '--no-session', '--', 'go'], { cwd: proj, encoding: 'utf8', timeout: 60_000 });
assert.equal(plain.status, 0, plain.stderr);
const base = JSON.parse(read(`${process.env.RX_OUT}.start.json`));
try { process.kill(Number(read(path.join(proj, 'child.pid'))), 'SIGKILL'); } catch { /* gone */ }
assert.equal(e.start.systemPrompt, base.systemPrompt, 'the same system prompt');
assert.deepEqual(e.start.all.map((t) => [t.name, t.description]), base.all.map((t) => [t.name, t.description]), 'the same tools, described the same');
assert.equal(base.all.find((t) => t.name === 'bash').from, 'builtin:bash', 'without it, pi\'s own bash');

// ---- read only
const r = await run('read', 'read');
assert.equal(r.r?.status, 'done');
assert.deepEqual(r.start.active, ['read', 'grep', 'find', 'ls'], 'read only: exactly these');
assert.ok(!r.start.all.some((t) => t.name === 'bash'), 'and no bash at all');
assert.ok(!r.logs.some(([k]) => /^pi_leftovers/.test(k)), 'no extension');
assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('roamies-pi-')).length, 0, 'no hand-off folder left');

console.log('pi extension tests: passed');
