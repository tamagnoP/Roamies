// Local-only build (feature 41): pi's updates in plain words (piwatch.mjs). Reading commands, the five events and
// the everyday commands that must not count, the "named" rule, a digest with no command, output or file text, the
// checks on the model's sentence, code's lines, and when updates are given (on a fake clock).
import assert from 'node:assert/strict';
import os from 'node:os';
import { URGENT_SECONDS, checkSentence, classifyStep, cleanSaid, codeLines, commandWords, compose, createSchedule, createWatch, digestText, fallbackSentence, lex, mentions, namedBy, updatePrompt } from '../piwatch.mjs';

const P = '/Users/x/proj';
const kinds = (cmd) => { const c = classifyStep('bash', { command: cmd }, { cwd: P }); return [...c.events.map((e) => e.kind), ...c.changed.map((f) => f.how)].sort(); };
const names = (cmd, kind) => classifyStep('bash', { command: cmd }, { cwd: P }).events.filter((e) => e.kind === kind).flatMap((e) => e.names);

// ---- each event: the commands that count
for (const c of ['pip install pandas', 'pip3 install -U numpy', 'python3 -m pip install requests', 'npm install', 'npm i lodash', 'pnpm add zod', 'yarn', 'yarn add react', 'bun add hono', 'npm ci', 'uv add httpx', 'uv pip install torch', 'uv sync', 'poetry add rich', 'conda install -n env scipy', 'brew install jq', 'cargo add serde', 'go get example.com/x', 'gem install rails', 'apt-get install -y curl', 'sudo apt install git', 'pacman -S vim', 'VAR=1 pip install x', 'cd sub && npm install left-pad'])
  assert.deepEqual(kinds(c), ['install'], `an install: ${c}`);
assert.deepEqual(names('pip install pandas numpy', 'install'), ['pandas', 'numpy']);
assert.deepEqual(names('npm install', 'install'), ["the project's dependencies"]);
assert.deepEqual(names('pip install -r requirements.txt', 'install'), ['the packages listed in requirements.txt']);
assert.deepEqual(names('pip install -e .', 'install'), ['this project']);
assert.deepEqual(names('npm i -D @types/node', 'install'), ['@types/node']);
for (const c of ['rm old.csv', 'rm -rf build', 'rmdir empty', 'unlink a', 'trash notes.txt', 'git rm src/x.py', 'git clean -fd'])
  assert.ok(kinds(c).some((k) => k === 'deleted' || k === 'removed'), `a deletion: ${c}`);
assert.deepEqual(kinds('find . -name "*.log" -delete'), ['removed']);
assert.deepEqual(names('find . -name "*.log" -delete', 'removed'), ['files matching *.log']);
assert.deepEqual(kinds('mv a.txt b.txt'), ['changed', 'moved']);
assert.deepEqual(kinds('git mv a.txt b.txt'), ['moved']);
for (const c of ['echo hi > out.txt', 'cat a >> log.md', 'ls | tee list.txt', 'sed -i "" s/a/b/ config.yaml', 'sed -i.bak -e s/a/b/ config.yaml', 'perl -pi -e s/a/b/ x.cfg', 'cp a.txt dest.txt', 'touch new.md'])
  assert.ok(kinds(c).some((k) => k === 'changed' || k === 'created'), `a change: ${c}`);
assert.deepEqual(classifyStep('bash', { command: 'sed -i "" s/a/b/ config.yaml' }, { cwd: P }).changed.map((f) => f.path), [`${P}/config.yaml`], 'the script is not a file');
for (const c of ['curl -I https://example.com', 'wget http://x.org/f', 'ssh me@host', 'git clone https://github.com/a/b', 'git fetch', 'git pull', 'npx create-thing', 'docker pull python', 'hf download org/model', 'brew update', 'ping -c1 1.1.1.1', 'node fetch.js https://api.example.com/x', 'rsync -a src host:/backup/src'])
  assert.ok(kinds(c).includes('network') || kinds(c).includes('pushed'), `the network: ${c}`);
