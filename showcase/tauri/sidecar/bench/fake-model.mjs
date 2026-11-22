// A stand-in for the AI provider on the loopback address: answers from the fixed script, and records how large each
// request was. Nothing is sent anywhere else.
import http from 'node:http';
import { REPLIES } from './script.mjs';

export function startModel({ onRequest = () => {} } = {}) {
  let turn = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body); } catch { /* not JSON */ }
      const sys = JSON.stringify(j.system ?? '').length, tools = JSON.stringify(j.tools ?? []).length, msgs = JSON.stringify(j.messages ?? []).length;
      const tokens = Math.round((sys + tools + msgs) / 3.6);
      const last = j.messages?.at(-1), lastText = typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((p) => p.text ?? '').join(' ');
      const fold = /summar/i.test(JSON.stringify(j.system ?? '').slice(0, 3000)) && !(j.tools?.length);
      const text = fold ? 'Summary of the earlier conversation: the owner asked about the calendar, a report, a review, a grant deadline, a build and a draft, and was answered.' : REPLIES[turn++ % REPLIES.length];
      onRequest({ path: req.url, stream: !!j.stream, messages: j.messages?.length ?? 0, sys, tools, msgs, tokens, fold, model: j.model, lastChars: lastText.length });
      const usage = { input_tokens: tokens, output_tokens: Math.round(text.length / 3.6), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      if (!j.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: `msg_${turn}`, type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: `msg_${turn}`, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      const words = text.match(/\S+\s*/g) ?? [text];
      let i = 0;
      const t = setInterval(() => { // about 40 words a second, as a fast model streams
        if (i < words.length) return ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: words[i++] } });
        clearInterval(t);
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
        ev('message_stop', {});
        res.end();
      }, 25);
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, close: () => server.close() })));
}
