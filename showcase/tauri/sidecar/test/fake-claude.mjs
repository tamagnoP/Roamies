// Feature 34's run test on Claude's route (test/mask-cc-run.test.mjs): a stand-in for the claude program, loaded by the
// sidecar through ROAMIES_FAKE_CLAUDE in place of the SDK's query(). Like the program it gets the instructions, our
// tools over the MCP bridge, the request (with the earlier conversation when a session starts fresh) and the tool
// results; and like the program it keeps a transcript of each session under CLAUDE_CONFIG_DIR/projects/. Each run is
// also written to FAKE_CLAUDE_RECORD, one JSON line. Nothing reaches a network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { answerFor } from './mask-script.mjs';

const ev = (event, sid) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: sid });
let msgs = 0;

export function query({ prompt, options }) {
  const inputs = prompt[Symbol.asyncIterator]();
  const sid = options.resume ?? crypto.randomUUID();
  let rpc;
  const connect = async () => {
    const waiting = new Map();
    const transport = { onmessage: undefined, async send(msg) { waiting.get(msg.id)?.(msg); } };
    await options.mcpServers.gg.instance.connect(transport);
    let n = 0;
    return (method, params) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); transport.onmessage({ jsonrpc: '2.0', id, method, params }); });
  };
  const call = async (method, params) => { rpc ??= await connect(); return rpc(method, params); };
  const transcript = path.join(options.env.CLAUDE_CONFIG_DIR, 'projects', '-fake-home', `${sid}.jsonl`);
  const keep = (o) => { fs.mkdirSync(path.dirname(transcript), { recursive: true }); fs.appendFileSync(transcript, `${JSON.stringify(o)}\n`); };
  async function* text(t, model) {
    const id = `msg_${++msgs}`;
    yield ev({ type: 'message_start', message: { id, usage: { input_tokens: 40, cache_read_input_tokens: 0 } } }, sid);
    for (const w of t.match(/\S+\s*/g) ?? [t]) yield ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: w } }, sid);
    yield { type: 'assistant', parent_tool_use_id: null, message: { id, model, content: [{ type: 'text', text: t }] } };
    keep({ assistant: t });
    yield ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 40, output_tokens: 9 } }, sid);
    yield ev({ type: 'message_stop' }, sid);
  }
  async function* run() {
    const first = (await inputs.next()).value;
    const blocks = first?.message?.content ?? [];
    const system = options.systemPrompt?.prompt ?? '';
    const listed = options.mcpServers?.gg ? (await call('tools/list', {})).result.tools : [];
    const rec = { at: Date.now(), sid, resume: options.resume ?? null, system, tools: listed.map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema })), input: blocks, results: [] };
    keep({ system, input: blocks });
    yield { type: 'system', subtype: 'init', session_id: sid };
    const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text);
    const a = answerFor({ system, last: texts.at(-1) ?? '' });
    const model = options.model;
    if (a.tool) {
      const [name, args] = a.tool, id = `toolu_${++msgs}`, mid = `msg_${++msgs}`;
      yield ev({ type: 'message_start', message: { id: mid, usage: { input_tokens: 40 } } }, sid);
      yield ev({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } }, sid);
      yield { type: 'assistant', parent_tool_use_id: null, message: { id: mid, model, content: [{ type: 'tool_use', id, name: `mcp__gg__${name}`, input: args }] } };
      yield ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 40, output_tokens: 20 } }, sid);
      yield ev({ type: 'message_stop' }, sid);
      // test/settings-broken-tools-run.test.mjs: the settings file breaks between the model's step and the tool call
      if (process.env.FAKE_CLAUDE_BREAK && /plate scans/.test(texts.at(-1) ?? '')) fs.writeFileSync(process.env.FAKE_CLAUDE_BREAK, '{,\n');
      const got = await call('tools/call', { name, arguments: args, _meta: { 'claudecode/toolUseId': id } });
      const content = got.result?.content ?? [];
      rec.results.push(content); keep({ tool: name, args, result: content });
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } };
      yield* text(answerFor({ system, afterTool: name }).text, model);
    } else yield* text(a.text, model);
    if (process.env.FAKE_CLAUDE_RECORD) fs.appendFileSync(process.env.FAKE_CLAUDE_RECORD, `${JSON.stringify(rec)}\n`);
    yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: sid, modelUsage: {} };
  }
  return Object.assign(run(), { interrupt: async () => {}, close: () => {} });
}
