// Feature 40, find a file anywhere and show its folder (findany.mjs): the sentence, what is left out, the ranking, the
// pick, what is said, and the search with a stand-in for the hands helper. The real helper's Spotlight query is
// checked by `roamies-hands --self-test`; the sidecar run by findany-run.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NOT_MAC, NO_HELPER, createFind, findAsk, fits, folderShown, foundLine, leftOut, nothingLine, pickRow, rank, tier } from '../findany.mjs';
import { LIMITS, blockedPaths, loadSettings } from '../pi.mjs';

// ---- 1. the sentence: a search only for a name that looks like a file or a folder; else the usual way
const ask = (t) => findAsk(t, { persona: 'Jarvis' });
const words = (t) => ask(t)?.words ?? null;
// "where is …": an extension or a type word makes it a file search
assert.deepEqual(words('Where is budget.xlsx?'), ['budget']); assert.equal(ask('Where is budget.xlsx?').ext, 'xlsx');
assert.deepEqual(words('where is budget dot xlsx'), ['budget']); assert.equal(ask('where is budget dot xlsx').ext, 'xlsx');
assert.deepEqual(words('Where is the config file for the pipeline?'), ['config', 'pipeline']);
assert.deepEqual(words('Where did I put the grant PDF?'), ['grant']); assert.deepEqual(ask('Where did I put the grant PDF?').filter.exts, ['pdf']);
assert.deepEqual(words("Where's my thesis folder?"), ['thesis']); assert.equal(ask("Where's my thesis folder?").filter.folders, true);
assert.deepEqual(words("Where is Mike's thesis document?"), ['mike', 'thesis']);
assert.deepEqual(words('where can I find the slides for the retreat'), ['retreat']);
// …and nothing else does: these go the usual way (the owner, 2026-11-27)
for (const t of ['Where is my lab meeting?', 'Where are my photos?', 'Where is the presentation?', 'Where is Anna today?', 'Where is the file?', 'where is it', 'Where is the meeting room?', 'where were we'])
  assert.equal(ask(t), null, t);
// "find the file …" always is (a type word or an extension in it); "find my keys" isn't
assert.deepEqual(words('Find the file budget'), ['budget']); assert.equal(ask('Find the file budget').filter.files, true);
assert.deepEqual(words('Jarvis, can you find me the thesis folder, please?'), ['thesis']);
assert.deepEqual(words('find budget.xlsx'), ['budget']);
assert.deepEqual(words('find the budget spreadsheet'), ['budget']); assert.ok(ask('find the budget spreadsheet').filter.exts.includes('numbers'));
for (const t of ['find my keys', 'find a time for the lab meeting', 'Find out when the seminar is']) assert.equal(ask(t), null, t);
// "which folder is … in?" always is
assert.deepEqual(words('Which folder is the poster in?'), ['poster']);
assert.deepEqual(words('what folder has the v1.2 data?'), ['v', '1', '2', 'data']); assert.deepEqual(ask('what folder has the v1.2 data?').spot, ['v1', '2', 'data']);
assert.deepEqual(words('In which folder is my CV?'), ['cv']);
// no name: still decided by code (nothing to the model), which asks for the name with the request
assert.deepEqual(words('find the file'), []); assert.deepEqual(words('which folder is it in?'), []);
// accents and case are Spotlight's to ignore; a version number isn't an extension
assert.deepEqual(ask('find the café menu PDF').spot, ['cafe', 'menu']); assert.equal(ask('Which folder is v1.2 in?').ext, '');
// the switch: off, the sentence goes the usual way
{
  const s = { ...loadSettings(fs.mkdtempSync(path.join(os.tmpdir(), 'findany-home-'))), findAnywhere: false };
  assert.equal(createFind({ settings: () => s }).ask('Where is budget.xlsx?'), null);
  assert.ok(createFind({ settings: () => ({ ...s, findAnywhere: true }) }).ask('Where is budget.xlsx?'));
}