assert.deepEqual(names('curl -I https://example.com', 'network'), ['example.com']);
assert.deepEqual(kinds('pip install pandas'), ['install'], 'an install is not listed again as the network');
for (const c of ['git push', 'git push origin main', 'git -C ../repo push --force origin feature', 'gh pr create --fill', 'npm publish', 'cargo publish', 'twine upload dist/*', 'docker push me/img', 'scp report.pdf me@server:/tmp/', 'aws s3 cp out.csv s3://bucket/out.csv'])
  assert.ok(kinds(c).includes('pushed'), `a push: ${c}`);
assert.deepEqual(names('git push origin main', 'pushed'), ['the main branch to origin']);
assert.deepEqual(names('git push origin HEAD:release', 'pushed'), ['the release branch to origin']);
assert.deepEqual(names('git push', 'pushed'), ['the current branch']);
// through shells and wrappers
assert.deepEqual(kinds('bash -c "rm a.txt && curl https://x.org/y"'), ['deleted', 'network']);
assert.deepEqual(kinds("sh -lc 'git push origin main'"), ['pushed']);
assert.deepEqual(kinds('sudo -u me env FOO=1 nohup rm x'), ['deleted']);
assert.deepEqual(kinds('timeout 30 git push'), ['pushed']);
assert.deepEqual(classifyStep('bash', { command: 'cd sub && rm x' }, { cwd: P }).changed[0].path, `${P}/sub/x`, 'a cd is followed');
// ---- the everyday commands that must not count (LESSONS)
for (const c of ['pip list', 'pip show pandas', 'npm run build', 'npm test', 'git status', 'git log --grep push', 'git commit -m "remove old files and push"', 'echo "rm -rf build"', '# git push later', 'cat INSTALL.md', 'ls removed/', 'grep -r upload src', 'python check_push.py', 'git diff', 'pytest -q', 'echo see https://example.com', 'git commit -m "see https://x.org"', 'ls > /dev/null 2>&1', 'node build.js 2>&1', 'cat <<EOF\nrm -rf /\ngit push\nEOF', 'docker images', 'command -v rm'])
  assert.deepEqual(kinds(c), [], `not an event: ${c.replace(/\n/g, ' ')}`);
// steps
assert.equal(classifyStep('bash', { command: 'npm test' }, { cwd: P }).step, 'test');
assert.equal(classifyStep('bash', { command: 'python -m pytest tests' }, { cwd: P }).step, 'test');
assert.equal(classifyStep('bash', { command: 'cargo build --release' }, { cwd: P }).step, 'build');
assert.equal(classifyStep('bash', { command: 'git add . && git commit -m x' }, { cwd: P }).step, 'commit');
assert.equal(classifyStep('read', { path: 'a.md' }, { cwd: P }).step, 'read');
assert.equal(classifyStep('grep', { pattern: 'x' }, { cwd: P }).step, 'searched');
assert.deepEqual(classifyStep('web_fetch', { url: 'https://docs.example.org/a' }, { cwd: P }).events, [{ kind: 'network', names: ['docs.example.org'], how: 'tool' }], 'an extension tool that goes online');
// the owner's own programs
assert.deepEqual(classifyStep('bash', { command: 'pdm add rich' }, { cwd: P, extra: { installs: ['pdm add'] } }).events.map((e) => [e.kind, e.names]), [['install', ['rich']]]);
assert.deepEqual(classifyStep('bash', { command: 'deploy.sh prod' }, { cwd: P, extra: { pushes: ['deploy.sh'] } }).events.map((e) => e.kind), ['pushed']);
assert.deepEqual(classifyStep('bash', { command: 'mytool sync' }, { cwd: P, extra: { network: ['mytool sync'] } }).events.map((e) => e.kind), ['network']);
assert.deepEqual(classifyStep('bash', { command: 'mytool build' }, { cwd: P, extra: { network: ['mytool sync'] } }).events, []);
// lexing: here-documents and comments are text
assert.deepEqual(lex('cat > a.py <<\'EOF\'\nimport os\nos.remove("x")\nEOF\necho done').map((c) => c.words.map((w) => w.t)), [['cat'], ['echo', 'done']]);

