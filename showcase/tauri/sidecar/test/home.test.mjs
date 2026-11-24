// Local-only build: the character's home on the desktop. Run: npm test
//  1. the rule (showcase/roamies/home.js: where the home spot is), on its own;
//  2. the "home" setting (pi.mjs: loadSettings, homeFor).
// The overlay itself, at home: home-page.test.mjs (slow, npm run test:all).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { homeFor, loadSettings } from '../pi.mjs';

const ROOT = new URL('../../../', import.meta.url); // showcase/
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---- 1. the rule
{
  const window = { Roamie: {} };
  vm.runInNewContext(fs.readFileSync(new URL('roamies/home.js', ROOT), 'utf8'), { window, Math, Number });
  const { homeSpot, homeSetting } = window.Roamie;
  const spot = (...a) => Array.from(homeSpot(...a));
  // A 1440 x 900 screen with a 33 px menu bar and an 80 px Dock at the bottom; a body of radius 60.
  const B = { l: 0, t: 33, r: 1440, b: 820 }, r = 60;
  const whole = ([x, y], b = B) => x - r * 1.5 >= b.l && x + r * 1.5 <= b.r && y - r * 1.5 >= b.t && y + r * 1.5 <= b.b;

  assert.deepEqual(spot('bottom-left', B, r), [144, 706]);
  assert.deepEqual(spot('bottom-right', B, r), [1296, 706]);
  assert.deepEqual(spot('top-left', B, r), [144, 177]);
  assert.deepEqual(spot('top-right', B, r), [1296, 177]);
  for (const c of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) assert.ok(whole(spot(c, B, r)), `${c}: the whole body is on the visible screen`);
  // the default, and anything that isn't a corner or a point
  for (const bad of [undefined, null, '', 'middle', 7, [], {}, { x: 1 }, { x: '10', y: 20 }, { x: NaN, y: 2 }, { x: Infinity, y: 2 }]) assert.deepEqual(spot(bad, B, r), [144, 706], `${JSON.stringify(bad)} means bottom-left`);
  assert.deepEqual(spot(' Top-Right ', B, r), [1296, 177], 'capitals and spaces are forgiven');
  assert.equal(homeSetting('BOTTOM-RIGHT'), 'bottom-right'); assert.equal(homeSetting('nowhere'), 'bottom-left');
  assert.deepEqual({ ...homeSetting({ x: 5, y: 6, z: 7 }) }, { x: 5, y: 6 });

  // clear of the Dock wherever it is, and of the menu bar
  const dockLeft = { l: 90, t: 33, r: 1440, b: 900 }, dockRight = { l: 0, t: 33, r: 1350, b: 900 }, noDock = { l: 0, t: 33, r: 1440, b: 900 };
  assert.deepEqual(spot('bottom-left', dockLeft, r), [234, 786]);
  assert.deepEqual(spot('bottom-right', dockRight, r), [1206, 786]);
  assert.deepEqual(spot('bottom-left', noDock, r), [144, 786]);
  assert.ok(spot('top-left', B, r)[1] - r * 1.5 >= 33, 'below the menu bar');
  // the small size sits closer to the corner
  assert.deepEqual(spot('bottom-left', B, 30), [72, 763]);

  // coordinates: screen points, kept as given when the body fits there
  assert.deepEqual(spot({ x: 700, y: 400 }, B, r), [700, 400]);
  // ...and moved the least it takes to keep the body whole on the visible screen
  assert.deepEqual(spot({ x: 0, y: 0 }, B, r), [96, 141], 'not under the menu bar, not off the left edge');
  assert.deepEqual(spot({ x: 1440, y: 900 }, B, r), [1344, 730], 'not under the Dock, not off the right edge');
  assert.deepEqual(spot({ x: 700, y: 880 }, B, r), [700, 730], 'a point under the Dock lands just above it');
  assert.deepEqual(spot({ x: -5000, y: 99999 }, B, r), [96, 730]);
  for (const p of [{ x: 0, y: 0 }, { x: 1440, y: 900 }, { x: 3, y: 500 }, { x: 900, y: 34 }]) assert.ok(whole(spot(p, B, r)), `${JSON.stringify(p)}: whole on the visible screen`);
  // a second display to the right of the main one: its top-left corner is (1440, 0) in screen points
  const second = { x: 1440, y: 0 };
  assert.deepEqual(spot({ x: 2000, y: 400 }, B, r, second), [560, 400], 'screen points become this overlay\'s own');
  assert.deepEqual(spot({ x: 700, y: 400 }, B, r, second), [96, 400], 'a point on another display lands at the nearest edge of this one');
  assert.deepEqual(spot('bottom-left', B, r, second), [144, 706], 'a corner is this display\'s corner, whichever display it is');
  // a display above the main one has a negative origin
  assert.deepEqual(spot({ x: 300, y: -500 }, B, r, { x: 0, y: -900 }), [300, 400]);
  // a screen too small for the margins: the middle, never outside
  assert.deepEqual(spot('bottom-left', { l: 0, t: 0, r: 100, b: 100 }, r), [50, 50]);
  assert.deepEqual(spot({ x: 900, y: 900 }, { l: 0, t: 0, r: 100, b: 100 }, r), [50, 50]);
}

// ---- 2. the setting
{
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-setting-')));
  const file = path.join(home, 'Documents', 'roamies-pi', 'settings.json');
  assert.equal(loadSettings(home).home, 'bottom-left');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).home, 'bottom-left', 'a new settings file names it, with its default');
  const made = fs.readFileSync(file, 'utf8');
  const withHome = (v) => { fs.writeFileSync(file, JSON.stringify(v === undefined ? {} : { home: v })); return loadSettings(home).home; };
  assert.equal(withHome(undefined), 'bottom-left', 'a file from before the setting existed works as before');
  for (const c of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) assert.equal(withHome(c), c);
  assert.equal(withHome(' Top-Left '), 'top-left');
  assert.deepEqual(withHome({ x: 300, y: 120.5 }), { x: 300, y: 120.5 });
  assert.deepEqual(withHome({ x: -1200, y: 40, display: 2 }), { x: -1200, y: 40 }, 'only x and y are taken');
  for (const bad of ['centre', 3, true, null, [], [10, 20], {}, { x: 10 }, { x: '10', y: '20' }, { x: null, y: 2 }]) assert.equal(withHome(bad), 'bottom-left', `${JSON.stringify(bad)} means the default`);
  assert.deepEqual(homeFor(home), 'bottom-left');
  fs.writeFileSync(file, JSON.stringify({ home: 'top-right' })); assert.equal(homeFor(home), 'top-right');
  const before = fs.readFileSync(file, 'utf8');
  homeFor(home); loadSettings(home);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'reading the setting never writes the file');
  fs.writeFileSync(file, '{ not json'); assert.equal(homeFor(home), 'bottom-left', 'a broken file means the default, not an error');
  assert.ok(made.includes('"home"'));
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('home position tests (the rule and the setting): passed');
