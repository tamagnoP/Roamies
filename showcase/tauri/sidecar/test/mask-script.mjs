// Feature 34's run tests: what the stand-in provider answers (test/mask-run.test.mjs, the API route) and the stand-in
// claude program (test/fake-claude.mjs). It only ever sees stand-ins, so it answers with them: in its replies, and in
// the arguments of the tools it calls. Nothing here reaches a network.
export const FOLD = { summary: 'Person 2 asked Person 1 about Project 1 at Organisation 1, and it was noted.', facts: [{ text: 'Person 1 works with Person 2 on Project 1.' }] };
export const HANDOVER = 'Decided:\n- Person 2 gets the Project 1 figures.\nLeft open:\n- Send Person 2 the Project 1 draft.\nWorth remembering:\n- Organisation 1 meets on Friday.';
/** The answer to a request: { tool: [name, args] } or { text }. system: the instructions as sent; last: the newest
 *  text from the owner (or the app); afterTool: the name of the tool whose result is the newest message, if any. */
export function answerFor({ system = '', last = '', afterTool = null }) {
  if (/You compress the older part/.test(system)) return { text: JSON.stringify(FOLD) };
  if (/pick out what to remember/.test(system)) return { text: '{"facts": []}' };
  if (/end-of-day handover/.test(system)) return { text: HANDOVER };
  if (afterTool === 'write_note') return { text: 'Noted: Person 2 wants the Project 1 figures from Organisation 1.' };
  if (afterTool === 'read_note') return { text: 'It says Person 2 leads Project 1 at Organisation 1.' };
  if (afterTool === 'read_file') return { text: 'The file says Organisation 1 owns the Project 1 data.' };
  if (afterTool) return { text: 'Done.' };
  if (/Note that/.test(last)) return { tool: ['write_note', { title: 'Person 2 figures', content: 'Person 2 from Organisation 1 wants the Project 1 term 1 figures by Friday.' }] };
  if (/Project 1 plan/.test(last)) return { tool: ['read_note', { title: 'Project 1 plan' }] };
  if (/notes\.txt/.test(last)) return { tool: ['read_file', { path: 'notes.txt' }] };
  if (/Term 2/.test(last)) return { text: 'Sure. Term 2 is noted, with Person 2 and Organisation 1.' };
  return { text: 'Sure. Person 2 and Organisation 1 are on it.' };
}
