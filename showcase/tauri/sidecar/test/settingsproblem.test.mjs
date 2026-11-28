// The owner, 2026-11-28: settings.json that can't be used (settingsproblem.mjs, loadSettings in pi.mjs, sidekick.mjs).
//   - jsonError finds where text stops being JSON, and agrees with JSON.parse on every text (fixed cases and mutations);
//   - the line: where (line, column), a stray comma named, the file shown but not said, no form of address, never a
//     word of the file;
//   - settingsProblem never throws: a file that can't be read, isn't JSON, isn't one object, or has a wrong value in a
//     setting that protects something; null when it can be used;
//   - in sidekick.mjs: the shell's handler, every timer and the last nets don't let it throw out; requests, typed and
//     spoken, are gated; the reminders aren't (the run test, settings-broken-run.test.mjs, checks it all running).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { READABLE_AGAIN, REFUSE, SettingsProblem, isSettingsProblem, jsonError, placeOf, problemLine } from '../settingsproblem.mjs';
import { loadSettings, settingsDefaults, settingsProblem } from '../pi.mjs';

// ---- jsonError against JSON.parse
const parses = (t) => { try { JSON.parse(t); return true; } catch { return false; } };
const fixed = ['{}', '[]', '{"a":1,}', '[1,]', '{"a":1', '', '   ', '{"a" 1}', '{"a":1 "b":2}', '{a:1}', "{'a':1}", '{"a":tru}', '{"a":01}', '{"a":1.}', '{"a":-}', '{"a":1e}', '{"a":"x\ny"}', '{"a":"\\x"}', '{"a":"\\u12G4"}', '{"a":"\\u1234"}', '\uFEFF{}', '{"a":[1,2,{"b":null}]}', '{"a":1}}', '{"a":1} x', 'nul', '"just text"', '1', '-0.5e+3', '{"a":"\t"}', '{"a":NaN}', '{"a":Infinity}', '{"a":1,,"b":2}', '[1 2]', '{"a":{"b":[}}'];
for (const t of fixed) assert.equal(jsonError(t) === null, parses(t), `agrees on ${JSON.stringify(t)}`);
// mutations of the real default file: a character deleted, doubled or swapped for a JSON one, 3000 times
const base = `${JSON.stringify(settingsDefaults('/Users/someone'), null, 2)}\n`;
let seed = 42; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
let broken = 0;
for (let k = 0; k < 3000; k++) {
  const i = rnd(base.length), how = rnd(3), ch = ',{}[]":0 \n'[rnd(10)];
  const t = how === 0 ? base.slice(0, i) + base.slice(i + 1) : how === 1 ? base.slice(0, i) + base[i] + base.slice(i) : base.slice(0, i) + ch + base.slice(i + 1);
  const e = jsonError(t);
  assert.equal(e === null, parses(t), `mutation ${k} at ${i}`);
  if (e) { broken++; assert.ok(e.offset >= 0 && e.offset <= t.length); }
}
assert.ok(broken > 400, `many mutations break it (${broken})`);
// the owner's case: a stray comma before a closing bracket, two lines on
{
  const t = '{\n  "sandbox": true,\n  "files": true,\n}\n';
  const e = jsonError(t);
  assert.deepEqual({ ...e, ...placeOf(t, e.offset) }, { offset: t.indexOf('}'), comma: true, end: false, empty: false, line: 4, column: 1 });
  const t2 = '{\n  "readOnly": ["~/a", ],\n  "x": 1\n}';
  assert.deepEqual(placeOf(t2, jsonError(t2).offset), { line: 2, column: 23 }); assert.equal(jsonError(t2).comma, true);
  const t3 = '{\n  "a": 1\n  "b": 2\n}';
  assert.deepEqual([jsonError(t3).comma, placeOf(t3, jsonError(t3).offset)], [false, { line: 3, column: 3 }], 'a missing comma: where the next value starts');
  const t4 = '{\n  "a": [1,\n  2\n\n';
  assert.equal(jsonError(t4).end, true); assert.deepEqual(placeOf(t4, jsonError(t4).offset), { line: 3, column: 3 }, 'ends too soon: the last character, not the empty line after');
  assert.equal(jsonError('').empty, true); assert.equal(jsonError(' \n ').empty, true);
}

