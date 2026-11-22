// Whether pi and what it starts end after a hand-off, after stop and after the time limit. A stand-in for pi (a shell
// script that starts a child of its own); the real createPi, the real sandbox-exec. No real pi, no model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPi } from '../pi.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pitest-')));
const proj = path.join(home, 'Documents', 'proj'), dir = path.join(home, 'Documents', 'roamies-pi'), tools = path.join(home, 'mytools');
for (const d of [proj, dir, tools]) fs.mkdirSync(d, { recursive: true });
const fake = path.join(tools, 'pi');
fs.writeFileSync(fake, `#!/bin/sh
# the last argument is the prompt: finish | hang | deaf
for a in "$@"; do p="$a"; done
/bin/sleep 300 &
echo $! > "$PWD/child.pid"; echo $$ > "$PWD/pi.pid"
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"stopReason":"stop"}}'
case "$p" in
  finish) exit 0 ;;
  deaf) trap '' TERM; while :; do /bin/sleep 1; done ;;
  *) wait ;;
esac
`, { mode: 0o755 });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pids = () => ({ pi: Number(fs.readFileSync(path.join(proj, 'pi.pid'), 'utf8')), child: Number(fs.readFileSync(path.join(proj, 'child.pid'), 'utf8')) });
async function run(label, prompt, maxMinutes, act) {
  for (const f of ['pi.pid', 'child.pid']) fs.rmSync(path.join(proj, f), { force: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: proj, projects: [proj], toolFolders: [tools], pi: fake, autoSendReadOnly: 0, maxMinutes }));
  const done = [];
  const pi = createPi({ home, userName: 'T', shell: '/bin/sh', onDone: (r) => done.push(r), ask: async () => 'yes' });
  await pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt, mode: 'edit' }, {});
  for (let i = 0; i < 300 && !fs.existsSync(path.join(proj, 'child.pid')); i++) await sleep(10);
  await sleep(300);
  const p = pids();
  await act(pi);
  for (let i = 0; i < 500 && !done.length; i++) await sleep(10);
  await sleep(2000);
  console.log(`${label}: status ${done[0]?.status ?? 'still running'}; 2 s later pi ${alive(p.pi) ? 'ALIVE' : 'gone'}, the process pi started ${alive(p.child) ? 'ALIVE' : 'gone'}`);
  for (const x of [p.pi, p.child]) { try { process.kill(x, 'SIGKILL'); } catch { /* gone */ } }
}
await run('a hand-off that finishes', 'finish', 60, async () => {});
await run('stop_pi', 'hang', 60, async (pi) => { pi.tools.find((t) => t.name === 'stop_pi') ? await pi.tools.find((t) => t.name === 'stop_pi').execute({}, {}) : pi.stop(); });
await run('the time limit (maxMinutes)', 'hang', 0.02, async () => { await sleep(1500); });
await run('stop_pi, pi ignoring the signal', 'deaf', 60, async (pi) => { pi.stop(); });
fs.rmSync(home, { recursive: true, force: true });
process.exit(0);
