// Local-only build, feature 14: Roamies reads files at the owner's request (files.mjs), in a throwaway home: where it
// may read and what is refused, links and hard links, parts, the caps, names, search in code, the contents rule with
// "ask" and "free", the request's own words, the ledger's count, and that nothing is written or started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILE_TOOLS, createFiles, namedIn } from '../files.mjs';
import { loadSettings, settingsDefaults } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'files-home-')));
const put = (rel, text) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
loadSettings(home);
const settingsFile = path.join(home, 'Documents', 'roamies-pi', 'settings.json');
function settings(o = {}, limits = {}) {
  const d = settingsDefaults(home);
  fs.writeFileSync(settingsFile, JSON.stringify({ ...d, project: '~/Projects/thesis', projects: ['~/Projects/thesis', '~/Projects/other'], readOnly: ['~/Data', '~/Documents/roamies-vault', '~/Documents/roamies-pi'], ...o, limits: { ...d.limits, ...limits } }, null, 2));
}
settings();
put('Projects/thesis/segment.py', 'def segment(image):\n    threshold = 0.6\n    return image > threshold\n');
put('Projects/thesis/README.md', '# Thesis\nThe threshold is set in segment.py.\n');
put('Projects/thesis/src/dataLoader.py', 'def load(path):\n    # threshold not used here\n    return open(path).read()\n');
put('Projects/thesis/.env', 'TOKEN=abc threshold\n');
put('Projects/thesis/node_modules/x/match.js', '// threshold\n');
put('Projects/thesis/big.log', Array.from({ length: 400 }, (_, i) => `line ${String(i).padStart(3, '0')} é`).join('\n'));
fs.writeFileSync(path.join(home, 'Projects/thesis/image.bin'), Buffer.from([1, 2, 0, 3, 4]));
put('Secret/plan.txt', 'outside threshold\n');
fs.symlinkSync(path.join(home, 'Secret/plan.txt'), path.join(home, 'Projects/thesis/link-out'));
put('.ssh/id_test', 'KEY\n');
fs.symlinkSync(path.join(home, '.ssh'), path.join(home, 'Projects/thesis/ssh-link'));
put('Secret/h.txt', 'hard\n');
fs.linkSync(path.join(home, 'Secret/h.txt'), path.join(home, 'Projects/thesis/hard.txt'));
put('Projects/other/notes.txt', 'other project threshold\n');
put('Data/results.csv', 'a,b\n1,2\n');
put('Documents/roamies-vault/Lab plan.md', 'threshold 0.6\n');
put('Documents/roamies-pi/pending.txt', 'a prompt\n');
put('Documents/roamies-pi/workspace/scratch.txt', 'workspace text\n');

let words = '', turnNo = 1;
const asked = [], logs = [], counts = [];
let answer = null;
const files = createFiles({ home, userName: 'Tiago', heard: () => words, turn: () => turnNo, ask: async (o) => { asked.push(o); if (answer instanceof Error) throw answer; return answer; }, counted: (k, c) => counts.push([k, c]), log: (k, d) => logs.push([k, d]) });
const tool = (n) => files.tools.find((t) => t.name === n);
const run = (n, a, ctx) => tool(n).execute(a, ctx);
const fails = async (p, re) => { await assert.rejects(p, re); };
const turn = (w) => { words = w; turnNo++; asked.length = 0; };

assert.deepEqual(files.tools.map((t) => t.name), FILE_TOOLS);
assert.deepEqual(FILE_TOOLS, ['read_file', 'list_files', 'find_files', 'search_files']);