// ---- the line
{
  const file = '~/Documents/roamies-pi/settings.json';
  const json = problemLine({ kind: 'json', file, line: 110, column: 3, comma: true });
  assert.equal(json.shown, `Your settings file isn't valid JSON: line 110, column 3, in ${file}. There's a stray comma just before it. ${REFUSE}`);
  assert.equal(json.spoken, `Your settings file isn't valid JSON: line 110, column 3. There's a stray comma just before it. ${REFUSE}`);
  assert.equal(problemLine({ kind: 'json', file, line: 1, column: 1, empty: true }).spoken, `Your settings file isn't valid JSON: line 1, column 1. The file is empty. ${REFUSE}`);
  assert.equal(problemLine({ kind: 'json', file, line: 9, column: 2, end: true }).spoken, `Your settings file isn't valid JSON: line 9, column 2. It ends before everything opened in it is closed. ${REFUSE}`);
  assert.equal(problemLine({ kind: 'object', file }).shown, `Your settings file should hold one JSON object, in { }: ${file}. ${REFUSE}`);
  assert.equal(problemLine({ kind: 'object', file }).spoken, `Your settings file should hold one JSON object, in curly brackets. ${REFUSE}`);
  assert.equal(problemLine({ kind: 'read', file, why: 'permission denied' }).shown, `I can't read your settings file (permission denied), in ${file}. ${REFUSE}`);
  const four = problemLine({ kind: 'value', file, wrong: [{ name: 'sandbox', what: 'should be true or false' }, { name: 'files', what: 'should be true or false' }, { name: 'mask.people', what: 'entry 2 has no letter' }, { name: 'masking', what: 'should be true or false' }] });
  assert.equal(four.spoken, `Your settings file has wrong values: sandbox should be true or false; files should be true or false; mask.people entry 2 has no letter; and 1 more. ${REFUSE}`);
  for (const l of [json, four]) { assert.doesNotMatch(`${l.shown} ${l.spoken}`, /\bsir\b|Jarvis/i, 'no form of address'); assert.doesNotMatch(l.spoken, /settings\.json|~\//, 'the path is shown, not said'); }
  assert.equal(READABLE_AGAIN, 'Your settings can be read again.');
  const e = new SettingsProblem({ kind: 'object', file });
  assert.ok(isSettingsProblem(e) && e instanceof Error && e.message === problemLine({ kind: 'object', file }).shown);
  assert.ok(isSettingsProblem({ name: 'SettingsProblem' }) && !isSettingsProblem(new Error('x')) && !isSettingsProblem(null));
}

// ---- loadSettings and settingsProblem, on a real file
{
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'settingsproblem-')));
  const file = path.join(home, 'Documents', 'roamies-pi', 'settings.json');
  assert.equal(settingsProblem(home), null, 'made with the defaults: usable');
  const good = fs.readFileSync(file, 'utf8');
  // the owner's fault: a stray comma; the line names where, never a word of the file
  const bad = good.replace('"Messages"\n', '"Messages",\n').replace('"neverLook": [', '"neverLook": ["Hartwell Clinic", ');
  fs.writeFileSync(file, bad);
  const p = settingsProblem(home), at = placeOf(bad, jsonError(bad).offset);
  assert.ok(isSettingsProblem(p) && p.problem.kind === 'json' && p.problem.comma === true);
  assert.equal(p.message, `Your settings file isn't valid JSON: line ${at.line}, column ${at.column}, in ~/Documents/roamies-pi/settings.json. There's a stray comma just before it. ${REFUSE}`);
  assert.doesNotMatch(`${p.message} ${p.spoken}`, /Hartwell|Messages|Expected|position/, 'nothing of the file, nor the parser\'s own words');
  assert.throws(() => loadSettings(home), (e) => e === p || e.message === p.message);
  // not one object
  fs.writeFileSync(file, '["sandbox"]'); assert.equal(settingsProblem(home).problem.kind, 'object');
  // a wrong value in a setting that protects something; and one in a setting that doesn't, which is a notice as before
  fs.writeFileSync(file, good.replace('"sandbox": true', '"sandbox": "no"')); assert.deepEqual(settingsProblem(home).problem.wrong, [{ name: 'sandbox', what: 'should be true or false' }]);
  fs.writeFileSync(file, good.replace('"closingReply": "Any time."', '"closingReply": ""')); assert.equal(settingsProblem(home), null); assert.deepEqual(loadSettings(home).invalid.map((i) => i.name), ['closingReply']);
  // a word on the masking list that can't be used: refused while masking is on, not when it is off
  const masked = good.replace('"people": []', '"people": ["Ana", "X"]');
  fs.writeFileSync(file, masked); assert.deepEqual(settingsProblem(home).problem.wrong, [{ name: 'mask.people', what: 'entry 2 is under 2 characters' }]);
  assert.doesNotMatch(settingsProblem(home).message, /Ana/);
  fs.writeFileSync(file, masked.replace('"masking": true', '"masking": false')); assert.equal(settingsProblem(home), null);
  // can't be read at all
  if (process.getuid?.() !== 0) {
    fs.writeFileSync(file, good); fs.chmodSync(file, 0o000);
    assert.deepEqual([settingsProblem(home).problem.kind, settingsProblem(home).problem.why], ['read', 'permission denied']);
    fs.chmodSync(file, 0o600);
  }
  fs.rmSync(file); fs.mkdirSync(file);
  assert.deepEqual([settingsProblem(home).problem.kind, settingsProblem(home).problem.why], ['read', "it's a folder"]);
  fs.rmSync(file, { recursive: true });
  assert.equal(settingsProblem(home), null, 'gone: made again with the defaults');
}

