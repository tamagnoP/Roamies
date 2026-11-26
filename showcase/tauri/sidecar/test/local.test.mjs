// Local-only build, feature 23: the one address of the local model, the guarded fetch, the chat call (local.mjs).
import assert from 'node:assert/strict';
import http from 'node:http';
import { chat, guardedFetch, localAddress, probe } from '../local.mjs';

// ---- only http://127.0.0.1:<port>, with or without /v1
assert.equal(localAddress('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/v1');
assert.equal(localAddress(' http://127.0.0.1:8080/v1/ '), 'http://127.0.0.1:8080/v1');
for (const bad of ['', 'http://localhost:8080', 'https://127.0.0.1:8080', 'http://127.0.0.2:8080', 'http://192.168.1.4:8080/v1', 'http://user:pw@127.0.0.1:8080', 'http://127.0.0.1:80', 'http://127.0.0.1:080', 'http://127.0.0.1:70000', 'http://127.0.0.1:8080/other', 'http://127.0.0.1.evil.com:8080', null, 42]) {
  assert.equal(localAddress(bad), null, String(bad));
}

// ---- the guarded fetch reaches that address only
let reached = [];
const spy = async (u) => { reached.push(u); return new Response('{}'); };
const g = guardedFetch('http://127.0.0.1:8080', spy);
await g('http://127.0.0.1:8080/v1/models');
for (const u of ['http://127.0.0.1:8081/v1/models', 'http://example.com/v1', 'http://127.0.0.1:8080/v10', 'http://127.0.0.1:8080/', 'https://127.0.0.1:8080/v1/x']) await assert.rejects(g(u), /refused/, u);
assert.deepEqual(reached, ['http://127.0.0.1:8080/v1/models']);
await assert.rejects(guardedFetch('http://example.com', spy)('http://example.com/v1/x'), /refused/, 'no address, nothing reached');

// ---- a fake server: a stream broken by "Tool arguments changed after they were streamed" is asked again once,
// without streaming
const seen = [];
let breakStream = true;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; }).on('end', () => {
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'gemma-4-e4b' }] })); return; }
    const b = JSON.parse(body); seen.push({ stream: b.stream, transient: b.transient_context });
    if (b.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'open', arguments: '{"app":' } }] } }] })}\n\n`);
      if (breakStream) res.write(`data: ${JSON.stringify({ error: 'Tool arguments changed after they were streamed.' })}\n\n`);
      else res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Zotero"}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 3 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 't2', function: { name: 'open', arguments: '{"app":"Zotero"}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
    }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const address = `http://127.0.0.1:${server.address().port}`;
let r = await chat({ address, body: { messages: [], transient_context: 'x' } });
assert.equal(r.noStreamRetries, 1); assert.deepEqual(seen.map((s) => s.stream), [true, false]); assert.equal(seen[1].transient, 'x', 'asked again unchanged, only without streaming');
assert.deepEqual(r.toolCalls, [{ id: 't2', name: 'open', args: '{"app":"Zotero"}' }]);
breakStream = false; seen.length = 0;
r = await chat({ address, body: { messages: [] } });
assert.equal(r.noStreamRetries, 0); assert.deepEqual(r.toolCalls, [{ id: 't1', name: 'open', args: '{"app":"Zotero"}' }]); assert.equal(seen.length, 1);
assert.deepEqual(await probe(address), ['gemma-4-e4b']);
server.close();
assert.equal(await probe(address, { ms: 300 }), null, 'nothing answering');
await assert.rejects(chat({ address: 'http://example.com', body: {} }), /no address/);
console.log('local tests passed');