// ---- named by the task (feature 14's rule; a folder named covers what is inside it)
const task = 'Tidy the tests folder and fix report.md, then update the data loader';
assert.ok(namedBy([task], `${P}/report.md`, P));
assert.ok(namedBy([task], `${P}/tests/test_x.py`, P), 'inside a folder named as a folder');
assert.ok(namedBy([task], `${P}/src/data_loader.py`, P), 'every word of a two-word name');
assert.ok(!namedBy([task], `${P}/config.yaml`, P));
assert.ok(!namedBy(['fix the report'], `${P}/report.md`, P), 'one word without file words: not named (feature 14)');
assert.ok(namedBy(['read the report'], `${P}/report.md`, P));
assert.ok(namedBy(['', 'Edit src/app/main.py to add a flag'], `${P}/src/app/main.py`, P), 'the prompt he approved counts too');
assert.ok(!namedBy([task], '/Users/x/.zshrc', P), 'outside the project');

// ---- the watcher and its digest: never a command, its output or a file's text
{
  let t = 0;
  const w = createWatch({ task: 'Write the report from results.csv', prompt: 'Write report.md from results.csv. Use pandas.', project: P, mode: 'edit', now: () => t, exists: () => false });
  const SECRET_CMD = 'python -c "print(42)" && pip install pandas zorblax-helper';
  assert.equal(w.pending(), false);
  w.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read', args: { path: 'results.csv' } });
  w.event({ type: 'tool_execution_end', toolCallId: 'a', toolName: 'read', result: { content: [{ type: 'text', text: 'FILE-TEXT-QQQ' }] }, isError: false });
  const u = w.event({ type: 'tool_execution_start', toolCallId: 'b', toolName: 'bash', args: { command: SECRET_CMD } });
  assert.equal(u.urgent, true, 'an install is urgent');
  w.event({ type: 'tool_execution_end', toolCallId: 'b', toolName: 'bash', result: { content: [{ type: 'text', text: 'OUTPUT-ZZZ Successfully installed' }] }, isError: false });
  w.event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'I ran `pip install pandas` and read /Users/x/proj/data/results.csv; see https://pandas.pydata.org for the docs. Next: the tables.' }] } });
  w.event({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'write', args: { path: 'report.md', content: 'BODY-TEXT-WWW' } });
  w.event({ type: 'tool_execution_end', toolCallId: 'c', toolName: 'write', isError: false });
  w.event({ type: 'tool_execution_start', toolCallId: 'd', toolName: 'edit', args: { path: 'config.yaml', edits: [{ oldText: 'OLD-TEXT-VVV', newText: 'x' }] } });
  w.event({ type: 'tool_execution_end', toolCallId: 'd', toolName: 'edit', isError: false });
  t = 3 * 60_000;
  assert.equal(w.pending(), true);
  const d = w.digest();
  const text = digestText(d, { userName: 'Office' });
  for (const bad of ['python -c', 'print(42)', 'FILE-TEXT-QQQ', 'OUTPUT-ZZZ', 'BODY-TEXT-WWW', 'OLD-TEXT-VVV', 'https://', '/Users/x', '`'])
    assert.ok(!text.includes(bad) && !JSON.stringify(d).includes(bad), `the digest holds no ${bad}`);
  assert.deepEqual(d.since, { read: 1, searched: 0, changed: 1, created: 1, command: 0, install: 1, test: 0, testFailed: 0, build: 0, commit: 0, errors: 0, retries: 0, tidied: 0 });
  assert.deepEqual(d.toTell.map((e) => [e.kind, e.names, e.status]), [['install', ['pandas', 'zorblax-helper'], 'ok'], ['unnamed', ['config.yaml'], 'ok']], 'report.md was named; config.yaml was not');
  assert.equal(d.statements.length, 1);
  assert.match(d.statements[0], /^I ran and read results\.csv; see for the docs\. Next: the tables\.$/);
  assert.match(text, /^Task, in Office's words: "Write the report from results\.csv"\nAllowed to: change files and run commands\. Time so far: 3 minutes\.\nSince the last update: 1 file read, 1 file changed, 1 file created, 1 install\.\nIn all: /);
  assert.match(text, /Must be mentioned:\n- installed pandas and zorblax-helper\n- changed config\.yaml, which the task didn't name/);
  // the checks: the owner's reference sentence passes; the unnamed file is added by code
  const ok = compose(d, 'The report is taking shape, and I\'ve had to install two packages.', { pairs: w.words().pairs });
  assert.equal(ok.how, 'worded');
  assert.equal(ok.text, 'The report is taking shape, and I\'ve had to install two packages. I\'ve also changed config.yaml, which you didn\'t name.');
  assert.equal(ok.added, 1);
  w.given(d, ok.text);
  assert.equal(w.pending(), false, 'nothing new since');
  assert.deepEqual(w.digest().toTell, [], 'told events are not told again');
  w.event({ type: 'tool_execution_start', toolCallId: 'e', toolName: 'bash', args: { command: 'npm test' } });
  w.event({ type: 'tool_execution_end', toolCallId: 'e', toolName: 'bash', isError: true });
  assert.equal(w.pending(), true);
  const d2 = w.digest();
  assert.deepEqual([d2.since.test, d2.since.testFailed, d2.since.install, d2.totals.install], [1, 1, 0, 1], 'counts start again after an update');
  assert.equal(d2.lastSaid, ok.text);
  // the closing summary: every event again, pi's last reply cleaned, its question
  w.event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Done. I used a bar chart rather than a table. Shall I `git push` it?' }] } });
  const f = w.digest({ status: 'done', reply: 'Done. I used a bar chart rather than a table. Shall I `git push` it?' });
  assert.equal(f.final, true); assert.equal(f.asks, true);
  assert.deepEqual(f.toTell.map((e) => e.kind), ['install', 'unnamed'], 'all events, told or not');
  assert.equal(f.reply, 'Done. I used a bar chart rather than a table. Shall I it?');
  assert.ok(!digestText(f).includes('git push'));
  // the snapshot comparison adds what commands didn't show
  w.compare([{ status: 'D', path: 'old/notes.txt' }, { status: 'M', path: 'report.md' }, { status: 'A', path: 'scripts/gen.py' }, { status: 'R', from: 'a.csv', path: 'data/a.csv' }]);
  assert.deepEqual(w.digest({ status: 'done', reply: '' }).toTell.map((e) => [e.kind, e.names, e.how]), [['install', ['pandas', 'zorblax-helper'], ''], ['unnamed', ['config.yaml'], 'changed'], ['removed', ['notes.txt'], 'deleted'], ['unnamed', ['gen.py'], 'changed'], ['removed', ['a.csv'], 'moved']]);
}
// a project inside the temporary folder: its files still count; temporary files elsewhere and .git don't
{
  const proj = `${os.tmpdir()}/proj-x`;
  const w = createWatch({ task: 'tidy up', project: proj, mode: 'edit' });
  w.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'bash', args: { command: `rm old.csv ${os.tmpdir()}/scratch-1 .git/index.lock` } });
  assert.deepEqual(w.digest().toTell.map((e) => [e.kind, e.names]), [['removed', ['old.csv']]]);
}
// a failed push and a running install
{
  const w = createWatch({ task: 'ship it', project: P, mode: 'edit' });
  w.event({ type: 'tool_execution_start', toolCallId: 'p', toolName: 'bash', args: { command: 'git push origin main' } });
  assert.equal(w.running(), true);
  const r = w.event({ type: 'tool_execution_end', toolCallId: 'p', toolName: 'bash', isError: true });
  assert.deepEqual([r.ended, r.running], [true, false]);
  w.event({ type: 'tool_execution_start', toolCallId: 'q', toolName: 'bash', args: { command: 'pip install torch' } });
  const d = w.digest();
  assert.deepEqual(codeLines(d.toTell), ['I\'m installing torch.', 'I tried to push the main branch to origin; it failed.']);
  assert.deepEqual(codeLines(d.toTell, '', { own: false }), ['Pi is installing torch.', 'Pi tried to push the main branch to origin; it failed.']);
}

