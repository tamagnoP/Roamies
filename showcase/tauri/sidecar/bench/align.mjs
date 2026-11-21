// Lines the sampler's readings (sample.sh) up with Roamies' activity log by time. From the log it takes the time and
// the kind of each event (the first two fields of a line) and nothing else.
// usage: node bench/align.mjs <samples.jsonl> <activity log> [more logs]   -> JSON on stdout
import fs from 'node:fs';
const [samplesFile, ...logs] = process.argv.slice(2);
const samples = fs.readFileSync(samplesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((s) => ({ ...s, ms: Date.parse(s.t) }));
const from = samples[0].ms, to = samples.at(-1).ms;
const events = [];
for (const f of logs) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
  const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+([a-z_]+)(?:\s|$)/.exec(l);
  if (m) { const ms = Date.parse(m[1]); if (ms >= from - 5000 && ms <= to + 5000) events.push({ ms, kind: m[2] }); }
}
const procs = {};
for (const s of samples) { if (!s.pid) continue; const k = `${s.kind} ${s.pid}`; (procs[k] ??= []).push([Math.round((s.ms - from) / 1000), s.mb]); }
console.log(JSON.stringify({ from: new Date(from).toISOString(), seconds: Math.round((to - from) / 1000), procs, events: events.map((e) => [Math.round((e.ms - from) / 100) / 10, e.kind]) }));