// ---- sidekick.mjs: nothing throws out because of it
{
  const src = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const side = fs.readFileSync(path.join(src, 'sidekick.mjs'), 'utf8');
  assert.match(side, /try \{ shellMessage\(m\); \} catch \(e\) \{ failed\(`message \$\{String\(m\?\.type \?\? ''\)\.slice\(0, 30\)\}`, e\); \}/, 'the shell\'s handler');
  assert.match(side, /if \(isSettingsProblem\(e\)\) \{ logLine\('settings_unreadable', \{ from: 'uncaught' \}\); return; \}/, 'the last net: no exit');
  // every timer at the top level: skipped while it can't be used, or its work caught
  const timers = [...side.matchAll(/^setInterval\(|^  setTimeout\(\(\) => \{\n/gm)].map((m) => side.slice(m.index, m.index + 700));
  assert.ok(timers.length >= 7, String(timers.length));
  for (const t of timers) assert.ok(/whenReadable\(|trouble\(\)|settingsStamp\(\)|try \{/.test(t), `a timer that could throw: ${t.slice(0, 120)}`);
  // requests: typed and spoken gated before anything reads the settings; the model's further calls too; the reminders not
  assert.match(side, /if \(text\?\.trim\(\) && isStandDown\(text, \.\.\.standPhrase\(\)\)\) \{ standDownNow\('typed'\); return; \}\n\s*if \(text\?\.trim\(\) && settingsGate\(false\)\) return;/);
  assert.match(side, /standDownNow\('phrase'\); return; \}\n\s*if \(settingsGate\(true\)\) return;/);
  assert.match(side, /transformContext: \(msgs, o\) => \{\n\s*\{ const p = trouble\(\); if \(p\) throw p; \}/);
  assert.match(side, /async function remindTick\(\) \{\n\s*if \(busy \|\| queued/, 'the reminders run whatever the settings');
  assert.match(side, /if \(p\) \{ settingsBad = true; logLine\('settings_reminder', \{ todos: due\.length \}\); settingsSay\(`\$\{line\}\\n\$\{p\.message\}`, `\$\{forVoice\(line\)\} \$\{p\.spoken\}`\); return; \}/);
  // state.json is found without reading the settings
  assert.doesNotMatch(side, /settingsNow\(\)\.dir/);
  assert.match(side, /createStandDown\(\{ home: HOME, dir: \(\) => DIR,/); assert.match(side, /createQuiet\(\{\n\s*home: HOME, dir: \(\) => DIR,/);
  // no request while it can't be used
  for (const f of ['piUpdate', 'maybeCompact', 'memoryPass', 'warmUp']) assert.match(side.slice(side.indexOf(`function ${f}(`), side.indexOf(`function ${f}(`) + 400), /trouble\(\)/, f);
}
// ---- the owner, 2026-11-28 (12:06): every tool call refused while it can't be used, on every route
{
  const src = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const side = fs.readFileSync(path.join(src, 'sidekick.mjs'), 'utf8');
  // the one wrapper every tool goes through (Claude's route, Claude Code's bridge and the local route call these same
  // objects), its first step; set up after the list is final, and nothing is added to the list after it
  const wrap = side.indexOf('for (const t of tools) {\n  const run = t.execute;\n  t.execute = async (args, ctx, ...rest) => {\n    { const p = trouble(); if (p) refuseTool(p, t.name); }\n');
  assert.ok(wrap > 0, 'the refusal is the wrapper\'s first step');
  assert.ok(side.lastIndexOf('tools.splice(') < wrap && side.indexOf('leanTools(tools') < wrap, 'after the list is final');
  assert.doesNotMatch(side.slice(wrap), /\btools\.(push|splice|unshift)\(/, 'nothing added after it');
  assert.match(side, /tool: \(name\) => tools\.find\(\(t\) => t\.name === name\) \?\? null,/, 'the local route calls the wrapped tools');
  // the first refusal ends the request (Claude's program would otherwise take its next step by itself) with the line
  assert.match(side, /if \(!brokeDuring\) \{ brokeDuring = p; settingsBad = true; try \{ controller\?\.abort\(\); \}/);
  assert.match(side, /if \(brokeDuring\) throw brokeDuring;\n\s*doneWriting\(\);/);
  assert.match(side, /const during = brokeDuring \?\? \(isSettingsProblem\(err\) && !controller\.signal\.aborted \? err : null\);/);
  // the memory pass of a conversation closed meanwhile is made once it can be used
  assert.match(side, /memoryLater\.push\(\{ s, why \}\)/);
  assert.match(side, /function afterReadable\(\) \{\n\s*memoryAgain\(\);/);
}

// ---- a save that takes out a setting that protects something (reference.mjs)
{
  const { removedProtecting, removedNotice } = await import('../reference.mjs');
  assert.deepEqual(removedProtecting(null, ['sandbox']), [], 'not known before: nothing');
  assert.deepEqual(removedProtecting([], ['sandbox', 'closingReply', 'limits.maskEntries']), ['sandbox', 'limits.maskEntries']);
  assert.deepEqual(removedProtecting(['sandbox'], ['sandbox']), [], 'it wasn\'t there before');
  assert.deepEqual(removedProtecting(['local'], ['local.start']), [], 'its group wasn\'t there before');
  assert.deepEqual(removedProtecting([], ['local']), ['local'], 'a whole group');
  assert.deepEqual(removedProtecting([], ['calendar.dayStart', 'speaking']), [], 'settings that protect nothing');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'removed-'));
  assert.equal(removedNotice(['sandbox', 'neverLook', 'mask', 'local', 'autoSendReadOnly'], home), [
    'sandbox was taken out of settings.json, so it now takes its default: true.',
    `neverLook was taken out of settings.json, so it now takes its default: ${((t) => (t.length > 80 ? `${t.slice(0, 79)}…` : t))(JSON.stringify(settingsDefaults(home).neverLook))}.`,
    'mask was taken out of settings.json, so it now takes its default: an empty list, so no word is masked.',
    'local was taken out of settings.json, so it now takes its default: the values under it in settings.default.json.',
    `autoSendReadOnly was taken out of settings.json, so it now takes its default: ${settingsDefaults(home).autoSendReadOnly}.`,
  ].join('\n'));
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('settings problem tests: passed');
