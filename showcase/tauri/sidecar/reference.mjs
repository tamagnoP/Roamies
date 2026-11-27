// Local-only build: no setting has a value the owner can't see.
//
// settings.json is the owner's and Roamies never writes it. So at start-up Roamies writes settings.default.json beside
// it instead: every setting with its default, and under "reference" what stays in code (the sandbox's lists, the
// guards and the fixed facts). That file is for reading and copying from: nothing in Roamies reads it back, and
// the values used for a setting that settings.json lacks come from the same table in pi.mjs the file is written from.
// If settings.json lacks a setting, or holds a value that can't be used, Roamies says so once per start-up, in a bubble.
import fs from 'node:fs';
import os from 'node:os';
import { codeReference, loadSettings, readState, referenceFile, settingsDefaults, writeState } from './pi.mjs';
import { cleanMask, everydayForms, everydayLine } from './mask.mjs'; // feature 34
import { RATE, SAY } from './localvoice.mjs';

const ABOUT = 'Written by Roamies each time it starts, for you to read and copy from. Roamies never reads this file: your settings are in settings.json, and an edit here changes nothing. Everything above "reference" is a setting with its default; a setting that settings.json lacks uses the value shown here. Everything under "reference" is fixed in the app and is shown so you can see it; it cannot be changed from settings.json.';

/** What settings.default.json holds: every setting with its default, then "reference". */
export function settingsReference(home = os.homedir()) {
  return { ...settingsDefaults(home), reference: { about: ABOUT, ...codeReference(), voice: { program: SAY, sampleRate: RATE, fallbackVoiceVariable: 'ROAMIES_SAY_VOICE' } } };
}

/** Writes settings.default.json afresh, for the owner only (mode 600). What was there is replaced unread: the file
 *  is never opened for reading, here or anywhere else. */
export function writeReference(home = os.homedir()) {
  const file = referenceFile(home);
  fs.rmSync(file, { force: true }); // a new file each time, so the owner-only mode holds whatever was there
  fs.writeFileSync(file, `${JSON.stringify(settingsReference(home), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

const shown = (v) => { const t = JSON.stringify(v); return t.length > 80 ? `${t.slice(0, 79)}…` : t; };
// Safety settings fall back to the safe side, and the bubble says so.
const USING = { sandbox: () => 'The sandbox stays on.', neverLook: () => 'I\'m using the built-in list.', mask: () => 'Nothing is masked until it is fixed.' };

/** The start-up bubble's text: which settings settings.json lacks, and which hold a value that can't be used, one
 *  line each. '' when there's nothing to say. */
export function settingsNotice(home = os.homedir()) {
  let s;
  try { s = loadSettings(home); } catch (e) { return e.message; }
  const lines = [];
  if (s.missing.length) lines.push(`settings.json doesn't have: ${s.missing.join(', ')}. I'm using the values in settings.default.json until you add them.`);
  for (const { name, using } of s.invalid) lines.push(`settings.json has a value I can't use for: ${name}. ${USING[name]?.() ?? `I'm using ${shown(using)}.`}`);
  // Feature 34: what on the masking list can't be used (these lines name words: shown, never logged).
  if (s.masking !== false) lines.push(...cleanMask(s.mask, { maxEntries: s.limits.maskEntries }).problems);
  return lines.join('\n');
}

/** At start-up: the reference file is written and the notice worked out. Never throws; → the notice ('' for none). */
export function startupSettings(home = os.homedir()) {
  const notice = [settingsNotice(home), everydayNotice(home)].filter(Boolean).join('\n'); // first: this makes the folder
  try { writeReference(home); } catch (e) { return [notice, `I couldn't write settings.default.json (${e.message}).`].filter(Boolean).join('\n'); }
  return notice;
}

/** Feature 34: the masking list's entries that are also everyday words (macOS's word list), said once for each
 *  version of the list (state.json "masks.warned"), not at every start-up. '' when there's nothing to say. */
export function everydayNotice(home = os.homedir(), wordsFile = undefined) {
  try {
    const s = loadSettings(home);
    if (s.masking === false) return '';
    const { entries } = cleanMask(s.mask, { maxEntries: s.limits.maskEntries });
    if (!entries.length) return '';
    const forms = everydayForms(entries, wordsFile), key = JSON.stringify(forms), st = readState(s.dir);
    if (!forms.length || st.masks?.warned === key) return '';
    writeState(s.dir, { ...st, masks: { ...(st.masks ?? {}), warned: key } });
    return everydayLine(forms);
  } catch { return ''; }
}

/** A notice held until it can be shown. The function returned is called whenever that may have changed, with
 *  whether it can be shown now; the first time it can, it is shown, once. A notice is never dropped. */
export function heldNotice(text, show) {
  let left = String(text ?? '');
  return (can) => { if (!left || !can) return false; const t = left; left = ''; show(t); return true; };
}
