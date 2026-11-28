// Setup guide: Welcome → Permissions → Connect AI → Replies → Shortcuts → Find me.
// The orb (roamies/orb.js) lives on the left: it comes in on each step, moves beside what needs doing, says a short
// line, and shows that it listens when you test your voice. Feature 21: no look, size, chat, drawing demo or tour.
// Talks to the app through Tauri commands; opened in a plain browser it runs a simulated preview instead.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const invoke = window.__TAURI__?.core?.invoke ?? preview();
  const send = (msg) => invoke('sidecar_send', { msg }).catch(() => {});

  // ---------------------------------------------------------------- the orb
  const canvas = $('roamie'), ctx = canvas.getContext('2d'), quipEl = $('quip'), tailEl = $('quip-tail');
  const HOME = { x: 150, y: 330 };
  let W = innerWidth, H = innerHeight, dpr = 1, K = null, clock = 0, poseFn = null;
  const env = {
    w: W, h: H, dpr, t: 0, unit: 330, transparent: true, spawn: { ...HOME },
    safe: { left: 30, right: W - 290, top: 70, bottom: 50 },
    mouse: { x: 0, y: 0, inside: false, active: false }, sleepy: 0, reduced: reduced.matches,
  };
  const sidekick = Roamie.orbKit({
    id: 'guide', label: 'Guide',
    // pose: the orb's state for the current step (thinking while it waits on a sign-in, listening while you test
    // your voice); null at rest.
    plugin: (kit) => { K = kit; return { busy: () => true, pose: () => poseFn?.(clock) ?? null }; },
  }).create(env);
  sidekick.setSize(96);
  const m = sidekick.mover;
  sidekick.vanish(null, true);

  const POSE = {
    point: () => () => null,
    think: () => () => ({ mode: 'think' }),
    listen: () => () => ({ mode: 'listen', heard: voice.level }),
    wait: () => () => null,
  };
  function moveTo(x, y) {
    y = clamp(y, 150, H - 100);
    m.anchor = { x, y, r: 6 };
    if (!sidekick.hidden) m.goTo(x, y);
  }
  // Swap in for a new step: leave the old spot with the step's exit, arrive with its entrance.
  const OUT = { materialize: 'crt', crt: 'materialize', drop: 'materialize' };
  let entering = 0;
  async function enter(variant, y = HOME.y) {
    const my = ++entering;
    y = clamp(y, 150, H - 100);
    m.anchor = { x: HOME.x, y, r: 6 };
    if (!sidekick.hidden && !reduced.matches) {
      sidekick.vanish(OUT[variant]);
      await wait(620);
      if (my !== entering) return;
    } else if (!sidekick.hidden) sidekick.vanish(null, true);
    sidekick.appear(reduced.matches ? 'crt' : variant, HOME.x, y);
  }

  // Short speech bubble above the head, typed out with the Sidekick's voice blips.
  let quipText = '', quipShown = 0, quipUntil = 0;
  function quip(text, secs = 2.4) {
    quipText = text; quipShown = 0; quipUntil = clock + secs + text.length * 0.035;
    quipEl.textContent = '';
    quipEl.classList.add('on');
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now; clock += dt; env.t += dt; env.reduced = reduced.matches;
    // Eyes follow the cursor; when it's outside the window, they rest on the panel instead of wandering.
    // While the drawing demo runs, they watch its cursor instead.
    if (!env.mouse.active) Object.assign(env.mouse, { ...(penDemo.eye ?? { x: 520, y: m.y - 20 }), inside: true, active: true, idle: true });
    sidekick.update(dt, env);
    if (env.mouse.idle) Object.assign(env.mouse, { active: false, idle: false });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save(); sidekick.draw(ctx, env); ctx.restore();
    if (quipText) {
      if (quipShown < quipText.length) {
        const before = Math.floor(quipShown);
        quipShown = Math.min(quipText.length, quipShown + dt * 42);
        const n = Math.floor(quipShown);
        if (n !== before) quipEl.textContent = quipText.slice(0, n);
      }
      if (clock > quipUntil) { quipEl.classList.remove('on'); if (clock > quipUntil + 0.3) quipText = ''; }
      // The line sits just above the orb, its tail pointing at it.
      const qx = clamp(m.x, 125, W - 125), qy = m.y - (K?.R ?? 50) * 1.45 - 6;
      quipEl.style.left = `${qx}px`; quipEl.style.top = `${qy}px`;
      tailEl.style.left = `${clamp(m.x, qx - 100, qx + 100)}px`; tailEl.style.top = `${qy - 0.5}px`;
    }
    voice.drawMeter(dt);
    penDemo.draw(dt);
    requestAnimationFrame(frame);
  }
  function resize() {
    W = innerWidth; H = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    Object.assign(env, { w: W, h: H, dpr });
    env.safe.right = W - 290;
    sidekick.resize(env);
  }
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { Object.assign(env.mouse, { x: e.clientX, y: e.clientY, inside: true, active: true }); }, { passive: true });
  document.addEventListener('mouseleave', () => { env.mouse.active = false; });
  resize();
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- shared bits
  let state = null, cur = -1;
  const led = (mode = 'on') => el('i', { className: `led ${mode}`, ariaHidden: 'true' });
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; };
  const okMark = (label) => el('span', { className: 'status' }, led(), label);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const CHEERS = ['Got it!', 'Nice!', 'Perfect.', 'Yes!'];
  const isMac = () => state?.platform === 'darwin';
  const isLinux = () => state?.platform === 'linux';
  // Wayland: no app may hold shortcuts, so these are the commands to bind in the desktop's settings (else null).
  const bind = () => state?.bind ?? null;
  const thisPC = () => (isLinux() ? 'this computer' : 'this PC');
  // Ask About an Area and circling while talking: macOS and Windows (the sidecar says which this computer has).
  const canSnap = () => state?.snap ?? isMac();
  const canCircle = () => state?.circle ?? isMac();
  const at = (name) => STEPS[cur]?.name === name;

  // Keycaps for shortcuts: Apple's symbols and order on a Mac, the key names on Windows and Linux.
  const MAC_MOD = { control: '⌃', option: '⌥', shift: '⇧', command: '⌘' };
  const PC_MOD = { control: 'Ctrl', option: 'Alt', shift: 'Shift', command: 'Win' };
  const LINUX_MOD = { ...PC_MOD, command: 'Super' };
  const MOD = new Proxy({}, { get: (_, k) => (isMac() ? MAC_MOD : isLinux() ? LINUX_MOD : PC_MOD)[k] });
  const ORDER = ['control', 'option', 'shift', 'command'];
  const ACC_MOD = { Control: 'control', Alt: 'option', Shift: 'shift', Command: 'command' };
  const keyLabel = (code) => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '') .replace('Backquote', '`').replace('Minus', '-').replace('Equal', '=').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Backslash', '\\').replace('Semicolon', ';').replace('Quote', "'").replace('Comma', ',').replace('Period', '.').replace('Slash', '/');
  const capsFor = (mods, key) => [...[...mods].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((x) => MOD[x]), ...(key ? [keyLabel(key)] : [])];
  const accelCaps = (accel) => { const parts = accel.split('+'); return capsFor(parts.slice(0, -1).map((p) => ACC_MOD[p]), parts.at(-1)); };
  const TRAY_SVG = '<svg class="trayicon" viewBox="0 0 36 36" aria-hidden="true" fill="currentColor"><rect x="30" y="3" width="2" height="2"/><rect x="27" y="6" width="2" height="2"/><rect x="30" y="6" width="2" height="2"/><rect x="33" y="6" width="2" height="2"/><rect x="30" y="9" width="2" height="2"/><rect x="6" y="12" width="2" height="2"/><rect x="9" y="12" width="2" height="2"/><rect x="12" y="12" width="2" height="2"/><rect x="15" y="12" width="2" height="2"/><rect x="3" y="15" width="2" height="2"/><rect x="6" y="15" width="2" height="2"/><rect x="9" y="15" width="2" height="2"/><rect x="12" y="15" width="2" height="2"/><rect x="15" y="15" width="2" height="2"/><rect x="18" y="15" width="2" height="2"/><rect x="0" y="18" width="2" height="2"/><rect x="3" y="18" width="2" height="2"/><rect x="9" y="18" width="2" height="2"/><rect x="12" y="18" width="2" height="2"/><rect x="18" y="18" width="2" height="2"/><rect x="21" y="18" width="2" height="2"/><rect x="0" y="21" width="2" height="2"/><rect x="3" y="21" width="2" height="2"/><rect x="9" y="21" width="2" height="2"/><rect x="12" y="21" width="2" height="2"/><rect x="18" y="21" width="2" height="2"/><rect x="21" y="21" width="2" height="2"/><rect x="0" y="24" width="2" height="2"/><rect x="3" y="24" width="2" height="2"/><rect x="6" y="24" width="2" height="2"/><rect x="9" y="24" width="2" height="2"/><rect x="12" y="24" width="2" height="2"/><rect x="15" y="24" width="2" height="2"/><rect x="18" y="24" width="2" height="2"/><rect x="21" y="24" width="2" height="2"/><rect x="3" y="27" width="2" height="2"/><rect x="6" y="27" width="2" height="2"/><rect x="9" y="27" width="2" height="2"/><rect x="12" y="27" width="2" height="2"/><rect x="15" y="27" width="2" height="2"/><rect x="18" y="27" width="2" height="2"/><rect x="6" y="30" width="2" height="2"/><rect x="9" y="30" width="2" height="2"/><rect x="12" y="30" width="2" height="2"/><rect x="15" y="30" width="2" height="2"/></svg>';
  const capsEl = (caps) => { const s = el('span', { className: 'caps' }); for (const c of caps) s.append(el('kbd', { className: 'px cap', textContent: c })); return s; };
  const fillCaps = (node, caps) => { node.replaceChildren(...caps.map((c) => el('kbd', { className: 'px cap', textContent: c }))); };

  // ---------------------------------------------------------------- step 1: permissions
  const perms = {
    sys: { mic: 'unknown', speech: 'granted', speechNeeded: false, screen: 'unknown', accessibility: 'unknown' },
    files: { Desktop: 'unknown', Documents: 'unknown', Downloads: 'unknown' },
    asked: {}, waiting: null, poll: null, since: 0, seen: new Set(), guiding: null,
    // Screen Recording only turns green after one test screenshot works: idle → checking → ok | failed.
    shot: 'idle',
    rows() {
      // Windows: nothing to grant, but voice needs its speech model (downloaded once) and an unblocked mic.
      if (!isMac()) {
        const vm = state?.voiceModel;
        if (!state?.voice || !vm) return [];
        return [
          { id: 'mic', title: 'Microphone', desc: this.sys.input === false ? 'No microphone found yet. Plug one in.' : 'So you can talk to me.', pane: 'privacy-microphone' },
          { id: 'voice', title: 'My voice', desc: vm.status === 'error' ? vm.error : vm.status === 'downloading' ? `Downloading ${vm.size}. You can keep going.` : vm.status === 'ready' ? `Speech stays on ${thisPC()}.` : `One-time download, ${vm.size}. Speech stays on this PC.` },
        ];
      }
      return [
        { id: 'mic', title: 'Microphone', desc: 'So you can talk to me.', pane: 'Privacy_Microphone' },
        ...(this.sys.speechNeeded ? [{ id: 'speech', title: 'Speech recognition', desc: 'Turns your voice into text.', pane: 'Privacy_SpeechRecognition' }] : []),
        { id: 'screen', title: 'Screen recording', pane: 'Privacy_ScreenCapture', bad: this.shot === 'failed',
          desc: this.shot === 'failed' ? "Can't see yet. Reopen me." : this.shot === 'checking' ? 'Taking one test screenshot.' : 'So I can see your screen.' },
        { id: 'accessibility', title: 'Control apps', desc: 'Fill in forms and click for you.', pane: 'Privacy_Accessibility' },
        { id: 'files', title: 'Your files', desc: 'Desktop, Documents, Downloads.', pane: 'Privacy_FilesAndFolders' },
      ];
    },
    status(id) {
      if (id === 'files') {
        const v = Object.values(this.files);
        return v.every((s) => s === 'granted') ? 'granted' : v.some((s) => s === 'denied') ? 'denied' : 'unknown';
      }
      if (id === 'voice') return state?.voiceModel?.status === 'ready' ? 'granted' : 'unknown';
      if (id === 'screen' && this.sys.screen === 'granted') return this.shot === 'ok' ? 'granted' : 'unknown';
      return this.sys[id] ?? 'unknown';
    },
    // A voice download that's under way counts: it carries on after the guide closes.
    done() { return this.rows().every((r) => this.status(r.id) === 'granted' || (r.id === 'voice' && state.voiceModel.status === 'downloading')); },
    async allow(r) {
      if (r.id === 'voice') { send({ type: 'ob_voice_model' }); quip('Downloading! Keep going', 3); return; }
      this.waiting = r.id; this.asked[r.id] = true; this.render();
      poseFn = POSE.point(1.7, -0.1);
      if (r.id === 'files') { quip('Click OK when it asks!'); send({ type: 'ob_files', request: true }); return; }
      if (r.id === 'screen' || r.id === 'accessibility') {
        // Straight to the Settings pane, skipping macOS's "Open System Settings?" dialog; the panel under
        // Settings has my icon to drag into the list. Screen Recording only counts after a relaunch.
        this.waiting = null;
        this.openSettings(r);
        quip('Drag me into the list!', 5);
        this.render();
        return;
      }
      quip('Click Allow when it asks!');
      const res = await invoke('perm_request', { kind: r.id });
      this.apply(res);
      if (this.waiting === r.id) this.waiting = null;
      this.render();
      // macOS hands focus back to whatever app was in front before its dialog, burying the guide.
      invoke('focus_guide').catch(() => {});
    },
    // Drag-me-in panel under System Settings (macOS), for the pane that's being switched on.
    guide(kind) { this.guiding = kind; invoke('perm_guide', { kind }).catch(() => {}); },
    unguide() { if (!this.guiding) return; this.guiding = null; invoke('perm_guide', { kind: null }).catch(() => {}); },
    openSettings(r) { invoke('open_settings', { pane: r.pane }); if (r.id === 'screen' || r.id === 'accessibility') this.guide(r.id); },
    apply(res) {
      if (!res || res.unsupported || res.error) return;
      for (const k of ['mic', 'speech', 'screen', 'accessibility']) if (res[k]) this.sys[k] = res[k];
      this.sys.speechNeeded = !!res.speechNeeded;
      if (typeof res.input === 'boolean') this.sys.input = res.input;
      this.checkShot();
    },
    async checkShot() {
      if (!isMac() || this.shot !== 'idle' || this.sys.screen !== 'granted') return;
      this.shot = 'checking'; this.render();
      const res = await invoke('screen_check').catch(() => null);
      this.shot = res?.seen || res?.unsupported ? 'ok' : 'failed';
      if (this.shot === 'failed' && at('perms')) { quip('Switch me on, then Reopen', 5); }
      this.render();
    },
    applyFiles(status) {
      this.files = { ...this.files, ...status };
      if (this.waiting === 'files') { this.waiting = null; invoke('focus_guide').catch(() => {}); }
    },
    render() {
      const list = $('perm-rows');
      const rows = this.rows();
      $('perm-lead').textContent = isMac() ? 'Only used when you ask me something.' : rows.length ? `One download so I can hear you. Your voice never leaves ${thisPC()}.` : 'Nothing to allow here. Just one choice below.';
      const firstPending = rows.find((r) => this.status(r.id) !== 'granted');
      list.replaceChildren(...rows.map((r) => {
        const st = this.status(r.id);
        let side;
        if (r.id === 'voice' && st === 'granted') side = okMark('Ready');
        else if (r.id === 'voice' && state.voiceModel.status === 'downloading') side = dlMeter(state.voiceModel);
        else if (r.id === 'voice') side = el('button', { className: `px btn ${state.voiceModel.status === 'error' ? 'ghost' : 'primary'}`, type: 'button', textContent: state.voiceModel.status === 'error' ? 'Retry' : 'Download', onclick: () => this.allow(r) });
        else if (r.id === 'screen' && this.shot === 'checking') side = el('span', { className: 'waiting', textContent: 'Checking…' });
        else if (r.id === 'screen' && this.shot === 'failed') side = el('span', { className: 'pair' },
          el('button', { className: 'px btn ghost', type: 'button', textContent: 'Reopen', onclick: () => { quip('Be right back!'); setTimeout(() => invoke('relaunch'), 400); } }),
          el('button', { className: 'px btn primary', type: 'button', textContent: 'Try again', onclick: () => { this.shot = 'idle'; this.checkShot(); } }));
        else if (st === 'granted') side = okMark(this.asked[r.id] || !isMac() ? 'Allowed' : 'Already allowed');
        else if (this.waiting === r.id) side = el('span', { className: 'waiting', textContent: 'Waiting for you…' });
        else if (r.id === 'screen' && this.asked.screen) side = el('span', { className: 'pair' },
          el('button', { className: 'px btn ghost', type: 'button', textContent: 'Settings', onclick: () => { this.openSettings(r); quip('Switch on Roamies'); } }),
          el('button', { className: 'px btn primary', type: 'button', textContent: 'Reopen', onclick: () => { quip('Be right back!'); setTimeout(() => invoke('relaunch'), 400); } }));
        else if (st === 'denied' || this.asked[r.id]) side = el('button', { className: 'px btn ghost', type: 'button', textContent: 'Open Settings', onclick: () => { this.openSettings(r); quip(isMac() ? 'Switch Roamies on!' : 'Turn on desktop apps!', 4); } });
        else if (!isMac()) side = el('span', { className: 'waiting', textContent: 'Checking…' });
        else side = el('button', { className: 'px btn primary', type: 'button', textContent: 'Allow', onclick: () => this.allow(r) });
        const li = el('li', { className: `px row${st === 'granted' ? ' granted' : r === firstPending ? ' focus' : ''}`, id: `perm-${r.id}` },
          el('div', {}, el('h2', { textContent: r.title }), el('p', { textContent: r.desc, title: r.desc, className: r.bad || (r.id === 'voice' && state.voiceModel.status === 'error') ? 'bad' : '' })), side);
        return li;
      }));
      // Not an OS permission, but the agent's other half: settle it here too.
      const sw = el('button', { className: 'px switch', type: 'button', role: 'switch' });
      sw.setAttribute('aria-checked', String(!!state?.actions));
      sw.setAttribute('aria-label', 'Let me edit files and run commands');
      sw.onclick = () => { const on = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(on)); send({ type: 'set_actions', on }); if (on) { quip("I'll be careful!"); } };
      list.append(el('li', { className: 'px row' },
        el('div', {}, el('h2', { textContent: 'Edit files and run commands' }), el('p', { textContent: 'Off: I can look, never change.' })), sw));
      // Only an installed copy can start at login, so the row is hidden otherwise (login is null).
      if (state?.login != null) {
        const ls = el('button', { className: 'px switch', type: 'button', role: 'switch' });
        ls.setAttribute('aria-checked', String(!!state.login));
        ls.setAttribute('aria-label', 'Open Roamies at login');
        ls.onclick = () => { const on = ls.getAttribute('aria-checked') !== 'true'; ls.setAttribute('aria-checked', String(on)); send({ type: 'set_login', on }); if (on) quip("See you every morning!"); };
        list.append(el('li', { className: 'px row' },
          el('div', {}, el('h2', { textContent: 'Open at login' }), el('p', { textContent: 'Start with your computer.' })), ls));
      }

      if (this.guiding && this.status(this.guiding) === 'granted') this.unguide();

      const screenStuck = isMac() && this.asked.screen && this.status('screen') !== 'granted';
      if (screenStuck && !this.hinted && this.waiting !== 'screen') { this.hinted = true; setTimeout(() => at('perms') && quip('Switched me on? Hit Reopen', 5), 6000); }

      // Cheer for anything that just turned green.
      for (const r of rows) {
        const g = this.status(r.id) === 'granted';
        if (g && !this.seen.has(r.id)) { this.seen.add(r.id); if (at('perms') && this.since && clock - this.since > 0.8) { quip(pick(CHEERS)); } }
      }
      if (at('perms')) {
        if (firstPending && this.waiting == null) { poseFn = POSE.point(1.7, -0.1); aim($(`perm-${firstPending.id}`)); }
        else if (!firstPending) { poseFn = null; moveTo(HOME.x, HOME.y); }
      }
      nav();
    },
    enter() {
      perms.since = clock;
      // Allow was tapped in an earlier run: the folders can be read (no prompt), so check them now.
      if (state?.filesAsked) perms.asked.files = true;
      for (const r of perms.rows()) if (perms.status(r.id) === 'granted') perms.seen.add(r.id);
      perms.render();
      // Hint after the first status check, so it matches what's actually left to allow.
      setTimeout(() => {
        if (!at('perms')) return;
        const left = perms.rows().filter((r) => perms.status(r.id) !== 'granted').length;
        if (!isMac()) quip(left === 0 ? 'Already sorted!' : perms.status('mic') === 'denied' ? 'Unblock the mic' : 'Grab my voice!');
        else quip(left === 0 ? 'Already sorted!' : left === 1 ? 'Just one to allow' : 'Tap Allow on each one');
      }, 900);
      const tick = async () => {
        perms.apply(await invoke('perm_status'));
        // Probe folders only after Allow was tapped (now or in an earlier run): the first read is the permission prompt.
        if (perms.asked.files) send({ type: 'ob_files', request: false });
        perms.render();
      };
      tick();
      perms.poll = setInterval(tick, 1500);
    },
    leave() { clearInterval(perms.poll); perms.poll = null; poseFn = null; perms.unguide(); },
    // Download progress updates the meter in place; rebuilding the rows would steal keyboard focus.
    progress() {
      const meter = document.querySelector('#perm-voice .dl');
      if (meter && state.voiceModel.status === 'downloading') fillMeter(meter, state.voiceModel);
      else this.render();
    },
  };
  // Download meter: ten LED segments like the step bar. The percentage is for sighted users; screen
  // readers get the progressbar value, so the live list isn't re-announced on every tick.
  const pctOf = (vm) => Math.min(100, Math.floor((vm.done / (vm.total || 1)) * 100));
  function fillMeter(meter, vm) {
    const pct = pctOf(vm);
    [...meter.children].forEach((seg, i) => seg.classList.toggle('on', i < Math.round(pct / 10)));
    meter.setAttribute('aria-valuenow', String(pct));
    meter.nextElementSibling.textContent = `${pct}%`;
  }
  function dlMeter(vm) {
    const meter = el('span', { className: 'dl', role: 'progressbar' }, ...Array.from({ length: 10 }, () => el('i')));
    meter.setAttribute('aria-label', 'Voice download');
    meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
    const wrap = el('span', { className: 'dl-wrap' }, meter, el('span', { className: 'waiting dl-pct', ariaHidden: 'true' }));
    fillMeter(meter, vm);
    return wrap;
  }
  // Line the Sidekick up with a row so it points right at it.
  function aim(node) {
    if (!node) return;
    const r = node.getBoundingClientRect();
    moveTo(HOME.x, r.top + r.height / 2 + 6);
  }

  // ---------------------------------------------------------------- step 2: connect AI
  // Sign-in cards, or (Use an API key instead) a card per key provider with a field for its key. A sign-in can
  // always be cancelled (click its card again) or swapped for another (click that one), and gives up after
  // 3 minutes, so a browser tab closed halfway never leaves it stuck on "Waiting".
  const LOGIN_MS = 3 * 60_000;
  const ai = {
    busy: null, loginId: null, status: '', timer: null, mode: 'signin', key: null, keyBusy: null,
    render() {
      $('ai-lead').textContent = ai.mode === 'key' ? 'Pick where your key is from, then paste it.' : "Sign in with an AI account you have. Using GG Coder? You're already in.";
      $('providers').hidden = ai.mode !== 'signin';
      $('key-providers').hidden = ai.mode !== 'key';
      $('key-toggle').textContent = ai.mode === 'key' ? 'Sign in instead' : 'Use an API key instead';
      $('providers').replaceChildren(...(state?.oauth ?? []).map((p) => {
        const busy = ai.busy === p.id;
        const b = el('button', { className: `px prov${p.connected ? ' on' : ''}${busy ? ' busy' : ''}`, type: 'button' },
          el('span', { textContent: p.name }), led(p.connected ? 'on' : busy ? 'busy' : ''),
          el('small', { textContent: busy ? ai.waitText() : p.connected ? 'Connected' : p.company }));
        if (busy) b.setAttribute('aria-label', `${p.name}: ${ai.waitText()}. Click to cancel.`);
        b.onclick = () => (busy ? ai.cancel() : ai.login(p));
        return b;
      }));
      $('key-providers').replaceChildren(...(state?.apikey ?? []).map((p) => {
        const busy = ai.keyBusy === p.id;
        // One line each, so fourteen fit with the key field under them: the light says Connected (and the field's label).
        const b = el('button', { className: `px prov${p.connected ? ' on' : ''}${busy ? ' busy' : ''}`, type: 'button', title: p.connected ? `${p.name}: connected` : '' },
          el('span', { textContent: p.name }), led(p.connected ? 'on' : busy ? 'busy' : ''));
        b.setAttribute('aria-label', `${p.name}${busy ? ', checking the key' : p.connected ? ', connected' : ''}`);
        b.setAttribute('aria-pressed', String(ai.key === p.id));
        b.onclick = () => ai.pickKey(p);
        return b;
      }));
      const k = (state?.apikey ?? []).find((p) => p.id === ai.key);
      $('key-form').hidden = ai.mode !== 'key' || !k;
      if (k) {
        $('key-label').textContent = k.connected ? `${k.name} is connected. Paste a new key to replace it` : `Paste your ${k.name} API key`;
        $('key-link').hidden = !k.link;
        $('key-link').setAttribute('aria-label', `Get a ${k.name} API key (opens your browser)`);
        $('key-save').disabled = !!ai.keyBusy;
      }
      nav();
    },
    // What the waiting card says: Claude's download progress, else how to get out of it.
    waitText() {
      const st = ai.status, pct = /(\d+)%/.exec(st)?.[1], mb = /(\d+) MB/.exec(st)?.[1];
      if (/^Downloading/.test(st)) return pct ? `Downloading ${pct}%` : mb ? `Downloading ${mb} MB` : 'Downloading…';
      if (/^Checking/.test(st)) return 'Checking download…';
      if (/^Unpacking/.test(st)) return 'Unpacking…';
      return 'Waiting… click to cancel';
    },
    login(p) {
      if (ai.busy) ai.stop();
      ai.busy = p.id; ai.status = ''; ai.loginId = `g${Date.now().toString(36)}`;
      $('login-error').hidden = true; ai.render();
      poseFn = POSE.think();
      quip(p.id === 'anthropic' ? 'Claude takes a minute' : "Sign in there. I'll wait!", 3.2);
      send({ type: 'ob_login', provider: p.id, id: ai.loginId });
      ai.arm();
    },
    // The 3 minutes restart whenever there's progress (Claude's one-time download can take a while).
    arm() { clearTimeout(ai.timer); ai.timer = setTimeout(() => ai.cancel('Took too long. Try again?'), LOGIN_MS); },
    stop() {
      clearTimeout(ai.timer);
      if (ai.loginId) send({ type: 'ob_login_cancel', id: ai.loginId });
      ai.busy = null; ai.loginId = null; ai.status = ''; poseFn = null;
      askId = null; $('code-form').hidden = true;
    },
    cancel(why) {
      if (!ai.busy) return;
      ai.stop();
      if (why) { const e = $('login-error'); e.hidden = false; e.textContent = e.title = why; quip('Hmm. Try again?'); }
      else quip('Okay, stopped.');
      ai.render();
    },
    pickKey(p) {
      ai.key = p.id; $('login-error').hidden = true; ai.render();
      $('key-input').focus();
    },
    onLogin(msg) {
      // A key save has no id; a sign-in's messages carry the one this guide gave it. Older attempts are ignored.
      if (msg.id == null ? ai.keyBusy !== msg.provider : msg.id !== ai.loginId) return;
      if (msg.phase === 'browser') return;
      if (msg.phase === 'status') { ai.status = String(msg.text ?? ''); ai.arm(); ai.render(); return; }
      clearTimeout(ai.timer);
      ai.busy = null; ai.loginId = null; ai.status = ''; ai.keyBusy = null; poseFn = null;
      if (msg.phase === 'done') { quip('Ooh, a brain!'); $('code-form').hidden = true; }
      else { const e = $('login-error'); e.hidden = false; e.textContent = e.title = `That didn't work: ${msg.error}`; quip('Hmm. Try again?'); }
      ai.render();
    },
    enter() {
      ai.render();
      setTimeout(() => at('ai') && quip(state?.connected ? 'Already connected!' : 'Pick one you have'), 700);
      if (!state?.connected) poseFn = POSE.point(1.7, 0.05);
      aim($('providers'));
    },
    // A sign-in carries on after leaving the step; it's only cancelled by the card or the timeout.
    leave() { if (!ai.busy) poseFn = null; },
  };
  let askId = null;
  $('code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('code-input').value.trim();
    if (!v || !askId) return;
    send({ type: 'answer', id: askId, text: v });
    askId = null; $('code-form').hidden = true; $('code-input').value = '';
  });
  $('key-toggle').addEventListener('click', () => {
    ai.mode = ai.mode === 'key' ? 'signin' : 'key';
    $('login-error').hidden = true;
    ai.render();
    $(ai.mode === 'key' ? 'key-providers' : 'providers').querySelector('button')?.focus();
  });
  $('key-link').addEventListener('click', () => {
    const k = (state?.apikey ?? []).find((p) => p.id === ai.key);
    if (k?.link) { send({ type: 'open_link', url: k.link }); quip('Copy it, then paste here'); }
  });
  $('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = $('key-input').value.trim();
    if (!key || !ai.key) return $('key-input').focus();
    ai.keyBusy = ai.key; ai.render();
    poseFn = POSE.think();
    send({ type: 'ob_apikey', provider: ai.key, key });
    $('key-input').value = '';
  });

  // ---------------------------------------------------------------- step 3: how replies come
  // Text only, or Voice + text (spoken with Fish Audio). Voice needs the user's own Fish Audio key: picking it
  // opens the field, and the key is checked before voice turns on.
  // Ken's Fish Audio affiliate link (sign-up lands on their site; keys are under Developers). It's disclosed in
  // the UI: the #fish-link button in index.html reads "Get a free key (affiliate link)".
  const FISH_URL = 'https://fish.audio/?fpr=o3gtlu';
  const replies = {
    pick: null, saving: false, changing: false, // changing: replacing a key that's already saved
    mode: () => replies.pick ?? (state?.replies === 'voice' ? 'voice' : 'text'),
    ready: () => replies.mode() === 'text' || (!!state?.fishKey && state.replies === 'voice'),
    render() {
      const mode = replies.mode(), on = state?.replies === 'voice' && state?.fishKey;
      const CARDS = [
        ['text', 'Text only', 'Answers in my bubbles'],
        ['voice', 'Voice + text', on ? 'Voice is on' : mode === 'voice' ? "Needs a Mac's own voice" : 'Said out loud too'],
      ];
      $('replies').replaceChildren(...CARDS.map(([id, name, sub]) => {
        const checked = mode === id;
        const b = el('button', { className: `px prov${id === 'voice' && on ? ' on' : ''}`, type: 'button', role: 'radio', tabIndex: checked ? 0 : -1 },
          el('span', { textContent: name }), led(checked ? 'on' : ''), el('small', { textContent: sub }));
        b.setAttribute('aria-checked', String(checked));
        b.onclick = () => replies.choose(id);
        return b;
      }));
      const saved = !!state?.fishKey;
      if (!saved || mode !== 'voice') replies.changing = false;
      $('fish-form').hidden = true; // local-only build: no key to paste (the form, its link and its note name Fish Audio)
      $('fish-change').hidden = true; // local-only build: the Mac's own voice, no key to change
      $('fish-change').textContent = replies.changing ? 'Keep my current key' : 'Change key';
      $('fish-label').textContent = replies.changing ? 'New Fish Audio API key' : 'Fish Audio API key';
      $('fish-change').setAttribute('aria-expanded', String(replies.changing));
      $('fish-save').disabled = replies.saving;
      $('fish-save').textContent = replies.saving ? 'Checking…' : 'Save';
      nav();
    },
    choose(id) {
      if (replies.mode() === id && (id === 'text' || state?.replies === 'voice')) return;
      replies.pick = id; $('fish-error').hidden = true;
      if (id === 'text' || state?.fishKey) {
        if (state?.replies === id) quip(id === 'text' ? 'Text it is!' : 'Voice it is!');
        send({ type: 'ob_replies', mode: id });
      }
      replies.render();
      if (id === 'voice' && !state?.fishKey) { $('fish-input').focus(); quip('Voice needs a Mac', 3); }
    },
    onFish(msg) {
      replies.saving = false;
      if (msg.ok) { $('fish-error').hidden = true; replies.changing = false; }
      else { const e = $('fish-error'); e.hidden = false; e.textContent = e.title = msg.error || "That key didn't work."; }
      replies.render();
    },
    enter() {
      replies.render();
      poseFn = POSE.point(1.7, 0.05);
      aim($('replies'));
      setTimeout(() => at('voice') && quip('Should I talk out loud?', 3), 700);
    },
    leave() { poseFn = null; },
  };
  $('replies').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = replies.mode() === 'text' ? 'voice' : 'text';
    replies.choose(next);
    requestAnimationFrame(() => $('replies').children[next === 'text' ? 0 : 1]?.focus());
  });
  $('fish-change').addEventListener('click', () => {
    replies.changing = !replies.changing; $('fish-error').hidden = true; $('fish-input').value = '';
    replies.render();
    if (replies.changing) $('fish-input').focus();
  });
  $('fish-link').addEventListener('click', () => { send({ type: 'open_link', url: FISH_URL }); quip('Copy it, then paste here'); });
  $('fish-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = $('fish-input').value.trim();
    if (!key || replies.saving) return $('fish-input').focus();
    replies.saving = true; $('fish-error').hidden = true; replies.render();
    poseFn = POSE.think();
    send({ type: 'ob_fishkey', key });
    $('fish-input').value = '';
  });

  // ---------------------------------------------------------------- step 4: shortcuts
  const MAC_CHORDS = [['control', 'option'], ['option', 'command'], ['control', 'command'], ['control', 'shift'], ['option', 'shift']];
  // Windows: no Win key (letting go of it opens Start) and no Alt+Shift (it switches keyboard layout).
  const PC_CHORDS = [['control', 'option'], ['control', 'shift']];
  const chords = () => (isMac() ? MAC_CHORDS : PC_CHORDS);
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const voice = {
    level: 0, target: 0, bars: [], listening: false,
    drawMeter(dt) {
      voice.level += (voice.target - voice.level) * Math.min(1, dt * (voice.target > voice.level ? 30 : 8));
      voice.target *= Math.exp(-dt * 3);
      const meter = $('meter');
      if (!voice.listening) { if (meter.childElementCount) meter.replaceChildren(); return; }
      voice.bars.push(voice.level); if (voice.bars.length > 14) voice.bars.shift();
      if (meter.childElementCount !== voice.bars.length) meter.replaceChildren(...voice.bars.map(() => el('i')));
      [...meter.children].forEach((b, i) => { b.style.height = `${2 + voice.bars[i] * 12}px`; });
    },
    on(msg) {
      if (!at('keys')) return;
      const heard = $('heard');
      if (msg.type === 'state' && msg.state === 'listening') {
        voice.listening = true; heard.textContent = 'Listening…'; poseFn = POSE.listen();
      } else if (msg.type === 'level') voice.target = clamp(msg.v, 0, 1);
      else if (msg.type === 'partial') heard.textContent = msg.text;
      else if (msg.type === 'state' && msg.state === 'processing') { voice.listening = false; }
      else if (msg.type === 'final') {
        voice.listening = false; poseFn = null;
        // Drawing (Mac): circling something while holding the keys marks it; the words arrive with that area.
        const drew = canCircle() && !!msg.area;
        heard.textContent = drew ? `“${msg.text}” + your circle` : `“${msg.text}”`;
        quip(drew ? 'I saw your circle!' : keys.heard && canCircle() && !keys.drew ? 'Now try circling!' : 'I heard you!');
        if (drew) keys.drew = true; else keys.heard = true;
        keys.tryLabel();
      } else if (msg.type === 'state' && msg.state === 'idle') { voice.listening = false; if (poseFn) poseFn = null; }
      else if (msg.type === 'error') {
        voice.listening = false; poseFn = null;
        heard.textContent = msg.code === 'permission' ? 'I need the Microphone (step 2) to hear you.' : msg.code === 'nothing_heard' ? "Didn't catch that. Try again?" : 'Something went wrong. Try again?';
        quip(msg.code === 'permission' ? 'I can’t hear you yet' : 'Again?');
      }
      // Wayland: the Talk button turns into Send while it listens.
      if (bind() && msg.type === 'state') keys.tryLabel();
    },
  };
  // Recorder for the two letter-key shortcuts: 'summon' (show/hide) and 'snap' (ask about an area).
  const keys = {
    recording: null, heard: false, drew: false,
    render() {
      const k = state?.keys; if (!k) return;
      $('talk-row').hidden = !state.voice;
      const b = bind();
      $('bind-row').hidden = !b; $('hotkey-row').hidden = !!b; $('chords').hidden = !!b;
      $('talk-hint').textContent = b ? 'Press your talk key, talk, then press it again (or pause) to send.' : 'Hold to talk. Tap to listen hands-free.';
      $('keys-lead').textContent = b ? 'Pick keys for these, and they work from anywhere.' : 'These work from anywhere. Change them if you like.';
      if (b) keys.renderBind(b);
      $('chords').replaceChildren(...chords().map((c) => {
        const on = same(c, k.talk);
        const b = el('button', { className: 'px chord', type: 'button', role: 'radio', tabIndex: on ? 0 : -1 }, capsEl(capsFor(c)));
        b.setAttribute('aria-checked', String(on));
        b.setAttribute('aria-label', `Hold ${c.map((x) => (isMac() ? x[0].toUpperCase() + x.slice(1) : PC_MOD[x])).join(' and ')}`);
        b.onclick = () => { if (!on) { send({ type: 'set_keys', talk: c }); quip('Ooh, fancy.'); } };
        return b;
      }));
      // Type to me: a quick tap of a pair. Picking the pair the other shortcut has swaps the two (the sidecar does it).
      $('write-chords').replaceChildren(...chords().map((c) => {
        const on = !!k.write && same(c, k.write);
        const b = el('button', { className: 'px chord', type: 'button', role: 'radio', tabIndex: on ? 0 : -1 }, capsEl(capsFor(c)));
        b.setAttribute('aria-checked', String(on));
        b.setAttribute('aria-label', `Tap ${c.map((x) => (isMac() ? x[0].toUpperCase() + x.slice(1) : PC_MOD[x])).join(' and ')}`);
        b.onclick = () => { if (!on) { send({ type: 'set_keys', write: c }); quip('Tap, tap.'); } };
        return b;
      }));
      keys.tryLabel();
      $('snap-line').hidden = !canSnap() || !k.snap;
      $('draw-tip').hidden = !canCircle();
      for (const w of ['summon', 'snap']) if (keys.recording !== w && k[w]) fillCaps($(`${w}-caps`), accelCaps(k[w]));
      nav();
    },
    // Wayland: one line per command, with a Copy button (drawn again only when the commands change, so focus stays).
    // The command itself shows only if copying fails, so it can be copied by hand.
    bound: '',
    renderBind(b) {
      const list = [['talk', 'Talk to me'], ['summon', 'Show or hide me'], ['ask', 'Ask me'], ['list', 'Your list'], ['panel', 'My panel']];
      const sig = JSON.stringify(b);
      if (keys.bound === sig) return;
      keys.bound = sig;
      $('bind-list').replaceChildren(...list.filter(([k]) => b[k]).map(([k, title]) => el('div', { className: 'bind-line' },
        el('span', { textContent: title }),
        el('button', { className: 'link', type: 'button', textContent: 'Copy', ariaLabel: `Copy the command for ${title.toLowerCase()}`, onclick: () => send({ type: 'copy_bind', which: k }) }),
        el('code', { className: 'bind-cmd', id: `bind-${k}`, textContent: b[k], hidden: true }))));
    },
    // Windows and Linux can only try talking once the speech model is downloaded.
    tryLabel() {
      const k = state?.keys, vm = state?.voiceModel; if (!k) return;
      const tl = $('try-label');
      if (!isMac() && vm && vm.status !== 'ready') tl.replaceChildren(vm.status === 'downloading' ? `Try it once my voice has downloaded (${pctOf(vm)}%).` : 'Download my voice in step 2 to try it.');
      // Once talking worked, the next try teaches drawing (circle something while holding the keys).
      else if (canCircle() && keys.heard && !keys.drew) tl.replaceChildren('Now hold ', capsEl(capsFor(k.talk)), ' and circle something as you ask');
      // Wayland: a button stands in for the talk shortcut, which may not be bound yet.
      else if (bind()) tl.replaceChildren('Try it: ', el('button', { className: 'px btn ghost', type: 'button', textContent: voice.listening ? 'Send' : 'Talk', onclick: () => send({ type: 'cli', action: 'talk' }) }), voice.listening ? '' : ' and say hi');
      else tl.replaceChildren('Try it: hold ', capsEl(capsFor(k.talk)), ' and say hi');
    },
    record(which) {
      if (keys.recording) keys.stop();
      keys.recording = which;
      $('keys-error').hidden = true;
      $(`${which}-caps`).textContent = 'Press keys…';
      $(`${which}-caps`).parentElement.classList.add('recording');
      $(`${which}-change`).textContent = 'Cancel';
      poseFn = POSE.wait(); quip('Press your new combo');
    },
    stop() {
      const w = keys.recording;
      keys.recording = null;
      if (w) { $(`${w}-caps`).parentElement.classList.remove('recording'); $(`${w}-change`).textContent = 'Change'; }
      poseFn = null;
      keys.render();
    },
    enter() { keys.render(); aim($('chords')); setTimeout(() => at('keys') && quip(state?.voice ? 'Try talking to me!' : 'Your shortcuts'), 700); },
    leave() { if (keys.recording) keys.stop(); poseFn = null; voice.listening = false; },
  };
  // Drawing, shown not told: a cursor holding the talk keys circles Roamie and the loop snaps shut, like the
  // real pen. It loops while the step is open, pauses while they try talking or record a shortcut, and holds
  // still as a finished circle with reduced motion.
  const penDemo = {
    t: 0, eye: null, keysFor: '',
    LOOP: 6, START: 0.4, DRAW: 1.7,
    on: () => at('keys') && canCircle() && !!state?.voice && !keys.recording && !voice.listening && !sidekick.hidden,
    // A hand-drawn loop: starts top left, goes clockwise, a little wobbly, and overlaps its start before it closes.
    points(r) {
      const pts = [], a0 = -2.3, span = Math.PI * 2 + 0.35, n = 80;
      for (let i = 0; i <= n; i++) {
        const f = i / n, a = a0 + span * f, rr = r * (1 + 0.05 * Math.sin(2 * a + 0.7) + 0.05 * f);
        pts.push([Math.cos(a) * rr * 1.08, Math.sin(a) * rr * 0.94 - r * 0.04]);
      }
      return pts;
    },
    path: (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(''),
    draw(dt) {
      const box = $('pen-demo');
      if (!penDemo.on()) { if (!box.hidden) { box.hidden = true; penDemo.t = 0; } penDemo.eye = null; return; }
      // A new go waits until the speech bubble is gone: the loop runs round where it sits.
      if (!reduced.matches && penDemo.t === 0 && quipText && clock < quipUntil + 0.3) { box.hidden = true; penDemo.eye = null; return; }
      box.hidden = false;
      const caps = capsFor(state.keys.talk).join('');
      if (penDemo.keysFor !== caps) { penDemo.keysFor = caps; fillCaps($('pen-keys'), capsFor(state.keys.talk)); }
      const still = reduced.matches;
      penDemo.t = still ? penDemo.START + penDemo.DRAW + 0.5 : penDemo.t + dt >= penDemo.LOOP ? 0 : penDemo.t + dt;
      const t = penDemo.t, pts = penDemo.points((K?.R ?? 50) * 1.6);
      const f = Math.min(1, Math.max(0, (t - penDemo.START) / penDemo.DRAW));
      const eased = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      const shown = pts.slice(0, Math.max(1, Math.round(eased * (pts.length - 1)) + 1));
      const d = penDemo.path(shown);
      $('pen-ink').setAttribute('d', d); $('pen-rim').setAttribute('d', d);
      const snapped = f >= 1;
      $('pen-stroke').classList.toggle('snapped', snapped);
      // The cursor leads the ink, then drifts off after the snap; everything fades before the next go.
      // Outward from Roamie, so the cursor and keys never cover it.
      const head = shown.at(-1), drift = snapped ? Math.min(1, (t - penDemo.START - penDemo.DRAW) / 1.2) : 0;
      const len = Math.hypot(head[0], head[1]) || 1, ux = head[0] / len, uy = head[1] / len;
      const cx = head[0] + ux * drift * 24, cy = head[1] + uy * drift * 24;
      const fade = still ? 1 : t < 0.15 ? t / 0.15 : t > 4 ? Math.max(0, 1 - (t - 4) / 0.5) : 1;
      // The keys go down first, stay held while it draws, and come back up a moment after the snap.
      const held = still || (t > 0.2 && t < penDemo.START + penDemo.DRAW + 0.6);
      $('pen-stroke').style.opacity = fade < 1 ? String(fade * (snapped ? 1 : 0.55)) : '';
      $('pen-cursor').setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
      $('pen-cursor').style.opacity = still ? '0' : String(fade);
      const k = $('pen-keys');
      const kx = (still ? pts[0][0] : cx) + ux * 38 - 26, ky = (still ? pts[0][1] : cy) + uy * 32 - 12;
      k.style.transform = `translate(${(m.x + kx).toFixed(1)}px, ${(m.y + ky).toFixed(1)}px)`;
      k.style.opacity = String(fade);
      k.classList.toggle('down', held);
      box.querySelector('svg').style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      penDemo.eye = still ? null : { x: m.x + cx, y: m.y + cy };
    },
  };

  for (const id of ['chords', 'write-chords']) $(id).addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const btns = [...$(id).children], i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
    btns[n].click(); requestAnimationFrame(() => $(id).children[n]?.focus());
  });
  for (const w of ['summon', 'snap']) $(`${w}-change`).addEventListener('click', () => (keys.recording === w ? keys.stop() : keys.record(w)));
  addEventListener('keydown', (e) => {
    if (!keys.recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return keys.stop();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean);
    if (!mods.some((x) => x !== 'Shift')) { $('keys-error').hidden = false; $('keys-error').textContent = isMac() ? 'Hold Control, Option or Command too.' : 'Hold Ctrl or Alt too.'; return; }
    if (!/^(Key[A-Z]|Digit\d|F\d{1,2}|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/.test(e.code)) return;
    const which = keys.recording;
    keys.stop();
    send({ type: 'set_keys', [which]: [...mods, e.code].join('+') });
    quip('Got it!');
  }, true);

  // ---------------------------------------------------------------- step 5: find me
  const find = {
    enter() {
      const k = state?.keys;
      const recap = $('recap');
      recap.replaceChildren();
      const b = bind();
      if (state?.voice && k) recap.append(el('dt', {}, capsEl(b ? ['Your talk key'] : capsFor(k.talk))), el('dd', { textContent: b ? 'Press to talk to me, again to send' : canCircle() ? 'Hold to talk to me. Circle something to mark it' : 'Hold to talk to me' }));
      if (k?.write && !b) recap.append(el('dt', {}, capsEl(capsFor(k.write))), el('dd', { textContent: 'Tap, then type to me' }));
      if (k) recap.append(el('dt', {}, capsEl(b ? ['Your show key'] : accelCaps(k.summon))), el('dd', { textContent: 'Show or hide me' }));
      if (k?.snap && canSnap()) recap.append(el('dt', {}, capsEl(accelCaps(k.snap))), el('dd', { textContent: 'Ask about an area of the screen' }));
      const tray = el('span', { className: 'caps' }); const cap = el('kbd', { className: 'px cap' }); cap.innerHTML = TRAY_SVG; tray.append(cap);
      recap.append(el('dt', {}, tray), el('dd', { textContent: isMac() ? 'Everything else, in the menu bar' : 'Everything else, in the system tray' }));
      // Windows keeps tray icons at the bottom right, and new ones start hidden behind the ^ arrow.
      const mac = isMac();
      const linux = isLinux();
      $('h-4').textContent = mac ? 'Find me up here' : linux ? 'Find me in the tray' : 'Find me down here';
      $('find-where').textContent = mac ? 'I live in your menu bar. Click ' : linux ? 'I live in the system tray. Click ' : 'I live in the system tray, at the bottom right of your taskbar. Click ';
      // Linux: GNOME shows no tray without an extension, and opening Roamies again works anywhere.
      $('find-tip').innerHTML = linux ? "No tray on your desktop? On GNOME, add the <b>AppIndicator</b> extension. Or just open Roamies again from your apps: that opens my panel." : "Don't see me? Click the <b>^</b> arrow next to the clock. To keep me in view, drag my icon onto the taskbar.";
      $('find-tip').hidden = mac;
      $('find-bar').classList.toggle('taskbar', !mac);
      poseFn = POSE.point(1.25, mac ? -1.45 : 1.2);
      setTimeout(() => at('find') && quip(mac ? 'I live up there!' : 'I live down there!'), 750);
    },
    leave() { poseFn = null; },
  };

  // ---------------------------------------------------------------- flow
  const ALL = [
    { name: 'welcome', enter: 'drop', next: "Let's go", onEnter: () => { $('h-0').textContent = `Hi, I'm ${state?.name || 'Jarvis'}.`; setTimeout(() => { if (at('welcome')) quip('Hi there!'); }, 650); } },
    // Windows: the voice download is optional, so it can be skipped.
    { name: 'perms', enter: 'materialize', next: 'Continue', onEnter: perms.enter, onLeave: perms.leave, ready: () => perms.done(), get skip() { return !isMac(); } },
    { name: 'ai', enter: 'crt', next: 'Continue', onEnter: ai.enter, onLeave: ai.leave, ready: () => !!state?.connected, skip: true },
    { name: 'voice', enter: 'materialize', next: 'Continue', onEnter: replies.enter, onLeave: replies.leave, ready: () => replies.ready(), skip: true },
    { name: 'keys', enter: 'materialize', next: 'Continue', onEnter: keys.enter, onLeave: keys.leave },
    { name: 'find', enter: 'drop', next: 'Done', onEnter: find.enter, onLeave: find.leave },
  ];
  const STEPS = ALL;
  const sectionOf = (s) => $(`step-${s.name}`);
  const sections = STEPS.map(sectionOf);
  $('progress').replaceChildren(...STEPS.map(() => el('li')));

  // Required steps unlock after a while anyway, so a missed permission event can never trap anyone.
  let stuckTimer = null, escape = false;
  function nav() {
    const s = STEPS[cur]; if (!s) return;
    const ready = !s.ready || s.ready();
    $('next').textContent = s.next;
    $('next').disabled = !ready && !escape;
    $('back').disabled = cur === 0;
    $('back').hidden = STEPS.length === 1;
    $('skip').hidden = !(s.skip && !ready) && !(escape && !ready);
    $('skip').textContent = s.skip ? 'Skip for now' : 'Continue anyway';
    s.nav?.();
  }
  function go(i) {
    if (i === cur || i < 0 || i >= STEPS.length) return;
    STEPS[cur]?.onLeave?.();
    clearTimeout(stuckTimer); escape = false;
    sections.forEach((sec, j) => { sec.hidden = j !== i; });
    [...$('progress').children].forEach((li, j) => {
      li.className = j < i ? 'done' : '';
      if (j === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    // Screen readers only: sighted users read the LED bar.
    $('step-name').textContent = `Step ${i + 1} of ${STEPS.length}: ${sections[i].dataset.name}`;
    cur = i;
    send({ type: 'ob_step', step: i });
    enter(STEPS[i].enter);
    STEPS[i].onEnter?.();
    if (STEPS[i].ready) stuckTimer = setTimeout(() => { escape = true; nav(); }, 25000);
    nav();
    const h = sections[i].querySelector('h1');
    h.tabIndex = -1; h.focus({ preventScroll: true });
  }
  async function finish() {
    $('next').disabled = true;
    STEPS[cur]?.onLeave?.();
    if (!reduced.matches) { sidekick.vanish('materialize'); await wait(700); }
    send({ type: 'ob_done' });
    const canTalk = state?.voice && state.keys && (isMac() || state.voiceModel?.status === 'ready');
    const talk = canTalk ? capsFor(state.keys.talk).join(isMac() ? '' : '+') : null;
    const where = isMac() ? 'click my icon up here' : isLinux() ? "open my tray icon's menu" : 'click my icon down here';
    const how = bind() ? 'Press your talk shortcut to talk' : `Hold ${talk} to talk`;
    invoke('onboarding_finish', { text: talk ? `Here I am! ${how}, or ${where} anytime.` : `Here I am! ${where[0].toUpperCase()}${where.slice(1)} anytime.` });
  }
  const forward = () => (cur === STEPS.length - 1 ? finish() : go(cur + 1));
  $('next').addEventListener('click', () => { if (!STEPS[cur]?.onNext?.()) forward(); });
  $('back').addEventListener('click', () => go(cur - 1));
  $('skip').addEventListener('click', () => { if (!STEPS[cur]?.onSkip?.()) forward(); });

  // ---------------------------------------------------------------- messages from the app
  window.__onboard = (msg) => {
    switch (msg.kind) {
      case 'copied': {
        const cmd = !msg.ok && document.getElementById(`bind-${msg.which}`);
        if (cmd) cmd.hidden = false;
        quip(msg.ok ? 'Copied!' : "Couldn't copy. Select it instead?");
        break;
      }
      case 'state': {
        const first = !state;
        state = msg;
        if (at('welcome')) $('h-0').textContent = `Hi, I'm ${msg.name || 'Jarvis'}.`;
        if (first) go(clamp(msg.step | 0, 0, STEPS.length - 1));
        else { if (at('perms')) perms.render(); if (at('ai')) ai.render(); if (at('voice')) replies.render(); if (at('keys')) keys.render(); }
        break;
      }
      case 'login': ai.onLogin(msg); break;
      case 'fish': replies.onFish(msg); break;
      case 'ask':
        askId = msg.id;
        $('code-label').textContent = msg.prompt || 'Paste the code from your browser';
        $('code-input').type = msg.mask ? 'password' : 'text';
        $('code-input').placeholder = msg.placeholder || '';
        $('code-form').hidden = false; $('code-input').focus();
        quip('Paste the code here');
        break;
      case 'cancel_ask': if (askId === msg.id) { askId = null; $('code-form').hidden = true; } break;
      case 'files': perms.applyFiles(msg.status); if (at('perms')) perms.render(); break;
      case 'keys':
        if (state) state.keys = msg.keys;
        if (msg.error) { const e = $('keys-error'); e.hidden = false; e.textContent = e.title = msg.error; quip('Hmm, taken.'); }
        else $('keys-error').hidden = true;
        keys.render();
        break;
      case 'say': quip(msg.text, 3); break;
      case 'voice': voice.on(msg); break;
      case 'speech': Roamie.voiceOut?.handle(msg); break;
      case 'voice_model':
        if (!state) break;
        state.voiceModel = { status: msg.status, done: msg.done, total: msg.total, error: msg.error, size: msg.size };
        if (at('perms')) perms.progress();
        if (at('keys')) keys.tryLabel();
        break;
    }
  };
  // Move the window from the top strip; double-click does nothing (no zoom for a fixed-size guide).
  $('drag').addEventListener('mousedown', (e) => { if (e.button === 0 && e.detail === 1) invoke('drag_window').catch(() => {}); });
  send({ type: 'ob_hello' });
  invoke('focus_guide').catch(() => {});

  // ---------------------------------------------------------------- preview (plain browser only)
  function preview() {
    const q = new URLSearchParams(location.search);
    // ?speech=1 previews an older Mac that also needs Speech recognition; ?granted=1 a Mac that already allowed everything.
    const old = q.get('speech') === '1', pre = q.get('granted') === '1' ? 'granted' : 'unknown';
    const win = q.get('platform') === 'win32' || q.get('platform') === 'linux';
    // ?platform=win32 previews Windows (&blocked=1: microphone switched off in Privacy settings; &model=downloading|ready|error).
    // ?platform=linux&session=wayland previews a Wayland desktop (commands to bind instead of shortcuts).
    const sys = win ? { type: 'perms', mic: q.get('blocked') === '1' ? 'denied' : 'granted', input: true } : { type: 'perms', mic: pre, speech: old ? pre : 'granted', speechNeeded: old, screen: pre, accessibility: pre };
    const st = {
      // &filesAsked=1: Allow was tapped for the folders in an earlier run. &replies=voice&fish=1: voice already on.
      kind: 'state', platform: q.get('platform') || 'darwin', step: +(q.get('step') || 0), sound: true, name: 'Jarvis', voice: true, actions: false, login: true, filesAsked: q.get('filesAsked') === '1',
      replies: q.get('replies') === 'voice' ? 'voice' : 'text', fishKey: q.get('fish') === '1',
      bind: q.get('session') === 'wayland' ? Object.fromEntries(['summon', 'talk', 'ask', 'list', 'panel'].map((k) => [k, `'/home/sam/Apps/Roamies 0.1.33.AppImage' --${k}`])) : null,
      keys: q.get('platform') === 'win32' ? { talk: ['control', 'option'], write: ['control', 'shift'], summon: 'Control+Shift+KeyS', snap: 'Control+Shift+KeyA' } : { talk: ['control', 'option'], write: win ? ['control', 'shift'] : ['option', 'command'], summon: 'Control+Alt+KeyS', snap: 'Control+Alt+KeyA' }, connected: null,
      voiceModel: win ? { status: q.get('model') || 'missing', done: q.get('model') === 'downloading' ? 281601575 : 0, total: 670479942, error: q.get('model') === 'error' ? 'Download failed. Check your internet.' : null, size: '670 MB' } : null,
      oauth: [['anthropic', 'Claude', 'Anthropic'], ['openai', 'ChatGPT', 'OpenAI']].map(([id, name, company]) => ({ id, name, company, connected: false })),
      apikey: [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['xai', 'xAI'], ['kimi-code', 'Kimi Code'], ['moonshot', 'Moonshot'], ['glm', 'Z.AI'], ['minimax', 'MiniMax'],
        ['xiaomi', 'MiMo Plan'], ['xiaomi-credits', 'MiMo Credits'], ['deepseek', 'DeepSeek'], ['sakana', 'Sakana'], ['openrouter', 'OpenRouter'], ['huggingface', 'Hugging Face']]
        .map(([id, name]) => ({ id, name, connected: id === 'openrouter' && q.get('keys') === '1', link: id === 'xiaomi' ? null : `https://example.com/${id}` })),
    };
    let filesAsked = st.filesAsked;
    const logins = new Map(); // sign-in id → its timers, so Cancel stops the simulated one
    const reply = (m, ms = 0) => setTimeout(() => window.__onboard?.(m), ms);
    return async (cmd, args) => {
      if (cmd === 'perm_status') return { ...sys };
      if (cmd === 'guide_aside') return;
      // &shot=fail: the test screenshot fails.
      if (cmd === 'screen_check') { await wait(900); return { seen: q.get('shot') !== 'fail' }; }
      if (cmd === 'perm_request') { await wait(600); if (args.kind !== 'screen') sys[args.kind] = 'granted'; else setTimeout(() => { sys.screen = 'granted'; }, 2500); return { ...sys }; }
      if (cmd === 'onboarding_finish') { document.body.style.opacity = '0.4'; return; }
      if (cmd !== 'sidecar_send') return;
      const m = args.msg;
      if (m.type === 'ob_hello') reply(st, 50);
      else if (m.type === 'ob_files') { if (m.request) filesAsked = true; reply({ kind: 'files', status: Object.fromEntries(['Desktop', 'Documents', 'Downloads'].map((f) => [f, filesAsked ? 'granted' : 'unknown'])) }, m.request ? 1200 : 0); }
      else if (m.type === 'ob_login') {
        // Claude: the one-time download, then the browser. &login=hang: the browser never comes back (cancel or time out).
        const id = m.id, t = [], at = (ms, f) => t.push(setTimeout(f, ms));
        logins.set(id, t);
        let ms = 300;
        if (m.provider === 'anthropic') for (const pct of [0, 12, 31, 55, 78, 100]) at((ms += 450), () => window.__onboard?.({ kind: 'login', provider: m.provider, id, phase: 'status', text: `Downloading Claude Code… ${pct}% (${Math.round(pct * 1.4)} of 140 MB)` }));
        at((ms += 300), () => window.__onboard?.({ kind: 'login', provider: m.provider, id, phase: 'browser' }));
        if (q.get('login') !== 'hang') at(ms + 1500, () => { st.connected = { provider: 'Anthropic', model: 'Claude Haiku 5.5' }; st.oauth.find((p) => p.id === m.provider).connected = true; window.__onboard?.({ kind: 'login', provider: m.provider, id, phase: 'done' }); window.__onboard?.({ ...st }); });
      } else if (m.type === 'ob_login_cancel') { (logins.get(m.id) ?? []).forEach(clearTimeout); logins.delete(m.id); }
      else if (m.type === 'ob_apikey') {
        setTimeout(() => {
          if (m.key === 'bad') return window.__onboard?.({ kind: 'login', provider: m.provider, phase: 'error', error: 'That key was refused.' });
          st.apikey.find((p) => p.id === m.provider).connected = true; st.connected = { provider: m.provider, model: 'A model' };
          window.__onboard?.({ kind: 'login', provider: m.provider, phase: 'done' }); window.__onboard?.({ ...st });
        }, 900);
      } else if (m.type === 'ob_replies') { st.replies = m.mode; reply({ ...st }); reply({ kind: 'say', text: m.mode === 'voice' ? 'Voice is on!' : 'Text only from now on.' }, 50); }
      else if (m.type === 'ob_fishkey') {
        // A key of "bad" is refused, like a wrong one.
        setTimeout(() => {
          if (m.key === 'bad') return window.__onboard?.({ kind: 'fish', ok: false, error: "That key didn't work. Copy it again from fish.audio and retry." });
          Object.assign(st, { fishKey: true, replies: 'voice' }); window.__onboard?.({ kind: 'fish', ok: true }); window.__onboard?.({ ...st });
        }, 900);
      } else if (m.type === 'set_keys') {
        // As the sidecar does: talk and type never share a pair, so picking the other one's pair swaps them.
        const k = st.keys, both = (a, b) => a.every((x) => b.includes(x));
        if (m.talk) { if (both(m.talk, k.write)) k.write = k.talk; k.talk = m.talk; }
        if (m.write) { if (both(m.write, k.talk)) k.talk = k.write; k.write = m.write; }
        if (m.summon) k.summon = m.summon; if (m.snap) k.snap = m.snap;
        reply({ kind: 'keys', keys: k });
      }
      else if (m.type === 'set_actions') { st.actions = m.on; }
      else if (m.type === 'set_login') { st.login = m.on; }
      else if (m.type === 'ob_voice_model' && st.voiceModel) {
        const vm = st.voiceModel; Object.assign(vm, { status: 'downloading', done: 0, error: null });
        const t = setInterval(() => {
          vm.done = Math.min(vm.total, vm.done + vm.total / 40);
          if (vm.done >= vm.total) { vm.status = 'ready'; clearInterval(t); }
          reply({ kind: 'voice_model', ...vm });
        }, 150);
      }
    };
  }
})();