// ---- "names the file": his words, judged by code
assert.ok(namedIn('Read segment.py', 'segment.py') && namedIn('read segment dot py', 'segment.py') && namedIn('what does the segment file do', 'segment.py'));
assert.ok(namedIn('look at the data loader', 'dataLoader.py') && namedIn('the final report please', 'final_report.md') && namedIn('read the README', 'README.md'));
// A name of one word, without its extension, only in a sentence plainly about a file (the owner, 2026-11-27).
assert.ok(!namedIn("what's the plan for today?", 'plan.md') && namedIn('read the plan', 'plan.md') && namedIn('plan dot md', 'plan.md') && namedIn('what is in plan.md', 'plan.md'));
assert.ok(!namedIn('what does segment do', 'segment.py') && !namedIn('the README', 'README.md') && namedIn('what does segment.py do', 'segment.py'));
for (const w of ['file', 'read', 'open', 'show', 'look at', 'look in', 'check']) assert.ok(namedIn(`${w} the plan`, 'plan.md'), w);
assert.ok(!namedIn('look the plan over', 'plan.md') && !namedIn('the plan reads well', 'plan.md'), 'whole words and phrases only');
assert.ok(namedIn('what does the final report say', 'final_report.md'), 'two words stay as they were');
assert.ok(!namedIn('add milk to groceries', 'Groceries', { ext: false }) && namedIn('add milk to my groceries note', 'Groceries', { ext: false }) && namedIn('add milk to groceries dot md', 'Groceries', { ext: false }));
assert.ok(!namedIn('the report', 'final_report.md') && !namedIn('what does the loader do', 'dataLoader.py') && !namedIn('', 'segment.py'));
assert.ok(namedIn('open the 2026 budget', 'budget-2026.xlsx') && !namedIn('the budget', 'budget-2026.xlsx'));
assert.ok(namedIn('change Lab plan', 'Lab plan', { ext: false }) && namedIn('fix the plan for the lab', 'Lab plan', { ext: false }) && !namedIn('change the plan', 'Lab plan', { ext: false }));
assert.ok(namedIn('the v2.1 notes', 'v2.1 notes', { ext: false }), 'a title keeps its dots');

// ---- only in a request he typed or spoke; off when "files" is false
turn('');
for (const [n, a] of [['read_file', { path: 'segment.py' }], ['list_files', {}], ['find_files', { name: 'seg' }], ['search_files', { text: 'threshold' }]]) await fails(run(n, a), /only in a request they typed or spoke; this one came from the app, so nothing was read/);
settings({ files: false });
turn('read segment.py');
await fails(run('read_file', { path: 'segment.py' }), /File reading is off \("files" is false in settings\.json\), so nothing was read\./);
settings();

// ---- reading: named in his words, no bubble; the ledger's count
counts.length = 0;
let out = await run('read_file', { path: 'segment.py' });
assert.equal(out, '~/Projects/thesis/segment.py (69 bytes):\n\ndef segment(image):\n    threshold = 0.6\n    return image > threshold\n\n\n[End of the file.]');
assert.equal(asked.length, 0); assert.deepEqual(counts, [['file', 69]]);
// by name alone, found in the folders; by ~ path; in readOnly
turn('read the results csv'); assert.match(await run('read_file', { path: 'results.csv' }), /^~\/Data\/results\.csv \(8 bytes\)/); assert.equal(asked.length, 0);
turn('read segment'); assert.match(await run('read_file', { path: 'segment' }), /^~\/Projects\/thesis\/segment\.py/, 'a name without its extension');
turn('read notes.txt'); assert.match(await run('read_file', { path: '~/Projects/other/notes.txt' }), /other project threshold/);