// ---- 2. what is never shown
const H = '/Users/t';
const ctx = { home: H, drives: [{ path: '/Volumes/Backup', name: 'Backup' }], blocked: blockedPaths(H, `${H}/Documents/roamies-pi`), own: [`${H}/Documents/roamies-pi`, `${H}/.gg`], vault: `${H}/Documents/roamies-vault`, leaveOut: [`${H}/Private`], projects: [`${H}/Projects/thesis`] };
const out = (p, kind = 'file', type = '') => leftOut({ path: p, kind, type }, ctx);
const cases = {
  '': [`${H}/Documents/Finance/budget.xlsx`, '/Volumes/Backup/Finance/budget.xlsx', `${H}/Desktop/Thesis`, `${H}/Documents/Library notes.pdf`],
  place: ['/System/budget.xlsx', '/Volumes/NetShare/budget.xlsx', '/tmp/budget.xlsx', H, '/Volumes/Backup'], // a network drive isn't in the drives list
  library: [`${H}/Library/Mobile Documents/com~apple~CloudDocs/budget.xlsx`, `${H}/Library/CloudStorage/Dropbox/budget.xlsx`, `${H}/Library`],
  hidden: [`${H}/.Trash/budget.xlsx`, `${H}/Projects/.cache/budget.xlsx`, '/Volumes/Backup/.Trashes/501/budget.xlsx'],
  package: [`${H}/Pictures/Old.photoslibrary/originals/budget.png`, `${H}/Documents/Talk.key/Data/budget.png`],
  backup: ['/Volumes/Backup/Backups.backupdb/Mac/2026-11-01/Users/t/budget.xlsx', '/Volumes/Backup/2026-11-01-120000.backup/Data/budget.xlsx'],
  skipped: [`${H}/Projects/app/node_modules/budget/index.js`, `${H}/Projects/x/venv/lib/budget.py`],
  blocked: [`${H}/Documents/roamies-pi/state.json`, `${H}/Documents/roamies-pi/settings.json`],
  own: [`${H}/Documents/roamies-pi/note-versions/budget.md`, `${H}/Documents/roamies-pi/pending.txt`],
  vault: [`${H}/Documents/roamies-vault/Budget.md`],
  yours: [`${H}/Private/budget.xlsx`],
  secret: [`${H}/Projects/app/prod.pem`, `${H}/Documents/server.key`, `${H}/Documents/id_rsa`, `${H}/Music/Music/budget.mp3`],
};
for (const [why, ps] of Object.entries(cases)) for (const p of ps) assert.equal(out(p), why, `${p}: ${why || 'shown'}`);
assert.equal(out(`${H}/Applications/Budget.app`, 'app'), 'app'); assert.equal(out(`${H}/Downloads/Budget.app`), 'app');
assert.equal(out(`${H}/Documents/Talk.key`, 'package', 'com.apple.iwork.keynote.key'), '', 'a Keynote presentation is not a key');
assert.equal(out(`${H}/Documents/talk.key`, 'file', 'com.apple.iwork.keynote.sffkey'), '', 'nor a single-file one');
assert.equal(out(`${H}/Pictures/Old.photoslibrary`, 'package'), '', 'a package itself can be listed');
// the sandbox's blocked list, all of it (the same list files.mjs and pi's profile use)
for (const [kind, b] of ctx.blocked) assert.notEqual(out(kind === 'literal' ? b : `${b}/x.txt`), '', `blocked: ${b}`);
assert.ok(ctx.blocked.some(([, b]) => b.endsWith('/.ssh')));

