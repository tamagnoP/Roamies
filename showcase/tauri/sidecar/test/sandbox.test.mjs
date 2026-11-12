// Local-only build: the macOS sandbox pi runs in (pi.mjs: sandboxProfile). These run the real /usr/bin/sandbox-exec.
// pi is stood in for by a script that does what its prompt lists (write here, read there, connect to a socket, run
// a program) from inside the sandbox and reports, in its reply, what the system let it do.
//
// The pretend home folder sits beside this file, not in the temporary folder: temporary folders are writable under
// the sandbox, so a home in there would prove nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createPi, loadSettings, sandboxProblem, sandboxProfile, TOOL_FOLDERS } from '../pi.mjs';

if (process.platform !== 'darwin') { console.log('sandbox tests: skipped (macOS only)'); process.exit(0); }

const here = path.dirname(new URL(import.meta.url).pathname);
const home = fs.realpathSync(fs.mkdtempSync(path.join(here, '.sbx-')));
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
// The pretend home is inside this repository: git must not look above it for one (the undo snapshot would land here).
process.env.GIT_CEILING_DIRECTORIES = home;
const H = (...p) => path.join(home, ...p);
const put = (p, text = 'secret\n') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const dir = H('Documents', 'roamies-pi'), settingsFile = path.join(dir, 'settings.json');
const cells = H('Documents', 'cells'), other = H('Documents', 'other'), ref = H('Documents', 'ref');

// ---- the stand-in pi
const fakePi = put(H('bin', 'pi'), `#!/usr/bin/env node
const fs = require('node:fs'), net = require('node:net'), path = require('node:path'), { spawnSync } = require('node:child_process');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const ops = JSON.parse(process.argv[process.argv.length - 1].split('@H').join(${JSON.stringify(home)})); // @H: the pretend home, to keep the prompt short
const connect = (p) => new Promise((resolve) => { const s = net.connect(p); s.on('data', () => { s.destroy(); resolve('ok'); }); s.on('error', (e) => resolve(e.code)); setTimeout(() => resolve('timeout'), 3000); });
(async () => {
  out({ type: 'session', version: 3, id: 'sess-1', cwd: process.cwd() });
  const got = {};
  for (const [name, op, target, ...rest] of ops) {
    try {
      if (op === 'write') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'written by pi\\n'); got[name] = 'ok'; }
      else if (op === 'append') { fs.appendFileSync(target, 'more\\n'); got[name] = 'ok'; }
      else if (op === 'read') { fs.readFileSync(target, 'utf8'); got[name] = 'ok'; }
      else if (op === 'list') { fs.readdirSync(target); got[name] = 'ok'; }
      else if (op === 'stat') { fs.statSync(target); got[name] = 'ok'; }
      else if (op === 'remove') { fs.rmSync(target); got[name] = 'ok'; }
      else if (op === 'rename') { fs.renameSync(target, rest[0]); got[name] = 'ok'; }
      else if (op === 'link') { fs.linkSync(target, rest[0]); got[name] = 'ok'; }
      else if (op === 'connect') got[name] = await connect(target);
      else if (op === 'run') { const r = spawnSync(target, rest, { encoding: 'utf8', timeout: 5000 }); got[name] = r.error ? r.error.code : r.status === 0 ? 'ok' : 'exit ' + r.status; }
    } catch (e) { got[name] = e.code || e.message; }
  }
  out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(got) }], stopReason: 'stop' } });
})();
`);
fs.chmodSync(fakePi, 0o755);
put(H('bin', 'package.json'), '{ "type": "commonjs" }\n'); // the pretend home is inside the sidecar's package, which is ESM
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;

