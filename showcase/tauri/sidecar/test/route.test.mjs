// Local-only build, feature 23 stage 4: which model answers, decided by code (route.mjs).
import assert from 'node:assert/strict';
import { BACK_AGAIN, SWITCH_OFFLINE, SWITCH_PRIVATE, cantLocally, createAnnouncer, isNetworkError, privateAsk, routeFor } from '../route.mjs';

// ---- private: alone, a mode; at the start of a request, that request; "back to Claude" alone ends the mode
assert.deepEqual(privateAsk('Keep this private.'), { mode: true });
assert.deepEqual(privateAsk('um, private mode'), { mode: true });
assert.deepEqual(privateAsk('Back to Claude.'), { back: true });
assert.deepEqual(privateAsk('Keep this private: remind me at 5 to call the doctor.'), { request: 'remind me at 5 to call the doctor.' });
assert.deepEqual(privateAsk('Privately, add a to-do: book the clinic'), { request: 'add a to-do: book the clinic' });
assert.equal(privateAsk('Is this private?'), null);
assert.equal(privateAsk('Add a to-do: keep this private folder tidy'), null, 'only at the start');
assert.equal(privateAsk('Tell me about private schools'), null);
assert.equal(privateAsk('Go back to Claude and ask it something'), null, '"back to Claude" only alone');

// ---- where a request goes
const on = { address: 'http://127.0.0.1:8080/v1', whenOffline: true }, off = { address: '', whenOffline: true };
assert.equal(routeFor({ local: on }), 'claude');
assert.equal(routeFor({ offline: true, local: on }), 'local');
assert.equal(routeFor({ offline: true, local: { ...on, whenOffline: false } }), 'claude', 'local.whenOffline false: no switch');
assert.equal(routeFor({ offline: true, local: off }), 'claude', 'no local model: nothing to switch to');
assert.equal(routeFor({ privateMode: true, local: on }), 'local');
assert.equal(routeFor({ privateThis: true, local: on }), 'local');
assert.equal(routeFor({ privateMode: true, local: off }), 'none', 'private and no local model: nothing is sent anywhere');
assert.equal(routeFor({ privateThis: true, offline: false, local: off }), 'none');

// ---- a network error before any reply switches; a slow or failing provider doesn't
const err = (code, message = 'x', cause) => Object.assign(new Error(message), { code, cause });
assert.ok(isNetworkError(err('ENOTFOUND')));
assert.ok(isNetworkError(new TypeError('fetch failed', { cause: err('ECONNREFUSED') })));
assert.ok(isNetworkError(new Error('getaddrinfo ENOTFOUND api.anthropic.com')));
assert.ok(isNetworkError(new Error('The Internet connection appears to be offline.')));
assert.ok(!isNetworkError(err('ETIMEDOUT', 'timed out')), 'slow: no switch');
assert.ok(!isNetworkError(new Error('529 overloaded')));
assert.ok(!isNetworkError(new Error('401 unauthorized')));
assert.ok(!isNetworkError(Object.assign(new Error('aborted'), { name: 'AbortError' })));

// ---- never silent: the first local reply after a switch, and the first of Claude's after
const a = createAnnouncer();
assert.equal(a.before('claude'), '');
assert.equal(a.before('local', 'offline'), SWITCH_OFFLINE);
assert.equal(a.before('local', 'offline'), '', 'once per switch');
assert.equal(a.before('local', 'private'), SWITCH_PRIVATE, 'a new reason is said');
assert.equal(a.before('claude'), BACK_AGAIN);
assert.equal(a.before('claude'), '');

// ---- what the local model can't do, refused by code
for (const t of ['Ask pi to fix the tests', 'What is on my screen?', 'Take a screenshot', 'Draw a diagram of the cell cycle', 'Click the send button', 'Type this into Mail']) assert.match(cantLocally(t), /^That needs Claude: .+ can't be done with the local model\. Nothing was sent\.$/, t);
for (const t of ['Remind me at 5 to call home', 'What is on my calendar today?', 'Note down that the pie chart is wrong', 'Add a to-do: email Pia']) assert.equal(cantLocally(t), '', t);
console.log('route tests passed');