// ---- 3. the kind asked for
const q = (t) => ask(t);
assert.equal(fits({ path: '/a/Thesis', kind: 'folder' }, q("Where's my thesis folder?")), true);
assert.equal(fits({ path: '/a/thesis.pdf', kind: 'file' }, q("Where's my thesis folder?")), false);
assert.equal(fits({ path: '/a/Thesis', kind: 'folder' }, q('Find the file thesis')), false);
assert.equal(fits({ path: '/a/grant.pdf', kind: 'file' }, q('Where did I put the grant PDF?')), true);
assert.equal(fits({ path: '/a/grant.docx', kind: 'file' }, q('Where did I put the grant PDF?')), false);
assert.equal(fits({ path: '/a/budget.numbers', kind: 'package' }, q('Where is budget.xlsx?')), false);
assert.equal(fits({ path: '/a/Budget.XLSX', kind: 'file' }, q('Where is budget.xlsx?')), true);
assert.equal(fits({ path: '/a/Poster', kind: 'folder' }, q('Which folder is the poster in?')), true, 'which folder: files and folders');

// ---- 4. the ranking: how the name matches, then the last opened, the last changed, the fewest folders, a project
const bq = q('Where is the budget file?');
assert.deepEqual(['budget.xlsx', 'Budget', 'budget-2026.xlsx', 'old_budget.xlsx', 'budgeting.txt'].map((n) => tier(n, bq)), [1, 1, 2, 3, 4]);
assert.equal(tier('Config_Pipeline.yaml', q('Where is the config file for the pipeline?')), 1);
assert.equal(tier('pipeline_config.yaml', q('Where is the config file for the pipeline?')), 3);
assert.equal(tier('dataLoader.py', q('find the data loader script')), 1);
const items = [
  { path: `${H}/a/b/c/old_budget.xlsx`, changed: 5 },
  { path: `${H}/budget-2026.xlsx`, changed: 1 },
  { path: `${H}/Documents/budget.xlsx`, changed: 1, used: 10 },
  { path: `${H}/Desktop/budget.xlsx`, changed: 9 },
  { path: `${H}/x/y/budget.xlsx`, changed: 9 },
  { path: `${H}/Projects/thesis/deep/er/budget.csv`, changed: 9 },
  { path: `${H}/Other/x/deep/er/budget.csv`, changed: 9 },
];
assert.deepEqual(rank(items, bq, { projects: ctx.projects }).map((i) => i.path.slice(H.length)), [
  '/Documents/budget.xlsx', // opened last
  '/Desktop/budget.xlsx', '/x/y/budget.xlsx', // changed last, then fewer folders deep
  '/Projects/thesis/deep/er/budget.csv', '/Other/x/deep/er/budget.csv', // the same, a project folder first
  '/budget-2026.xlsx', // starts with it
  '/a/b/c/old_budget.xlsx', // a whole word of it
]);

// ---- 5. where it is, as the card shows it
assert.equal(folderShown(`${H}/Documents/Finance/budget.xlsx`, ctx), '~/Documents/Finance');
assert.equal(folderShown(`${H}/budget.xlsx`, ctx), '~');
assert.equal(folderShown('/Volumes/Backup/Finance/2026/budget.xlsx', ctx), 'Backup › Finance › 2026');
assert.equal(folderShown('/Volumes/Backup/budget.xlsx', ctx), 'Backup');

// ---- 6. the pick: a number, an ordinal, "the last one", its name; two that fit or none changes nothing
const rows = [{ name: 'budget-2026.xlsx' }, { name: 'budget.numbers' }, { name: 'Budget', folder: true }];
const pick = (t, r = rows) => pickRow(t, r, { persona: 'Jarvis' });
for (const [t, row] of [['the second one', 1], ['number two', 1], ['two', 1], ['2', 1], ['the 3rd', 2], ['third', 2], ['the last one', 2], ['the first one', 0], ['um, the first one, Jarvis', 0], ['show me the third', 2], ['the numbers one', 1], ['budget 2026', 0], ['budget dot numbers', 1], ['the second one please', 1]])
  assert.deepEqual(pick(t), { kind: 'pick', row }, t);
