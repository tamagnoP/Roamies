// The owner, 2026-11-28 14:09: the cloud voice from upstream (its key form, its affiliate link, its billing note, its
// socket, its account check, its recorded beats, the keychain commands that held its key) is deleted. No "fish" in
// anything the app ships or shows: the overlay page, the setup guide, the panel, the sidecar's modules (what the
// bundle is made from) and its helper script, the shell, the macOS helpers and the app's configuration.
// The one exception is the fish shell, by name, in the safety rules (safety.mjs: its history file, its config folder,
// a shell that is never run) and pi's watch (piwatch.mjs: a shell pi may have left running): those protect something.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecar = path.join(here, '..'), showcase = path.join(sidecar, '..', '..'), shell = path.join(sidecar, '..', 'src-tauri');
const walk = (dir, keep) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
});
const TEXT = /\.(m?js|html|css|json|py|sh|rs|swift|plist|entitlements|toml)$/;
const shipped = [
  path.join(showcase, 'desktop.html'),
  ...['roamies', 'onboarding', 'panel'].flatMap((d) => walk(path.join(showcase, d), (p) => TEXT.test(p))),
  ...fs.readdirSync(sidecar).filter((f) => /\.mjs$|^kokoro_server\.py$|^bundle\.sh$|^package\.json$/.test(f)).map((f) => path.join(sidecar, f)),
  ...['src', 'hands', 'voice', 'shared'].flatMap((d) => walk(path.join(shell, d), (p) => TEXT.test(p))),
  ...['tauri.conf.json', 'tauri.macos.conf.json', 'Info.plist', 'Roamies.entitlements', 'Cargo.toml', 'build.rs'].map((f) => path.join(shell, f)),
];
assert.ok(shipped.length > 80, `the files the app is made from (${shipped.length})`);
for (const f of ['sidekick.mjs', 'speaker.mjs', 'localvoice.mjs', 'safety.mjs']) assert.ok(shipped.includes(path.join(sidecar, f)), f);
assert.ok(shipped.includes(path.join(showcase, 'onboarding', 'onboarding.js')) && shipped.includes(path.join(showcase, 'onboarding', 'index.html')));
assert.ok(shipped.includes(path.join(shell, 'hands', 'main.swift')));

// The fish shell, exactly where it protects something, and nowhere else.
const SHELL = {
  'safety.mjs': [/\(bash\|zsh\|fish\)_history/g, /\\\.config\\\/fish/g, /'fish', /g],
  'piwatch.mjs': [/'zsh', 'dash', 'ksh', 'fish'\]/g],
};
const found = [];
for (const f of shipped) {
  let text = fs.readFileSync(f, 'utf8');
  for (const re of SHELL[path.basename(f)] ?? []) {
    const before = text;
    text = text.replace(re, '');
    assert.notEqual(text, before, `${path.basename(f)}: the fish shell rule ${re} is still there (a safety rule, not the cloud voice)`);
  }
  text.split('\n').forEach((line, i) => { if (/fish/i.test(line)) found.push(`${path.relative(showcase, f)}:${i + 1}: ${line.trim().slice(0, 120)}`); });
}
assert.deepEqual(found, [], 'nothing the app ships or shows says "fish"');

// What it was made of is gone, not only out of sight.
for (const f of ['fish.mjs', 'msgpack.mjs', 'secrets.mjs', 'beats']) assert.ok(!fs.existsSync(path.join(sidecar, f)), `${f} is deleted`);
const swift = fs.readFileSync(path.join(shell, 'hands', 'main.swift'), 'utf8');
assert.doesNotMatch(swift, /secret-(get|set|delete)|SecItem/, 'the helper has no keychain commands any more');
assert.doesNotMatch(fs.readFileSync(path.join(sidecar, 'bundle.sh'), 'utf8'), /beats/, 'no recorded beats in the bundle');
const side = fs.readFileSync(path.join(sidecar, 'sidekick.mjs'), 'utf8');
assert.match(side, /const KNOWN = new Set\(\[\.\.\.Object\.keys\(DEFAULTS\), 'openAtLogin'\]\);/, 'what sidekick.json still has from before is dropped at the next save, and kept out of diagnostics');

// The setup guide offers Anthropic only (the owner, 14:09): its sign-in and its key; nothing else is accepted from it.
assert.match(side, /const GUIDE_PROVIDERS = \['anthropic'\];/);
assert.match(side, /oauth: signInCards\(GUIDE_PROVIDERS, /);
assert.match(side, /apikey: keyCards\(AUTH_PROVIDERS\.filter\(\(p\) => GUIDE_PROVIDERS\.includes\(p\.value\)\), /);
assert.match(side, /m\.type === 'ob_login' && GUIDE_PROVIDERS\.includes\(m\.provider\)\) oauthLogin\(/);
assert.match(side, /m\.type === 'ob_apikey' && GUIDE_PROVIDERS\.includes\(storageKeyProvider\(String\(m\.provider \?\? ''\)\)\)\) apiKeyLogin\(/);
const guide = fs.readFileSync(path.join(showcase, 'onboarding', 'onboarding.js'), 'utf8');
assert.doesNotMatch(guide, /ChatGPT|OpenRouter|Gemini|affiliate|fpr=/, 'the guide\'s stand-in data and its links name no other provider');

console.log('no cloud voice tests: passed');
