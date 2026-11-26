// Local-only build, feature 23: a stand-in for the local model server (mlx_vlm.server's OpenAI-compatible API) on
// 127.0.0.1, for the tests. The warm-up and live check get replies whose cached share is as the real server's; the
// requests of the app get the scripted answers in turn: { calls: [[name, args]] } or { content }.
import http from 'node:http';

export async function startFakeLocal({ model = 'gemma-4-e4b', answers = [], reuse = true } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', () => {
      if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: model }] })); return; }
      if (req.url === '/v1/cache/stats') { res.end(JSON.stringify({ enabled: true, entries: 3 })); return; }
      const b = JSON.parse(body || '{}');
      const opening = JSON.stringify(b.messages?.[0] ?? '').length, all = JSON.stringify(b.messages ?? []).length + String(b.transient_context ?? '').length;
      const usage = { prompt_tokens: Math.ceil(all / 4), completion_tokens: 3, prompt_tokens_details: { cached_tokens: reuse ? Math.floor(opening / 4) : 0 } };
      const warm = b.max_tokens === 1 || b.max_tokens === 24;
      if (!warm) requests.push(b);
      const a = warm ? { content: 'Ready.' } : answers.shift() ?? { content: '' };
      const calls = (a.calls ?? []).map(([name, args], i) => ({ index: i, id: `t${requests.length}_${i}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }));
      if (b.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (a.content) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: a.content } }] })}\n\n`);
        if (calls.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else res.end(JSON.stringify({ choices: [{ message: { content: a.content ?? null, tool_calls: calls } }], usage }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { address: `http://127.0.0.1:${server.address().port}/v1`, requests, answers, close: () => new Promise((r) => server.close(r)) };
}