for (const t of ['none', 'neither', 'no', 'none of them', 'never mind', 'cancel']) assert.deepEqual(pick(t), { kind: 'none' }, t);
for (const t of ['budget', 'the fourth one', 'number nine', 'yes', 'open it', 'what about the report', '', 'zero']) assert.equal(pick(t), null, `${t}: no row`);
assert.deepEqual(pick('yes', rows.slice(0, 1)), { kind: 'pick', row: 0 }, 'one match: yes shows it'); assert.deepEqual(pick('show it', rows.slice(0, 1)), { kind: 'pick', row: 0 });

// ---- 7. what is said: the count and the first one or two names only; nothing found states the limits
const R = [{ name: 'budget-2026.xlsx', where: '~/Documents/Finance' }, { name: 'budget.numbers', where: '~/Desktop' }, { name: 'Budget', folder: true, where: '~' }];
assert.equal(foundLine(R.slice(0, 1), 1, { voiced: true }), 'I found 1: budget-2026.xlsx. Shall I show it in Finder?');
assert.equal(foundLine(R.slice(0, 2), 2, { voiced: true }), 'I found 2: budget-2026.xlsx and budget.numbers. Which one should I show?');
assert.equal(foundLine(R, 23, { voiced: true }), 'I found 23; the first two are budget-2026.xlsx and budget.numbers. Which one should I show?');
assert.equal(foundLine([R[2], R[0]], 2), 'I found 2: Budget folder and budget-2026.xlsx. Click one to show it in Finder.');
for (const n of [1, 2, 23]) assert.doesNotMatch(foundLine(R.slice(0, Math.min(n, 3)), n, { voiced: true }), /Documents|Desktop|Finance|~|Budget folder/, 'no folder is said, nor a third name');
assert.match(nothingLine(bq), /^I found no file called "budget"\. I look by name with Spotlight in your home folder and on your drives; hidden folders, ~\/Library and the folders you excluded from Spotlight \(System Settings, Spotlight, Search Privacy\) aren't searched, and a drive Spotlight doesn't index can't be either\.$/);
assert.match(nothingLine(q('Which folder is the poster in?'), { drives: false }), /^I found no file or folder called "poster"\. I look by name with Spotlight in your home folder;/);
assert.match(nothingLine(q("Where's my thesis folder?")), /^I found no folder called "thesis"/);
assert.equal(nothingLine(bq, { timedOut: true, seconds: 3 }), 'Spotlight didn\'t answer within 3 seconds, so I found no file called "budget".');

// ---- 8. the search, with a stand-in for the hands helper
{
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'findany-home-')));
  const base = loadSettings(home);
  const settings = { ...base, findLeaveOut: [path.join(home, 'Private')], limits: { ...base.limits, findMatches: 3 } };
  assert.deepEqual([base.findAnywhere, base.findDrives, base.findLeaveOut, base.limits.findMatches, base.limits.findSeconds], [true, true, [], 8, 3], 'the defaults');
  assert.deepEqual([LIMITS.findMatches.min, LIMITS.findMatches.max, LIMITS.findSeconds.min, LIMITS.findSeconds.max], [1, 20, 1, 15]);
  const calls = [];
  const found = (paths, extra = {}) => async (args, input, ms) => { calls.push({ args, input: JSON.parse(input), ms }); return { ok: true, items: paths.map((p) => ({ path: p, kind: p.endsWith('/Thesis') ? 'folder' : 'file', changed: 1 })), drives: [{ path: '/Volumes/Backup', name: 'Backup' }, { path: '/Users/x', name: 'not a drive' }], timedOut: false, ...extra }; };
  const paths = [`${home}/Documents/budget.xlsx`, `${home}/Desktop/budget-2026.xlsx`, `${home}/Library/CloudStorage/budget.xlsx`, `${home}/.Trash/budget.xlsx`, `${home}/Private/budget.xlsx`,
    `${home}/Documents/roamies-pi/budget.txt`, '/Volumes/Backup/Finance/budget.xlsx', '/Volumes/Office/budget.xlsx', `${home}/a/b/budget_old.xlsx`, `${home}/c/budget.pdf`];
  const f = createFind({ home, settings: () => settings, hands: found(paths), platform: 'darwin' });
  const r = await f.search(findAsk('Where is budget.xlsx?'));
  assert.deepEqual(calls[0].args, ['find'], 'nothing he said is in the helper\'s arguments');
  assert.deepEqual(calls[0].input, { words: ['budget', '.xlsx'], seconds: 3, max: 1000, drives: true }, 'his words go on stdin');
  assert.equal(calls[0].ms, 9000);
  assert.deepEqual(r.rows.map((x) => [x.name, x.where]), [['budget.xlsx', '~/Documents'], ['budget.xlsx', 'Backup › Finance'], ['budget-2026.xlsx', '~/Desktop']], 'limits.findMatches at most, ranked');
  assert.deepEqual([r.total, r.leftOut, r.otherKind, r.drives, r.timedOut, r.failed], [4, 5, 1, 1, false, ''], 'Library, Trash, his own folder, Roamies\' folder and a network drive left out; the PDF isn\'t an xlsx; the drive that isn\'t under /Volumes ignored');
  assert.ok(r.rows.every((x) => x.path.startsWith('/')));
  // drives off: none searched, a result on one isn't shown
  const off = createFind({ home, settings: () => ({ ...settings, findDrives: false }), hands: found(paths), platform: 'darwin' });
  const r2 = await off.search(findAsk('Where is budget.xlsx?'));
  assert.equal(calls.at(-1).input.drives, false); assert.ok(!r2.rows.some((x) => x.where.startsWith('Backup')));
  // macOS only; the app's helper needed; a helper that fails says so and finds nothing
  assert.equal((await createFind({ home, settings: () => settings, hands: found(paths), platform: 'linux' }).search(findAsk('Where is budget.xlsx?'))).failed, NOT_MAC);
  assert.equal((await createFind({ home, settings: () => settings, hands: found(paths), platform: 'win32' }).search(findAsk('Where is budget.xlsx?'))).failed, NOT_MAC);
  assert.equal((await createFind({ home, settings: () => settings, hands: null, platform: 'darwin' }).search(findAsk('Where is budget.xlsx?'))).failed, NO_HELPER);
  const bad = await createFind({ home, settings: () => settings, hands: async () => { throw new Error('boom'); }, platform: 'darwin' }).search(findAsk('Where is budget.xlsx?'));
  assert.equal(bad.rows.length, 0); assert.match(bad.failed, /^Spotlight couldn't be asked \(boom\), so nothing was found\.$/);
  // a timed-out search shows what came in before the time ran out
  const late = await createFind({ home, settings: () => settings, hands: found(paths.slice(0, 1), { timedOut: true }), platform: 'darwin' }).search(findAsk('Where is budget.xlsx?'));
  assert.deepEqual([late.rows.length, late.timedOut], [1, true]);
  // what the helper hands back that isn't a path is dropped
  const odd = await createFind({ home, settings: () => settings, hands: async () => ({ ok: true, items: [{ path: 'budget.xlsx' }, { nope: 1 }, null], drives: 'x' }), platform: 'darwin' }).search(findAsk('Where is budget.xlsx?'));
  assert.deepEqual([odd.rows.length, odd.total], [0, 0]);
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 9. the log gets counts only: sidekick.mjs's two lines carry numbers and the pick's row, nothing he said
{
  const src = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const lines = [...src.matchAll(/logLine\('find_(?:file|pick)', (\{[^}]*\})/g)].map((m) => m[1]);
  assert.equal(lines.length, 4);
  for (const l of lines) assert.doesNotMatch(l, /said|\.name|path|where|text|\bq\b|words/, l);
}
console.log('find a file anywhere tests passed');
