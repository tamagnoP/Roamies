// Local-only build (the owner, 2026-11-28): settings.json that can't be used. A file that can't be read, isn't valid
// JSON, isn't one object, or holds a wrong value in a setting that protects something (PROTECTING, pi.mjs) is one
// problem: Roamies refuses requests until it is fixed, and says why in a line worded here, by code. The line never
// quotes the file's text (a private word could be in it): only where the problem is, and which setting.

/** Where text stops being JSON, as JSON.parse reads it: null when it is valid, else { offset, comma, end, empty }.
 *  comma: the character there closes an object or a list straight after a comma. end: the text ends too soon. */
export function jsonError(text) {
  const s = String(text);
  let i = 0;
  const fail = (at = i) => { throw { at }; };
  const ws = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++; };
  const word = (w) => { for (const c of w) { if (s[i] !== c) fail(); i++; } };
  const string = () => {
    i++;
    for (;;) {
      if (i >= s.length) fail();
      const c = s.charCodeAt(i);
      if (c === 34) { i++; return; }
      if (c < 32) fail();
      if (c === 92) {
        i++;
        const e = s[i];
        if (e === 'u') { for (let k = 1; k <= 4; k++) if (!/[0-9a-fA-F]/.test(s[i + k] ?? '')) fail(i + k); i += 5; continue; }
        if (!'"\\/bfnrt'.includes(e ?? 'x') || e === undefined) fail();
        i++; continue;
      }
      i++;
    }
  };
  const digits = () => { const a = i; while (s[i] >= '0' && s[i] <= '9') i++; if (i === a) fail(); };
  const number = () => {
    if (s[i] === '-') i++;
    if (s[i] === '0') i++; else digits();
    if (s[i] === '.') { i++; digits(); }
    if (s[i] === 'e' || s[i] === 'E') { i++; if (s[i] === '+' || s[i] === '-') i++; digits(); }
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++; ws();
      if (s[i] === '}') { i++; return; }
      for (;;) {
        ws(); if (s[i] !== '"') fail(); string(); ws();
        if (s[i] !== ':') fail(); i++; value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      if (s[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return; }
        fail();
      }
    }
    if (c === '"') return string();
    if (c === 't') return word('true');
    if (c === 'f') return word('false');
    if (c === 'n') return word('null');
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    fail();
  };
  try { value(); ws(); if (i < s.length) fail(); return null; } catch (e) {
    if (!e || typeof e.at !== 'number') throw e;
    const at = Math.min(e.at, s.length);
    let b = at - 1; while (b >= 0 && /\s/.test(s[b])) b--;
    return { offset: at, comma: (s[at] === '}' || s[at] === ']') && s[b] === ',', end: at >= s.length && !!s.trim(), empty: !s.trim() };
  }
}

/** Line and column (from 1) of an offset. At the very end, the last character's place, not an empty line after it. */
export function placeOf(text, offset) {
  const s = String(text);
  let at = offset;
  if (at >= s.length) { at = s.length; while (at > 0 && /\s/.test(s[at - 1])) at--; at = Math.max(0, at - (at > 0 ? 1 : 0)); }
  const before = s.slice(0, at), line = before.split('\n').length, column = at - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

export const REFUSE = "I won't act on requests until it's fixed.";
export const READABLE_AGAIN = 'Your settings can be read again.';

/** The error loadSettings throws for each of these. problem: { kind: 'read' | 'json' | 'object' | 'value', file (as
 *  shown, with ~), why ('read'), line, column, comma, end, empty ('json'), wrong: [{ name, what }] ('value') }.
 *  message: the line shown; spoken: the line said (the same without the file's path). */
export class SettingsProblem extends Error {
  constructor(problem) {
    const { shown, spoken } = problemLine(problem);
    super(shown);
    this.name = 'SettingsProblem';
    this.problem = problem;
    this.spoken = spoken;
  }
}
export const isSettingsProblem = (e) => e instanceof SettingsProblem || e?.name === 'SettingsProblem';

const WRONG_SHOWN = 3; // wrong values named in one line before "and N more"
/** The line, worded by code with no form of address: { shown, spoken }. */
export function problemLine(p) {
  const at = (path) => (path ? `, in ${p.file}` : '');
  let head;
  if (p.kind === 'read') head = (path) => `I can't read your settings file (${p.why})${at(path)}.`;
  else if (p.kind === 'object') head = (path) => (path ? `Your settings file should hold one JSON object, in { }: ${p.file}.` : 'Your settings file should hold one JSON object, in curly brackets.');
  else if (p.kind === 'json') {
    const more = p.empty ? ' The file is empty.' : p.comma ? " There's a stray comma just before it." : p.end ? ' It ends before everything opened in it is closed.' : '';
    head = (path) => `Your settings file isn't valid JSON: line ${p.line}, column ${p.column}${at(path)}.${more}`;
  } else {
    const w = p.wrong ?? [], named = w.slice(0, WRONG_SHOWN).map((x) => `${x.name} ${x.what}`), left = w.length - named.length;
    const list = `${named.join('; ')}${left > 0 ? `; and ${left} more` : ''}`;
    head = (path) => `Your settings file has ${w.length === 1 ? 'a wrong value' : 'wrong values'}${at(path)}: ${list}.`;
  }
  return { shown: `${head(true)} ${REFUSE}`, spoken: `${head(false)} ${REFUSE}` };
}

/** What a read error is, in a few words, for the line. */
export function readWhy(e) {
  const c = e?.code;
  return c === 'EACCES' || c === 'EPERM' ? 'permission denied' : c === 'EISDIR' ? "it's a folder" : c === 'ENOENT' ? "it isn't there" : c ? String(c) : 'an error';
}