// ---- cleaning pi's words
assert.equal(cleanSaid('Run ```sh\nrm -rf x\n``` then `ls`.\n$ npm test\n> output line\nAll good.'), 'Run then . All good.');
assert.equal(cleanSaid('Edited src/app/main.py and ~/notes/todo.md with --force.'), 'Edited main.py and todo.md with .');
assert.equal(cleanSaid('token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here'), 'token here');
assert.equal(cleanSaid('I will run npm install lodash now', commandWords('npm install lodash').triples), 'I will run now', 'three words of a command go');
assert.equal(cleanSaid('the work goes on '.repeat(10), new Set(), 60), 'the work goes on the work goes on the work goes on the work…');

// ---- the checks
const D = (o = {}) => ({ final: false, toTell: [], everKinds: [], ...o });
const ev = (kind, names, o = {}) => ({ id: Math.random(), kind, names, how: kind === 'removed' ? 'deleted' : '', status: 'ok', count: 1, ...o });
const pairs = commandWords('npm install pandas && git push origin main && rm -rf build').pairs;
assert.equal(checkSentence('The report is taking shape.', D(), { pairs }).ok, true);
assert.equal(checkSentence('Update: "The report is taking shape."', D()).text, 'The report is taking shape.');
for (const [bad, why] of [['I ran `ls`.', 'command'], ['Running npm install now.', 'command'], ['I edited src/main.py.', 'command'], ['See https://x.org.', 'command'], ['With --force it works.', 'command'], ['It ran git push origin.', 'command'], ['x'.repeat(230), 'long']])
  assert.equal(checkSentence(bad, D({ everKinds: ['install', 'pushed'] }), { pairs }).why, why, bad);