// ---- "ask": a file his words don't name needs his yes to a bubble naming exactly it
turn('what does the loader do?');
answer = null;
out = await run('read_file', { path: 'src/dataLoader.py' });
assert.equal(out, 'Tiago didn\'t say yes, so dataLoader.py wasn\'t read. Don\'t ask for it again in this request.');
assert.deepEqual(asked.map((a) => [a.placeholder, a.spoken, a.choices]), [['Read this file?\n- ~/Projects/thesis/src/dataLoader.py', 'Read dataLoader.py?', ['Read it', 'Don\'t']]]);
await fails(run('read_file', { path: 'src/dataLoader.py' }), /already said no to reading dataLoader\.py in this request/);
assert.equal(asked.length, 1, 'not asked again after a no in the same request');
turn('what does the loader do?'); answer = new Error('gone'); answer.name = 'Unanswered';
assert.match(await run('read_file', { path: 'src/dataLoader.py' }), /didn't say yes/, 'no answer reads nothing');
turn('what does the loader do?'); answer = 'yes';
assert.match(await run('read_file', { path: 'src/dataLoader.py' }), /^~\/Projects\/thesis\/src\/dataLoader\.py/);
assert.equal(asked.length, 1);
// a file's text never widens it: the README names segment.py, but only his words count
turn('read the readme'); answer = null;
assert.match(await run('read_file', { path: 'README.md' }), /^~\/Projects\/thesis\/README\.md/); assert.equal(asked.length, 0);
assert.match(await run('read_file', { path: 'segment.py' }), /didn't say yes/); assert.equal(asked.length, 1, 'segment.py, named only in the README, needs a yes');
// "free": no bubble
settings({ fileContents: 'free' });
turn('what does the loader do?'); answer = null;
assert.match(await run('read_file', { path: 'src/dataLoader.py' }), /^~\/Projects\/thesis\/src\/dataLoader\.py/); assert.equal(asked.length, 0);
settings();

// ---- refused, whatever his words say
turn('read it please'); answer = 'yes';
const refused = [
  ['~/Secret/plan.txt', /isn't in Tiago's project folders/],
  ['link-out', /isn't in Tiago's project folders/],
  ['ssh-link/id_test', /blocked list|isn't in Tiago's project folders|passwords or keys/],
  ['.env', /holds passwords or keys/],
  ['hard.txt', /more than one name \(a hard link\)/],
  ['image.bin', /isn't a text file/],
  ['~/Documents/roamies-vault/Lab plan.md', /in the notes vault/],
  ['~/Documents/roamies-pi/settings.json', /sandbox's blocked list/],
  ['~/Documents/roamies-pi/pending.txt', /one of Roamies' own files/],
  ['nothing-here.txt', /There's no file called "nothing-here\.txt"/],
];
for (const [p, re] of refused) await fails(run('read_file', { path: p }), re);
assert.equal(asked.length, 0, 'a refusal never asks');
assert.match(await run('read_file', { path: '~/Documents/roamies-pi/workspace/scratch.txt' }), /workspace text/, 'pi\'s workspace is a project like any other');

// ---- parts, and the local route's smaller part
settings({}, { fileReadChars: 1000, localFileChars: 1000 });
turn('read big.log');
out = await run('read_file', { path: 'big.log' });
const next = Number(/read_file with from (\d+) gives the next part/.exec(out)[1]);
assert.ok(out.includes('line 000 é') && !out.includes('line 399'));
const part2 = await run('read_file', { path: 'big.log', from: next });
assert.match(part2, new RegExp(`^~/Projects/thesis/big\\.log \\(\\d+ bytes, from ${next}\\)`));
assert.ok(!part2.includes('line 000'));
const odd = await run('read_file', { path: 'big.log', from: next - 1 }); // inside "é": starts at the next character
assert.ok(!odd.includes('\uFFFD'));
settings({}, { fileReadChars: 20_000, localFileChars: 1000 });
turn('read big.log');
const local = await run('read_file', { path: 'big.log' }, { local: true });
assert.ok(local.split('\n\n')[1].length <= 1000 && /bytes more/.test(local), 'the local route gets limits.localFileChars');
// the local route's own words, request mark and count
const own = [];
assert.match(await run('read_file', { path: 'segment.py' }, { heard: 'read segment.py', turn: 'local-1', count: (k, c) => own.push([k, c]), local: true }), /threshold/);
assert.deepEqual(own, [['file', 69]]);

// ---- at most limits.filesPerRequest reads in one request
settings({}, { filesPerRequest: 2 });
turn('read segment.py');
await run('read_file', { path: 'segment.py' }); await run('read_file', { path: 'segment.py' });
await fails(run('read_file', { path: 'segment.py' }), /That is 2 reads in one request \(limits\.filesPerRequest\)/);
turn('read segment.py'); assert.match(await run('read_file', { path: 'segment.py' }), /threshold/, 'a new request starts again');
settings();

// ---- names: list and find, in any request he made
turn('what is in my thesis project?');
out = await run('list_files', {});
assert.equal(out, '~/Projects/thesis:\nbig.log\nhard.txt\nimage.bin\nlink-out (a link, not followed)\nnode_modules/\nREADME.md\nsegment.py\nsrc/\nssh-link (a link, not followed)\n(1 entry left out: blocked.)');
assert.match(await run('list_files', { dir: 'src' }), /^~\/Projects\/thesis\/src:\ndataLoader\.py$/);
await fails(run('list_files', { dir: '~/Secret' }), /I can't look in ~\/Secret: it isn't in Tiago's project folders/);
await fails(run('list_files', { dir: '~/Documents/roamies-vault' }), /in the notes vault/);
assert.equal(await run('find_files', { name: 'loader' }), '~/Projects/thesis/src/dataLoader.py');
assert.equal(await run('find_files', { name: '*.csv' }), '~/Data/results.csv');
assert.equal(await run('find_files', { name: 'match' }), 'No file with "match" in its name in Tiago\'s project folders.', 'node_modules is skipped');
assert.match(await run('find_files', { name: 'plan' }), /^No file/, 'never through a link, never the vault');
assert.equal(asked.length, 0, 'names never ask');

// ---- search: in code, the lines his words name sent at once, the rest only on his yes
turn('where is the threshold in segment.py?'); answer = null;
out = await run('search_files', { text: 'THRESHOLD' });
assert.deepEqual(asked.map((a) => a.placeholder), ['Send the matching lines from these 2 files?\n- ~/Projects/thesis/README.md\n- ~/Projects/thesis/src/dataLoader.py']);
assert.equal(out, '~/Projects/thesis/segment.py:2: threshold = 0.6\n~/Projects/thesis/segment.py:3: return image > threshold\n(Tiago didn\'t say yes to the lines from the other files, so they weren\'t sent.)');
assert.ok(!out.includes('.env') && !out.includes('match.js') && !out.includes('plan.txt'));
turn('search my project for threshold'); answer = null;
out = await run('search_files', { text: 'threshold' });
assert.equal(out, 'Tiago didn\'t say yes, so nothing from the search was sent. Don\'t search for it again in this request.');
assert.ok(!/README|dataLoader|segment/.test(out), 'with no yes, not even the names');
turn('search my project for threshold'); answer = 'yes';
out = await run('search_files', { text: 'threshold' });
assert.equal(out.split('\n').length, 4);
settings({ fileContents: 'free' });
turn('search my project for threshold'); answer = null;
assert.equal((await run('search_files', { text: 'threshold' })).split('\n').length, 4); assert.equal(asked.length, 0);
settings();
assert.match(await run('search_files', { text: 'nowhere to be found' }), /^No file in ~\/Projects\/thesis has "nowhere to be found"\.$/);

// ---- the activity log: tool and sizes only; never a path, a name or any text
const logged = JSON.stringify(logs);
for (const w of ['segment', 'thesis', 'threshold', 'dataLoader', home, 'README', 'results']) assert.ok(!logged.includes(w), `the log has no "${w}"`);
assert.ok(logs.some(([k, d]) => k === 'file_tool' && d.tool === 'read_file' && d.chars > 0));

// ---- nothing is written or started here
const src = fs.readFileSync(new URL('../files.mjs', import.meta.url), 'utf8');
assert.ok(!/child_process|spawn|exec\(/.test(src), 'no program is started');
assert.ok(!/writeFile|appendFile|unlink|rename|mkdir|rmSync|rmdir|symlink|copyFile|truncate|O_WRONLY|O_RDWR|O_CREAT|'w'|"w"/.test(src), 'nothing is written');
assert.ok(src.includes("from './safety.mjs'") && src.includes('checkRead(p, realHome())'), 'every path goes through safety.mjs');
assert.ok(src.includes('blockedPaths(home, s.dir)'), 'the sandbox\'s blocked list, the same one');

// ---- sidekick.mjs: the tools are given, after the app's, only with his words in that request
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /ownWords = briefing \|\| text\.startsWith\('\('\) \? '' : text; ownTurn\+\+;/, 'a briefing or a system note is never his words');
assert.match(side, /createFiles\(\{ home: HOME, userName, heard: \(\) => ownWords, turn: \(\) => ownTurn, ask: \(o\) => answers\.ask\(o\), counted: \(kind, chars\) => countText\(kind, chars\)/);
assert.match(side, /\.\.\.notes\.tools, \.\.\.files\.tools, \.\.\.cal\.tools/);
assert.match(side, /\.\.\.countTools\(u\.names\), \.\.\.\(l\.texts \?\? \{\}\)(?:, swaps: [^}]*)? \}\);/, 'the request\'s file and note texts in its ledger line (and feature 34\'s swaps)');
const pi = fs.readFileSync(new URL('../pi.mjs', import.meta.url), 'utf8');
const during = /const DURING = new Set\(\[([^\]]*)\]\)/.exec(pi)[1];
for (const n of FILE_TOOLS) assert.ok(!during.includes(`'${n}'`), `${n} is refused while pi works`);
console.log('file tools tests passed');
