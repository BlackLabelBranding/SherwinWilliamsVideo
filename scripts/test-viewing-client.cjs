const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../components/Portal.jsx'), 'utf8');
const code = source.slice(source.indexOf('  const endTracking ='), source.indexOf('  const loadContent ='));
function harness(fail = false) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const calls = [];
  const element = { paused: false, ended: false, readyState: 4, currentTime: 0 };
  const ctx = {
    useCallback: (fn) => fn, token: 'test', liveStreams: [], live: { title: 'Test' }, media: [],
    trackingRef: { current: null }, heartbeatRef: { current: null }, trackingGeneration: { current: 0 },
    Date: { now: () => now }, AbortSignal,
    document: { querySelectorAll: () => [element] },
    setInterval: (fn) => { timers.set(++id, fn); return id; },
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearInterval: (key) => timers.delete(key),
    api: async (url, options) => { calls.push(JSON.parse(options.body)); if (fail) throw new Error('offline'); return { sessionId: 'test-session' }; }
  };
  vm.createContext(ctx);
  const functions = vm.runInContext(`${code}\n({startTracking, endTracking})`, ctx);
  return { ...functions, ctx, calls, timers, element, tick: async (advance = true) => {
    now += 1000;
    if (advance) element.currentTime += 1;
    for (const callback of [...timers.values()]) await callback();
  } };
}
test('actual portal callbacks count advancing playback, exclude pause/stall and stop timers on navigation', async () => {
  const h = harness();
  await h.startTracking('live', 'stream');
  await h.startTracking('live', 'stream');
  assert.equal(h.calls.filter((row) => row.action === 'start').length, 1);
  for (let i = 0; i < 15; i++) await h.tick();
  assert.equal(h.calls.at(-1).watchSeconds, 15);
  h.element.paused = true;
  for (let i = 0; i < 15; i++) await h.tick(false);
  assert.equal(h.calls.at(-1).watchSeconds, 15);
  assert.equal(h.calls.at(-1).playing, false);
  h.element.paused = false;
  for (let i = 0; i < 15; i++) await h.tick(false);
  assert.equal(h.calls.at(-1).watchSeconds, 15);
  await h.endTracking();
  assert.equal(h.calls.at(-1).action, 'end');
  assert.equal(h.timers.size, 0);
});
test('analytics network failure resolves quietly and retry is cancelled on navigation', async () => {
  const h = harness(true);
  await assert.doesNotReject(h.startTracking('live', 'stream'));
  assert.equal(h.element.paused, false);
  assert.equal(h.ctx.trackingRef.current, null);
  assert.equal(h.timers.size, 1);
  await h.endTracking();
  assert.equal(h.timers.size, 0);
});