assert.deepEqual(checkSentence('One. Two. Three.', D()), { text: 'One. Two.', ok: true, why: '', cut: true }, 'cut to two sentences');
assert.equal(checkSentence('One. Two. Three. Four.', D({ final: true })).text, 'One. Two. Three.', 'three for the closing summary');
assert.equal(checkSentence('I\'ve pushed the work.', D()).why, 'claim', 'a push that did not happen');
assert.equal(checkSentence('I\'ve installed pandas.', D()).why, 'claim');
assert.equal(checkSentence('Nothing needed installing, and nothing went online.', D()).ok, true, 'negated: no claim');
assert.equal(checkSentence('I\'m pushing ahead with the charts.', D()).ok, true, '"pushing ahead" is not a push');
assert.equal(checkSentence('The work has moved on to the charts.', D()).ok, true);
// mentions, and code's line for each one missing
assert.equal(mentions('install', 'I had to install one package.'), true);
assert.equal(mentions('install', 'I added two packages.'), true);
assert.equal(mentions('install', "I didn't need to install anything."), false, 'negated');
assert.equal(mentions('install', 'The library code is clearer now.'), false, 'library alone is no mention');
assert.equal(mentions('removed', 'I deleted the old file.'), true);
assert.equal(mentions('removed', 'Moving on to the charts.'), false);
assert.equal(mentions('network', 'I fetched the data online.'), true);
assert.equal(mentions('pushed', 'It is pushed.'), true);
assert.equal(mentions('unnamed', 'I also touched a file you didn\'t name.', ['config.yaml']), true);
assert.equal(mentions('unnamed', 'I also tidied config.', ['config.yaml']), true, 'its name without the extension');
assert.equal(mentions('unnamed', 'All good.', ['config.yaml']), false);
const all = [ev('install', ['pandas', 'numpy']), ev('removed', ['old.csv']), ev('unnamed', ['config.yaml']), ev('network', ['github.com']), ev('pushed', ['the main branch to origin'])];
assert.deepEqual(codeLines(all), ['I\'ve installed 2 packages: pandas and numpy.', 'I\'ve deleted old.csv.', 'I\'ve also changed config.yaml, which you didn\'t name.', 'One command went online, to github.com.', 'I\'ve pushed the main branch to origin.']);
assert.deepEqual(codeLines(all, 'I had to install two packages and push the branch.'), ['I\'ve deleted old.csv.', 'I\'ve also changed config.yaml, which you didn\'t name.', 'One command went online, to github.com.']);
assert.deepEqual(codeLines(all, "I didn't need to install anything."), codeLines(all), 'a negated mention gets the line');
assert.deepEqual(codeLines([ev('network', [], { count: 3 })], '', { own: false }), ['3 of pi\'s commands went online.']);
assert.deepEqual(codeLines([ev('install', ["the project's dependencies"])]), ["I've installed the project's dependencies."]);
assert.deepEqual(codeLines([ev('unnamed', ['a.py', 'b.py', 'c.py', 'd.py', 'e.py'])]), ['I\'ve also changed a.py, b.py, c.py and 2 more, which you didn\'t name.']);
// what is said: worded, fallback, plain
const d = D({ toTell: [all[0]], everKinds: ['install'] });
assert.deepEqual(compose(d, 'Coming along nicely.'), { text: 'Coming along nicely. I\'ve installed 2 packages: pandas and numpy.', how: 'worded', why: '', cut: false, added: 1 });
assert.equal(compose(d, 'I ran `pip install`.').text, 'I\'m still working on it. I\'ve installed 2 packages: pandas and numpy.');
assert.equal(compose(d, null).how, 'fallback');
assert.deepEqual(compose(d, 'anything', { plain: true, own: false }), { text: 'Pi\'s still working on it. Pi has installed 2 packages: pandas and numpy.', how: 'plain', why: 'plain', cut: false, added: 1 });
assert.equal(fallbackSentence({ final: true, status: 'done', asks: true }), 'That\'s done; the full reply is on screen. There\'s a question for you on screen.');
assert.equal(fallbackSentence({ final: true, status: 'error' }, { own: false }), 'Pi ran into a problem; the details are on screen.');
// the instructions
const up = updatePrompt({ persona: { name: 'Jarvis', manner: 'calm "and" precise', humour: 'dry' }, userName: 'Office' });
assert.match(up, /^You are Jarvis, Office's assistant\. Your manner, in Office's words: "calm and precise"\./);
assert.match(up, /one sentence, two at most/); assert.match(up, /The report is taking shape, and I've had to install one package\./); assert.match(up, /Never write a command/);
assert.match(updatePrompt({ final: true, own: false, userName: 'Office' }), /up to three short spoken sentences, in this order: the outcome; the decisions made, only as pi states them; what Office has to do next/);

// ---- when updates are given (a fake clock)
{
  let t = 0; const timers = new Map(); let id = 0;
  const setTimer = (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; };
  const clearTimer = (i) => timers.delete(i);
  const advance = (ms) => { const end = t + ms; for (;;) { const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; t = next[1].at; timers.delete(next[0]); next[1].fn(); } t = end; };
  const fired = [];
  const s = createSchedule({ seconds: 90, due: () => fired.push(t), setTimer, clearTimer });
  advance(89_000); assert.deepEqual(fired, []);
  advance(1000); assert.deepEqual(fired, [90_000], 'a tick every 90 s');
  advance(10_000); s.urgent(); advance(URGENT_SECONDS * 1000 - 1); assert.equal(fired.length, 1);
  advance(1); assert.deepEqual(fired, [90_000, 120_000], 'an urgent event: within 20 s');
  advance(89_999); assert.equal(fired.length, 2, 'the next tick counts from the urgent update'); advance(1); assert.equal(fired.length, 3);
  s.urgent(); advance(1000); s.settled(); advance(2000); assert.equal(fired.at(-1), 213_000, 'the commands ended: two seconds later');
  s.urgent(); s.urgent(); advance(20_000); assert.equal(fired.length, 5, 'one update for several urgent events');
  s.stop(); advance(1_000_000); assert.equal(fired.length, 5, 'nothing after the finish');
  const none = []; const z = createSchedule({ seconds: 0, due: () => none.push(t), setTimer, clearTimer }); z.urgent(); advance(1_000_000); assert.deepEqual(none, [], 'progressSeconds 0: no updates');
}
console.log('pi\'s updates in plain words tests passed');
