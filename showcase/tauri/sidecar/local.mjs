// Local-only build (feature 23): the local model, at one OpenAI-compatible address on this Mac.
//
// What is fixed here, in code:
//   - The address is http://127.0.0.1:<port>/v1 and nothing else: no other host, no name, no https, no user or key
//     in it (`localAddress`). Where that port leads (a server on this Mac, or the owner's SSH tunnel) is the owner's
//     setup; Roamies talks to that one address only.
//   - Every request goes through `guardedFetch`, which refuses any URL that is not under that address.
//   - A streamed reply that the server breaks with "Tool arguments changed after they were streamed" is asked again
//     once without streaming, silently; the count is returned for the log.
//
// The server's own words never reach the owner or the model: a failure is a code-worded line in the caller.

const PORT_MIN = 1024, PORT_MAX = 65535;
export const STREAM_BROKE = /tool arguments changed after they were streamed/i;

/** The one address the local model may be reached at, from the setting: "http://127.0.0.1:<port>" with or without
 *  "/v1". → "http://127.0.0.1:<port>/v1", or null for anything else ("" included). */
export function localAddress(text) {
  const s = String(text ?? '').trim();
  const m = /^http:\/\/127\.0\.0\.1:(\d{1,5})(\/v1)?\/?$/.exec(s);
  if (!m) return null;
  const port = Number(m[1]);
  if (port < PORT_MIN || port > PORT_MAX || String(port) !== m[1]) return null;
  return `http://127.0.0.1:${port}/v1`;
}

/** A fetch that reaches only the address: any other URL is refused before a connection is made. */
export function guardedFetch(address, fetchImpl = globalThis.fetch) {
  const base = localAddress(address);
  return async (url, init) => {
    const u = String(url);
    if (!base || !(u === base || u.startsWith(`${base}/`))) throw new Error('local: refused, not the local model\'s address');
    let parsed;
    try { parsed = new URL(u); } catch { throw new Error('local: refused, not a URL'); }
    if (parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('local: refused, not the local model\'s address');
    return fetchImpl(u, { ...init, redirect: 'error' });
  };
}

/** The models the server lists, or null when nothing answers at the address within `ms`. */
export async function probe(address, { fetchImpl, ms = 1500 } = {}) {
  const base = localAddress(address);
  if (!base) return null;
  try {
    const r = await guardedFetch(base, fetchImpl)(`${base}/models`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data.map((m) => String(m?.id ?? '')).filter(Boolean) : [];
  } catch { return null; }
}

/** Tool calls as the server sent them, made whole: [{ id, name, args (the raw JSON text) }]. */
const whole = (calls) => Object.values(calls).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, args: c.args || '{}' }));

/** Reads a server-sent-events body. → { content, toolCalls, usage, timings, firstMs, error } */
async function readStream(res, t0, onText) {
  const dec = new TextDecoder();
  let buf = '', content = '', usage = null, timings = null, firstMs = null, error = null;
  const calls = {};
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) { error = String(j.error?.message ?? j.error); continue; }
      if (j.usage) usage = j.usage;
      if (j.timings) timings = j.timings;
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if ((d.content || d.tool_calls) && firstMs == null) firstMs = performance.now() - t0;
      if (d.content) { content += d.content; onText?.(d.content); }
      for (const tc of d.tool_calls ?? []) {
        const k = tc.index ?? 0;
        calls[k] ??= { id: '', name: '', args: '' };
        if (tc.id) calls[k].id = tc.id;
        if (tc.function?.name) calls[k].name += tc.function.name;
        if (tc.function?.arguments) calls[k].args += tc.function.arguments;
      }
    }
  }
  return { content, toolCalls: whole(calls), usage, timings, firstMs, error };
}

/** One chat request to the local model. Streams unless `stream` is false; a stream broken by STREAM_BROKE is asked
 *  again once without streaming (nothing of the broken one is kept). `onText` gets the reply's text as it comes.
 *  → { content, toolCalls, usage, timings, firstMs, ms, noStreamRetries } */
export async function chat({ address, body, signal, stream = true, onText, fetchImpl }) {
  const base = localAddress(address);
  if (!base) throw new Error('local: no address');
  const f = guardedFetch(base, fetchImpl);
  const send = async (streaming) => {
    const t0 = performance.now();
    const res = await f(`${base}/chat/completions`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stream: streaming, ...(streaming ? { stream_options: { include_usage: true } } : {}) }),
    });
    if (!res.ok) { await res.text().catch(() => ''); throw new Error(`local: the server answered ${res.status}`); }
    if (streaming) return { ...(await readStream(res, t0, onText)), ms: performance.now() - t0 };
    const j = await res.json();
    const m = j.choices?.[0]?.message ?? {};
    const content = String(m.content ?? '');
    if (content) onText?.(content);
    const toolCalls = (m.tool_calls ?? []).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function?.name ?? '', args: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) }));
    return { content, toolCalls, usage: j.usage ?? null, timings: j.timings ?? null, firstMs: performance.now() - t0, ms: performance.now() - t0, error: j.error ? String(j.error?.message ?? j.error) : null };
  };
  let r = await send(stream), noStreamRetries = 0;
  if (stream && r.error && STREAM_BROKE.test(r.error)) { noStreamRetries = 1; r = await send(false); }
  if (r.error) throw new Error('local: the server reported an error');
  return { ...r, noStreamRetries };
}