// ---- the pretend home
loadSettings(home); // makes roamies-pi, its log and workspace, and settings.json
put(path.join(dir, 'state.json'), '{}\n'); put(path.join(dir, 'log', 'old.jsonl'), '{}\n'); put(path.join(dir, 'workspace', 'in-workspace.txt'));
put(path.join(cells, 'a.py')); put(path.join(cells, 'frozen', 'f.txt')); put(path.join(cells, 'nested', 'n.txt'));
put(path.join(other, 'o.txt')); put(path.join(ref, 'r.txt')); put(H('Documents', 'private', 'p.txt')); put(H('Desktop', 'd.txt')); put(H('Library', 'CloudStorage', 'Drive', 'c.txt'));
put(H('.ssh', 'id')); put(H('.gnupg', 'key')); put(H('.gg', 'g')); put(H('.claude', 'c')); put(H('Library', 'Keychains', 'login.keychain-db'));
put(H('Library', 'Application Support', 'superProductivity', 'data')); put(H('.config', 'gh', 'hosts.yml')); put(H('.cache', 'huggingface', 'token')); put(H('.cache', 'huggingface', 'hub', 'model.bin'));
put(H('.config', 'git', 'ignore')); put(H('.config', 'zotero-mcp', 'key')); put(H('.bash_history')); put(H('.bash_profile'), '');
put(H('.cargo', 'bin', 'tool')); put(H('.matplotlib', 'rc')); put(H('mytools', 'lib.txt')); put(H('.toolrc'));
put(H('.pi', 'agent', 'auth.json'), '{}'); put(H('.pi', 'agent', 'models.json'), '{}'); put(H('.pi', 'agent', 'settings.json'), '{}'); put(H('.pi', 'agent', 'trust.json'), '{}'); put(H('.pi', 'agent', 'APPEND_SYSTEM.md')); put(H('.pi', 'agent', 'SYSTEM.md'));
put(H('.pi', 'agent', 'skills', 's', 'SKILL.md')); put(H('.pi', 'agent', 'bin', 'rg')); put(H('.pi', 'agent', 'sessions', 'old.jsonl'));
put(H('.docker', 'config.json'), '{}'); put(H('.orbstack', 'ssh', 'id')); fs.mkdirSync(H('.orbstack', 'run'), { recursive: true });
fs.symlinkSync(ref, H('Documents', 'ref-link')); // a listed folder given through a symbolic link
const tmpFile = path.join(os.tmpdir(), `sbx-test-${process.pid}.txt`);

// Docker stands in as a socket where OrbStack keeps its own.
const sock = H('.orbstack', 'run', 'docker.sock');
assert.ok(Buffer.byteLength(sock) < 104, `the test's socket path is too long for a Unix socket (${sock}): move the repository to a shorter path`);
const server = net.createServer((c) => c.end('hi')); await new Promise((r) => server.listen(sock, r));

const base = {
  project: '~/Documents/cells', projects: ['~/Documents/cells', '~/Documents/other', '~/Documents/cells/nested'],
  readOnly: ['~/Documents/ref-link', '~/Documents/roamies-pi', '~/Documents/cells/frozen'],
  toolFolders: ['~/mytools', '~/.toolrc', '~/.ssh', '~/.config'], pi: fakePi, autoSendReadOnly: 0,
};
const set = (o = {}) => fs.writeFileSync(settingsFile, JSON.stringify({ ...base, ...o }));

