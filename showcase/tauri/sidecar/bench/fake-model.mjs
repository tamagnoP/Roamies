// A stand-in for the AI provider on the loopback address: answers from the fixed script, and records how large each
// request was. Nothing is sent anywhere else.
import fs from 'node:fs';
import http from 'node:http';
import { REPLIES } from './script.mjs';

const lengthen = (t) => { const n = Number(process.env.REPLY_CHARS || 0); let out = t; while (out.length < n) out += ` ${t}`; return out; };

export function startModel({ onRequest = () => {} } = {}) {
  let turn = 0, asks = 0, prev = '', dumped = 0;
  const draw = Number(process.env.DRAW || 0);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body); } catch { /* not JSON */ }
      const sys = JSON.stringify(j.system ?? '').length, tools = JSON.stringify(j.tools ?? []).length, msgs = JSON.stringify(j.messages ?? []).length;
      const tokens = Math.round((sys + tools + msgs) / 3.6);
      const last = j.messages?.at(-1), lastText = typeof last?.content === 'string' ? last.content : (last?.content ?? []).map((p) => p.text ?? '').join(' ');
      const fold = /You compress the older part|summar/i.test(JSON.stringify(j.system ?? '').slice(0, 3000)) && !(j.tools?.length);
      // DRAW=<n>: every n-th request answers by calling the draw tool (two cards beside the window), so a drawing goes
      // up through the real sidecar and the reply after it is spoken with the drawing on screen.
      const hasResult = Array.isArray(last?.content) && last.content.some((p) => p.type === 'tool_result');
      const drawNow = draw && !fold && !hasResult && j.stream && j.tools?.some((t) => t.name === 'draw') && asks++ % draw === draw - 1;
      const text = fold ? JSON.stringify({ summary: 'The owner asked about the calendar, a report, a review, a grant deadline, a build and a draft, and was answered each time. Nothing is left open.', facts: [] }) : lengthen(REPLIES[turn++ % REPLIES.length]);
      // How much of this request the provider could reuse from the one before: the characters, from the start, that
      // are the same (instructions, tool definitions, then the messages in order). Counted, never kept beyond the next.
      // (a message's text is compared whether it came as a string or as one text part, and without the provider's
      // own reuse marks, which move from request to request)
      const plain = (v) => JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : k === 'content' && typeof x === 'string' ? [{ type: 'text', text: x }] : x));
      const whole = plain(j.tools ?? []) + plain(j.system ?? '') + plain(j.messages ?? []);
      let same = 0; if (!fold) { const n = Math.min(whole.length, prev.length); while (same < n && whole.charCodeAt(same) === prev.charCodeAt(same)) same++; prev = whole; }
      if (process.env.DUMP) fs.writeFileSync(`${process.env.DUMP}/${String(++dumped).padStart(4, '0')}.json`, JSON.stringify(j.messages, null, 1)); // the scripted conversation only
      const liveChars = (JSON.stringify(j.messages ?? []).match(/<live-state>[\s\S]*?<\/live-state>/g) ?? []).reduce((n, b) => n + b.length, 0);
      const liveCopies = (JSON.stringify(j.messages ?? []).match(/<live-state>/g) ?? []).length;
      onRequest({ path: req.url, stream: !!j.stream, messages: j.messages?.length ?? 0, sys, tools, msgs, tokens, fold, model: j.model, lastChars: lastText.length, reused: Math.round(same / 3.6), fresh: Math.round((whole.length - same) / 3.6), liveCopies, liveTokens: Math.round(liveChars / 3.6) });
      const usage = { input_tokens: tokens, output_tokens: Math.round(text.length / 3.6), cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      if (!j.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: `msg_${turn}`, type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: `msg_${turn}`, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
      if (drawNow) {
        const input = { beats: [{ say: 'Here is the plan for the afternoon.', marks: [{ type: 'card', title: 'Afternoon', heading: 'Two blocks', text: 'The report runs from two until half past three. The review follows at four.', items: ['Report, ninety minutes', 'Review at four', 'A call to return'] }, { type: 'note', text: 'The grant deadline is the twelfth of December.', tone: 'amber' }] }] };
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${turn}_${asks}`, name: 'draw', input: {} } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } });
        ev('message_stop', {});
        return res.end();
      }
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