// ---- a pi with a user who clicks Send
const asked = [], done = [];
const make = (extra = {}) => createPi({ home, userName: 'Tiago', shell: '/bin/sh', onDone: (r) => done.push(r), ask: async (q) => { asked.push(q.placeholder); return 'yes'; }, ...extra });
const pi = make();
const short = (ops) => JSON.stringify(ops).split(home).join('@H');
/** Hands the list of things to try to the stand-in, in edit mode, and gives back what happened to each. */
const attempt = async (ops, who = pi, mode = 'edit') => {
  done.length = 0;
  await who.tools.find((t) => t.name === 'ask_pi').execute({ prompt: short(ops), mode }, {});
  for (let i = 0; i < 1000 && !done.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(done[0]?.status, 'done', `the stand-in ran: ${done[0]?.problem}`);
  return JSON.parse(done[0].reply);
};
const DENIED = 'EPERM';
const lastRecord = () => { const logs = path.join(dir, 'log'); const f = fs.readdirSync(logs).filter((n) => n !== 'old.jsonl').map((n) => [fs.statSync(path.join(logs, n)).mtimeMs, n]).sort((x, y) => x[0] - y[0]).at(-1)[1]; return JSON.parse(fs.readFileSync(path.join(logs, f), 'utf8').split('\n')[0]); };

// ---- the settings: on by default, lists empty by default, files from before this still work
{
  fs.writeFileSync(settingsFile, JSON.stringify({ project: '~/Documents/cells' }));
  const s = loadSettings(home);
  assert.equal(s.sandbox, true); assert.deepEqual(s.readOnly, []); assert.deepEqual(s.docker, []);
  assert.deepEqual(s.toolFolders, TOOL_FOLDERS.map((p) => p.replace(/^~/, home)), 'the built-in tool folders');
  fs.writeFileSync(settingsFile, JSON.stringify({ sandbox: false, readOnly: ['~/Documents/ref', 7, ''], toolFolders: ['~/mytools', '~/.cargo'], toolFoldersOff: ['~/.npm', '~/.cache/uv'], docker: ['~/Documents/cells'] }));
  const t = loadSettings(home);
  assert.equal(t.sandbox, false); assert.deepEqual(t.readOnly, [ref]); assert.deepEqual(t.docker, [cells]);
  assert.ok(t.toolFolders.includes(H('mytools')) && t.toolFolders.includes(H('.cellpose')), '"toolFolders" adds to the built-in list');
  assert.ok(!t.toolFolders.includes(H('.npm')) && !t.toolFolders.includes(H('.cache', 'uv')), '"toolFoldersOff" drops built-in ones');
  assert.equal(t.toolFolders.filter((p) => p === H('.cargo')).length, 1, 'one listed twice is there once');
  assert.equal(t.toolFolders.length, TOOL_FOLDERS.length - 2 + 1);
  for (const v of ['yes', 0, null, 'false']) { fs.writeFileSync(settingsFile, JSON.stringify({ sandbox: v })); assert.equal(loadSettings(home).sandbox, true, 'only false switches it off'); }
}
{ // a new settings file names the four settings, with their defaults
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-fresh-')));
  loadSettings(fresh);
  const made = JSON.parse(fs.readFileSync(path.join(fresh, 'Documents', 'roamies-pi', 'settings.json'), 'utf8'));
  assert.equal(made.sandbox, true); assert.deepEqual([made.readOnly, made.toolFolders, made.toolFoldersOff, made.docker], [[], [], [], []]);
  fs.rmSync(fresh, { recursive: true, force: true });
}

// ---- the profile itself
{
  set();
  const s = loadSettings(home);
  const { profile, reads, docker } = sandboxProfile({ home, project: s.project, settings: s });
  assert.equal(reads, 6, 'the project, two other projects and three readOnly folders'); assert.equal(docker, false);
  assert.equal(sandboxProblem(profile), '', 'the system accepts it');
  const lines = profile.trim().split('\n');
  assert.match(lines.at(-1), /^\(deny file-read\* file-write\* /, 'the blocked paths are the last rule, so nothing overrides them');
  for (const p of [path.join(dir, 'settings.json'), path.join(dir, 'state.json'), path.join(dir, 'log'), H('.ssh'), H('.gnupg'), H('.gg'), H('.claude'), H('Library', 'Keychains'), '/Library/Keychains', H('Library', 'Application Support', 'superProductivity'), H('.config', 'gh')]) assert.ok(lines.at(-1).includes(`"${p}")`), `blocked: ${p}`);
  assert.ok(profile.includes(`(subpath "${ref}")`) && !/subpath "[^"]*ref-link/.test(profile), 'folders by their real paths, not the links to them');
  assert.ok(profile.includes(`(literal "${H('Documents', 'ref-link')}")`), 'the link itself can be read, so the path as written works');
  assert.ok(profile.includes('(deny appleevent-send)') && profile.includes('(deny process-exec* (literal "/usr/bin/security") (literal "/usr/bin/osascript") (literal "/usr/bin/open"))'));
  assert.ok(!/\(allow network|\(deny network-(inbound|bind)|\(deny network\*/.test(profile), 'the network is left alone, but for the Docker sockets');
  // a folder name with a quote or a backslash in it can't break out of its rule
  const odd = H('Documents', 'odd "name" \\ here'); fs.mkdirSync(odd);
  const o = sandboxProfile({ home, project: odd, settings: { ...s, project: odd } });
  assert.ok(o.profile.includes('odd \\"name\\" \\\\ here"'), 'quotes and backslashes are escaped'); assert.equal(sandboxProblem(o.profile), '');
  assert.throws(() => sandboxProfile({ home, project: H('Documents', 'a\nb'), settings: s }), /line break/);
  assert.match(sandboxProblem('(version 1)\n(this is not a profile'), /\S/, 'a profile the system rejects is reported');
  assert.match(sandboxProblem(profile, '/nowhere/sandbox-exec'), /is missing/);
}

// ---- the six things the owner asked to see, and the rest of the policy, tried from inside
{
  set();
  const got = await attempt([
    // writing
    ['write in a subfolder of the project', 'write', path.join(cells, 'sub', 'deeper', 'new.txt')],
    ['change a file in the project', 'append', path.join(cells, 'a.py')],
    ['write outside the project', 'write', H('out.txt')],
    ['write outside the project, by a command pi runs', 'run', '/bin/sh', '-c', `echo x > '${H('out2.txt')}'`],
    ['write in a project that is not the current one', 'write', path.join(other, 'w.txt')],
    ['change a file in another project', 'append', path.join(other, 'o.txt')],
    ['write in a readOnly folder', 'write', path.join(ref, 'w.txt')],
    ['remove a file in a readOnly folder', 'remove', path.join(ref, 'r.txt')],
    ['move a file out of a readOnly folder', 'rename', path.join(ref, 'r.txt'), path.join(cells, 'stolen.txt')],
    ['hard-link another project\'s file into the project', 'link', path.join(other, 'o.txt'), path.join(cells, 'linked.txt')],
    ['write in a readOnly folder inside the project', 'write', path.join(cells, 'frozen', 'w.txt')],
    ['write in another project inside the project', 'write', path.join(cells, 'nested', 'w.txt')],
    ['write in a tool folder', 'write', H('.cargo', 'bin', 'evil')],
    ['write in the home folder\'s start-up file', 'append', H('.bash_profile')],
    ['write in a temporary folder', 'write', tmpFile],
    // reading
    ['read the project', 'read', path.join(cells, 'a.py')],
    ['read another project', 'read', path.join(other, 'o.txt')],
    ['read a readOnly folder', 'read', path.join(ref, 'r.txt')],
    ['read a readOnly folder through its link', 'read', H('Documents', 'ref-link', 'r.txt')],
    ['read a readOnly folder inside the project', 'read', path.join(cells, 'frozen', 'f.txt')],
    ['read an unlisted folder under Documents', 'read', H('Documents', 'private', 'p.txt')],
    ['list Documents', 'list', H('Documents')],
    ['list the home folder', 'list', home],
    ['read the Desktop', 'read', H('Desktop', 'd.txt')],
    ['read a cloud-synced folder', 'read', H('Library', 'CloudStorage', 'Drive', 'c.txt')],
    ['read the shell history', 'read', H('.bash_history')],
    ['read a built-in tool folder', 'read', H('.matplotlib', 'rc')],
    ['read a tool folder from the settings', 'read', H('mytools', 'lib.txt')],
    ['read a tool file from the settings', 'read', H('.toolrc')],
    ['read a model cache', 'read', H('.cache', 'huggingface', 'hub', 'model.bin')],
    ['see that Documents exists', 'stat', H('Documents')],
    // blocked, though each sits in a folder the settings made readable
    ['read a file beside the settings (the folder is readOnly)', 'read the rest of ~/.config, listed as a tool folder', 'read', path.join(dir, 'workspace', 'in-workspace.txt')],
    ['read settings.json, inside a readable folder', 'read', settingsFile],
    ['write settings.json', 'append', settingsFile],
    ['read state.json', 'read', path.join(dir, 'state.json')],
    ['write state.json', 'append', path.join(dir, 'state.json')],
    ['list the hand-off records', 'list', path.join(dir, 'log')],
    ['read a hand-off record', 'read', path.join(dir, 'log', 'old.jsonl')],
    ['write a hand-off record', 'write', path.join(dir, 'log', 'forged.jsonl')],
    ['read ~/.ssh, though listed as a tool folder', 'read', H('.ssh', 'id')],
    ['read ~/.config/gh, though ~/.config is a tool folder', 'read', H('.config', 'gh', 'hosts.yml')],
    ['read the rest of ~/.config, listed as a tool folder', 'read', H('.config', 'zotero-mcp', 'key')],
    ['read ~/.gnupg', 'read', H('.gnupg', 'key')],
    ['read ~/.gg', 'read', H('.gg', 'g')],
    ['read ~/.claude', 'read', H('.claude', 'c')],
    ['read a keychain', 'read', H('Library', 'Keychains', 'login.keychain-db')],
    ['read Super Productivity', 'read', H('Library', 'Application Support', 'superProductivity', 'data')],
    ['read the Hugging Face token', 'read', H('.cache', 'huggingface', 'token')],
    ['read OrbStack\'s keys', 'read', H('.orbstack', 'ssh', 'id')],
    // pi's own folder: readable, and writable only where pi has to write
    ['read pi\'s sign-in', 'read', H('.pi', 'agent', 'auth.json')],
    ['read pi\'s skills', 'read', H('.pi', 'agent', 'skills', 's', 'SKILL.md')],
    ['write a pi session', 'write', H('.pi', 'agent', 'sessions', 'proj', 'new.jsonl')],
    ['write pi\'s sign-in', 'append', H('.pi', 'agent', 'auth.json')],
    ['take pi\'s sign-in lock', 'write', H('.pi', 'agent', 'auth.json.lock', 'x')],
    ['take pi\'s settings lock', 'write', H('.pi', 'agent', 'settings.json.lock', 'x')],
    ['take pi\'s trust lock', 'write', H('.pi', 'agent', 'trust.json.lock', 'x')],
    ['write pi\'s model list', 'append', H('.pi', 'agent', 'models.json')],
    ['write pi\'s settings', 'append', H('.pi', 'agent', 'settings.json')],
    ['write pi\'s trust file', 'append', H('.pi', 'agent', 'trust.json')],
    ['write APPEND_SYSTEM.md', 'append', H('.pi', 'agent', 'APPEND_SYSTEM.md')],
    ['write SYSTEM.md', 'append', H('.pi', 'agent', 'SYSTEM.md')],
    ['add a pi skill', 'write', H('.pi', 'agent', 'skills', 'evil', 'SKILL.md')],
    ['add a pi extension', 'write', H('.pi', 'agent', 'extensions', 'evil.ts')],
    ['replace a pi tool', 'append', H('.pi', 'agent', 'bin', 'rg')],
    ['add a pi template', 'write', H('.pi', 'agent', 'templates', 'T.md')],
    ['add a pi package', 'write', H('.pi', 'agent', 'npm', 'p.js')],
    // programs and Docker
    ['run an ordinary program', 'run', '/usr/bin/true'],
    ['run security', 'run', '/usr/bin/security', 'help'],
    ['run osascript', 'run', '/usr/bin/osascript', '-e', 'return 1'],
    ['run open', 'run', '/usr/bin/open', '-h'],
    ['connect to Docker', 'connect', sock],
  ]);
  const allowed = new Set(['write in a subfolder of the project', 'change a file in the project', 'write in a temporary folder',
    'read the project', 'read another project', 'read a readOnly folder', 'read a readOnly folder through its link', 'read a readOnly folder inside the project',
    'read a built-in tool folder', 'read a tool folder from the settings', 'read a tool file from the settings', 'read a model cache', 'see that Documents exists',
    'read a file beside the settings (the folder is readOnly)', 'read the rest of ~/.config, listed as a tool folder', 'read pi\'s sign-in', 'read pi\'s skills', 'write a pi session', 'write pi\'s sign-in', 'take pi\'s sign-in lock', 'take pi\'s settings lock', 'take pi\'s trust lock', 'run an ordinary program']);
  const refusedAs = { 'write outside the project, by a command pi runs': 'exit 1' }; // the shell reports its own failed write
  for (const [what, result] of Object.entries(got)) assert.equal(result, allowed.has(what) ? 'ok' : refusedAs[what] ?? DENIED, what);
  for (const asked of ['write outside the project', 'write in a project that is not the current one', 'write in a readOnly folder', 'read an unlisted folder under Documents', 'read settings.json, inside a readable folder', 'write in a subfolder of the project']) assert.ok(asked in got, asked);
  // ...and on disk, from outside: what was refused did not happen
  assert.equal(fs.readFileSync(path.join(cells, 'sub', 'deeper', 'new.txt'), 'utf8'), 'written by pi\n');
  for (const p of [H('out.txt'), H('out2.txt'), path.join(other, 'w.txt'), path.join(ref, 'w.txt'), path.join(cells, 'frozen', 'w.txt'), path.join(cells, 'nested', 'w.txt'), path.join(cells, 'stolen.txt'), path.join(cells, 'linked.txt'), path.join(dir, 'log', 'forged.jsonl'), H('.pi', 'agent', 'skills', 'evil')]) assert.ok(!fs.existsSync(p), `not made: ${p}`);
  assert.equal(fs.readFileSync(path.join(other, 'o.txt'), 'utf8'), 'secret\n'); assert.equal(fs.readFileSync(path.join(ref, 'r.txt'), 'utf8'), 'secret\n');
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), JSON.stringify(base));
  fs.rmSync(tmpFile, { force: true });
  // the Send bubble said so, in one line, and the record has it
  assert.match(asked.at(-1), /^Send to pi\?  CAN EDIT files and run commands · in ~\/Documents\/cells\n⚠ pi is started with: \S+\nNo undo snapshot \(not a git repository\)\.\nSandboxed: pi can read 6 folders and write only in this project\.\n\n\[\[/);
  assert.ok(!asked.at(-1).split('\n\n')[0].includes('Docker'));
  assert.equal(lastRecord().sandbox, 'on'); assert.equal(lastRecord().docker, false);
}

// ---- read-only hand-offs are confined the same way
{
  const got = await attempt([['read the project', 'read', path.join(cells, 'a.py')], ['read an unlisted folder under Documents', 'read', H('Documents', 'private', 'p.txt')], ['write outside the project', 'write', H('out.txt')]], pi, 'read');
  assert.deepEqual(got, { 'read the project': 'ok', 'read an unlisted folder under Documents': DENIED, 'write outside the project': DENIED });
  assert.match(asked.at(-1), /^Send to pi\?  Read only · .*\nSandboxed: pi can read 6 folders and write only in this project\.\n\n/s);
}

// ---- the current project is the only one that can be written: after a switch, the old one can't
{
  set({ project: '~/Documents/other', toolFolders: [] });
  const got = await attempt([['write in the project', 'write', path.join(other, 'now.txt')], ['write in the project it was in before', 'write', path.join(cells, 'late.txt')], ['read it', 'read', path.join(cells, 'a.py')],
    ['read ~/.config/git, a built-in tool folder', 'read', H('.config', 'git', 'ignore')], ['read the rest of ~/.config, not listed', 'read', H('.config', 'zotero-mcp', 'key')], ['read a tool folder no longer listed', 'read', H('mytools', 'lib.txt')]]);
  assert.deepEqual(got, { 'write in the project': 'ok', 'write in the project it was in before': DENIED, 'read it': 'ok', 'read ~/.config/git, a built-in tool folder': 'ok', 'read the rest of ~/.config, not listed': DENIED, 'read a tool folder no longer listed': DENIED });
  set({ project: '~/Documents/other', toolFolders: [], toolFoldersOff: ['~/.config/git'] });
  assert.deepEqual(await attempt([['read a built-in tool folder that was dropped', 'read', H('.config', 'git', 'ignore')]]), { 'read a built-in tool folder that was dropped': DENIED });
}
{ // a project inside a readOnly folder is still writable; the folder around it is not
  set({ project: '~/Documents/ref/inner', projects: ['~/Documents/ref/inner'], readOnly: ['~/Documents/ref'] });
  fs.mkdirSync(path.join(ref, 'inner'));
  const got = await attempt([['write in the project', 'write', path.join(ref, 'inner', 'x.txt')], ['write beside it', 'write', path.join(ref, 'y.txt')], ['read beside it', 'read', path.join(ref, 'r.txt')]]);
  assert.deepEqual(got, { 'write in the project': 'ok', 'write beside it': DENIED, 'read beside it': 'ok' });
  assert.match(asked.at(-1), /Sandboxed: pi can read 2 folders and write only in this project\./);
}

// ---- Docker: denied unless the current project is in "docker"
{
  const dockerOps = [['connect to Docker', 'connect', sock], ['read docker\'s config', 'read', H('.docker', 'config.json')], ['read OrbStack\'s keys', 'read', H('.orbstack', 'ssh', 'id')], ['write outside the project', 'write', H('out.txt')]];
  set({ docker: ['~/Documents/other'] }); // allowed for another project, not this one
  assert.deepEqual(await attempt(dockerOps), { 'connect to Docker': DENIED, 'read docker\'s config': DENIED, 'read OrbStack\'s keys': DENIED, 'write outside the project': DENIED });
  assert.ok(!asked.at(-1).split('\n\n')[0].includes('Docker'));
  set({ docker: ['~/Documents/cells'] });
  assert.deepEqual(await attempt(dockerOps), { 'connect to Docker': 'ok', 'read docker\'s config': 'ok', 'read OrbStack\'s keys': DENIED, 'write outside the project': DENIED });
  assert.match(asked.at(-1), /\nSandboxed: pi can read 6 folders and write only in this project\.\nDocker allowed: containers can reach folders outside this project\.\n\n/);
  assert.equal(lastRecord().docker, true);
}

// ---- switched off in the settings: the bubble says so plainly, and pi is not confined
{
  set({ sandbox: false });
  const got = await attempt([['write outside the project', 'write', H('unconfined.txt')], ['read an unlisted folder under Documents', 'read', H('Documents', 'private', 'p.txt')]]);
  assert.deepEqual(got, { 'write outside the project': 'ok', 'read an unlisted folder under Documents': 'ok' });
  assert.match(asked.at(-1), /\n⚠ Sandbox is off: pi is not confined\.\n\n/); assert.ok(!asked.at(-1).includes('Sandboxed'));
  assert.equal(lastRecord().sandbox, 'off');
  fs.rmSync(H('unconfined.txt'));
}

// ---- the sandbox can't be applied: nothing goes by itself, the bubble says pi would run unconfined, the owner decides
{
  set({ autoSendReadOnly: 0.05 });
  let open = null; const shown = [];
  const broken = make({ now: () => Date.now() + 5000, sandboxExec: '/nowhere/sandbox-exec', ask: (q) => new Promise((resolve) => { shown.push(q); open = resolve; }) });
  done.length = 0;
  let sent = false;
  const waiting = broken.tools.find((t) => t.name === 'ask_pi').execute({ prompt: short([['write outside the project', 'write', H('unconfined.txt')]]), mode: 'read' }, {}).then(() => { sent = true; });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sent, false, 'a read-only hand-off does not send itself when it would run unconfined');
  assert.equal(done.length, 0); assert.ok(!fs.existsSync(H('unconfined.txt')));
  assert.match(shown[0].placeholder, /^Send to pi\?  Read only · in ~\/Documents\/cells\n⚠ pi is started with: \S+\n⚠ The sandbox could not be applied \(\/nowhere\/sandbox-exec is missing\)\. If you send, pi runs unconfined\.\n\n/);
  assert.deepEqual(shown[0].choices, ['Send', "Don't send"]);
  // Don't send: nothing runs
  open(null); await assert.rejects(waiting, /didn't say send/);
  assert.equal(done.length, 0);
  // Send: it runs, unconfined, as the bubble said, and the record says so
  const again = broken.tools.find((t) => t.name === 'ask_pi').execute({ prompt: short([['write outside the project', 'write', H('unconfined.txt')]]), mode: 'read' }, {});
  await new Promise((r) => setTimeout(r, 50)); open('yes'); await again;
  for (let i = 0; i < 1000 && !done.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(done[0].reply), { 'write outside the project': 'ok' });
  assert.equal(lastRecord().sandbox, 'not applied');
  // with the sandbox working, the same settings do send by themselves
  const working = make({ now: () => Date.now() + 10_000, ask: () => new Promise(() => {}) });
  done.length = 0;
  await working.tools.find((t) => t.name === 'ask_pi').execute({ prompt: short([['write outside the project', 'write', H('out.txt')]]), mode: 'read' }, {});
  for (let i = 0; i < 1000 && !done.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(done[0].reply), { 'write outside the project': DENIED });
  assert.equal(lastRecord().approved_by, 'auto');
}

server.close();
fs.rmSync(home, { recursive: true, force: true });
console.log('sandbox tests: passed');
