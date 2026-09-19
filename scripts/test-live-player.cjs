/* Run with: node --test scripts/test-live-player.cjs
 * Executes the actual player initialization effect with browser/SDK doubles.
 * No AWS credentials, network access, React runtime, or test packages required.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../components/VideoPlayer.jsx'), 'utf8');
const helpers = source.slice(source.indexOf('function fmtClock('), source.indexOf('export default function'));
const start = source.indexOf('    const element = ref.current;\n    if (!element || !playbackUrl)');
const end = source.indexOf('\n  }, [url, playbackUrl,', start);
assert.ok(start > 0 && end > start, 'Find the real player lifecycle effect');
const effect = source.slice(start, end);
const streamUrl = 'https://test.playback.live-video.net/api/video/v1/test.channel.m3u8';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ supported = true, sdkPresent = true, native = false, mobile = false,
  attachThrows = false, url = streamUrl, live = true } = {}) {
  const calls = [];
  const state = {};
  const timers = new Map();
  const mediaEvents = new Map();
  const sdkEvents = new Map();
  let now = 0;
  let nextTimer = 1;
  const schedule = (fn, delay, repeat) => {
    const id = nextTimer++;
    timers.set(id, { fn, due: now + delay, delay, repeat });
    return id;
  };
  const element = {
    paused: true, muted: false, duration: NaN, currentTime: 0, seekable: { length: 0 },
    canPlayType: () => native ? 'probably' : '',
    addEventListener: (event, fn, options) => {
      const entries = mediaEvents.get(event) || [];
      entries.push({ fn, once: options?.once });
      mediaEvents.set(event, entries);
    },
    removeEventListener: (event, fn) => mediaEvents.set(event,
      (mediaEvents.get(event) || []).filter((entry) => entry.fn !== fn)),
    setAttribute: (name, value) => calls.push(['attribute', name, value]),
    removeAttribute: (name) => { calls.push(['removeAttribute', name]); delete element[name]; },
    load: () => calls.push(['nativeLoad', element.src]),
    play: () => { element.paused = false; calls.push(['nativePlay']); return Promise.resolve(); },
    pause: () => { element.paused = true; calls.push(['nativePause']); }
  };
  const player = {
    addEventListener: (event, fn) => sdkEvents.set(event, fn),
    attachHTMLVideoElement: (value) => {
      assert.equal(value, element);
      calls.push(['attach']);
      if (attachThrows) throw new Error('Test attachment failure');
    },
    setLiveLowLatencyEnabled: (enabled) => calls.push(['lowLatency', enabled]),
    setMuted: (muted) => calls.push(['mute', muted]),
    load: (value) => calls.push(['load', value]),
    play: () => { element.paused = false; calls.push(['play']); }, // Real SDK may return void.
    pause: () => { element.paused = true; calls.push(['pause']); },
    delete: () => { calls.push(['delete']); sdkEvents.clear(); }
  };
  const sdk = {
    isPlayerSupported: supported, // This MUST be a boolean, never a mock function.
    create: () => { calls.push(['create']); return player; },
    PlayerEventType: { ERROR: 'error', PLAYBACK_BLOCKED: 'blocked', AUDIO_BLOCKED: 'audio-blocked' }
  };
  const context = vm.createContext({
    window: {
      IVSPlayer: sdkPresent ? sdk : undefined,
      location: { origin: 'https://sherwin.example.test' }, innerWidth: mobile ? 390 : 1440,
      setTimeout: (fn, delay) => schedule(fn, delay, false)
    },
    navigator: { userAgent: mobile ? 'iPhone' : 'Desktop Chrome', maxTouchPoints: mobile ? 1 : 0 },
    console: { error: (...args) => calls.push(['error', ...args]) },
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (id) => timers.delete(id), clearTimeout: (id) => timers.delete(id),
    Date: { now: () => now }, URL,
    ref: { current: element }, playbackUrl: url, isArchiveHls: url.includes('/api/hls'),
    isLive: live, muted: true, contentType: live ? 'live' : 'archive', contentId: 'test-stream',
    lastReportedDurationRef: { current: 0 }, onDurationRef: { current: null },
    onPlayingRef: { current: (...args) => calls.push(['onPlaying', ...args]) },
    setCustomControls: (value) => { state.customControls = value; },
    setPlaying: (value) => { state.playing = value; },
    setProgress: (value) => { state.progress = value; },
    setNeedsUserPlay: (value) => { state.needsUserPlay = value; },
    setIsMuted: (value) => { state.isMuted = value; },
    setPlaybackError: (value) => { state.error = value; }
  });
  vm.runInContext(helpers, context);
  const run = () => vm.runInContext(`globalThis.cleanup = (function () {\n${effect}\n})();`, context);
  const emit = (event) => {
    for (const entry of [...(mediaEvents.get(event) || [])]) {
      entry.fn();
      if (entry.once) element.removeEventListener(event, entry.fn);
    }
  };
  return {
    calls, state, timers, element, sdk, sdkEvents, context, run, emit,
    cleanup: () => context.cleanup?.(),
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due > now) continue;
        if (timer.repeat) timer.due = now + timer.delay;
        else timers.delete(id);
        timer.fn();
      }
      await flush();
    }
  };
}

test('boolean support flag initializes IVS, attaches, mutes, loads the exact URL, and plays', async () => {
  const h = harness(); h.run(); await flush();
  assert.deepEqual(h.calls.filter(([action]) => ['create', 'attach', 'mute', 'load', 'play'].includes(action)),
    [['create'], ['attach'], ['mute', true], ['load', streamUrl], ['play']]);
  assert.equal(h.state.error, ''); h.cleanup();
});

test('late-loading SDK initializes without calling the boolean or leaking a polling timer', async () => {
  const h = harness({ sdkPresent: false }); h.run();
  h.context.window.IVSPlayer = h.sdk;
  await h.advance(80);
  assert.ok(h.calls.some(([action]) => action === 'play'));
  assert.equal([...h.timers.values()].filter((timer) => timer.repeat).length, 0); h.cleanup();
});

test('unsupported SDK uses native HLS immediately on Safari', async () => {
  const h = harness({ supported: false, native: true, mobile: true }); h.run(); await flush();
  assert.ok(!h.calls.some(([action]) => action === 'create'));
  assert.equal(h.element.src, streamUrl);
  assert.ok(h.calls.some(([action]) => action === 'nativePlay')); h.cleanup();
});

test('unsupported desktop displays an actionable error instead of silent black video', async () => {
  const h = harness({ supported: false }); h.run(); await flush();
  assert.match(h.state.error, /does not support live playback/); h.cleanup();
});

test('missing SDK times out to a visible retry error', async () => {
  const h = harness({ sdkPresent: false }); h.run(); await h.advance(15001);
  assert.match(h.state.error, /could not load.*Retry/); h.cleanup();
  assert.equal(h.timers.size, 0);
});

test('SDK fatal errors are visible and clear the misleading tap-to-play prompt', async () => {
  const h = harness(); h.run(); await flush();
  h.sdkEvents.get('error')({ code: 404, type: 'ErrorNotAvailable', source: 'MasterPlaylist' });
  assert.match(h.state.error, /code 404.*Retry/);
  assert.equal(h.state.needsUserPlay, false); h.cleanup();
});

test('autoplay and audio policy blocks expose user-gesture playback', async () => {
  const h = harness(); h.run(); await flush();
  h.sdkEvents.get('blocked')(); assert.equal(h.state.needsUserPlay, true);
  h.state.needsUserPlay = false;
  h.sdkEvents.get('audio-blocked')(); assert.equal(h.state.needsUserPlay, true); h.cleanup();
});

test('initialization errors dispose the partially created player and show Retry', async () => {
  const h = harness({ attachThrows: true }); h.run(); await flush();
  assert.match(h.state.error, /could not start.*Retry/);
  assert.ok(h.calls.some(([action]) => action === 'delete'));
  assert.equal(h.element._ivsPlayer, null); h.cleanup();
});

test('unmounting while the SDK is loading prevents stale player creation', async () => {
  const h = harness({ sdkPresent: false }); h.run(); h.cleanup();
  h.context.window.IVSPlayer = h.sdk; await h.advance(80);
  assert.ok(!h.calls.some(([action]) => action === 'create'));
  assert.equal(h.timers.size, 0);
});

test('cleanup removes tracking listeners, clears the media source, and permits clean retry', async () => {
  const h = harness(); h.run(); await flush(); h.cleanup(); h.emit('playing');
  assert.ok(!h.calls.some(([action]) => action === 'onPlaying'));
  assert.ok(h.calls.some(([action, name]) => action === 'removeAttribute' && name === 'src'));
  h.run(); await flush(); h.emit('playing');
  assert.equal(h.calls.filter(([action]) => action === 'create').length, 2);
  assert.equal(h.calls.filter(([action]) => action === 'onPlaying').length, 1); h.cleanup();
});

test('iPhone initializes muted inline playback with normal latency', async () => {
  const h = harness({ mobile: true }); h.run(); await flush();
  assert.ok(h.calls.some(([action, value]) => action === 'lowLatency' && value === false));
  assert.equal(h.element.muted, true);
  assert.ok(h.calls.some(([action, name]) => action === 'attribute' && name === 'playsinline')); h.cleanup();
});

test('ordinary MP4 archives do not enter the IVS path', async () => {
  const url = 'https://sherwin.example.test/archive.mp4';
  const h = harness({ url, live: false }); h.run(); await flush();
  assert.equal(h.element.src, url);
  assert.ok(!h.calls.some(([action]) => action === 'create')); h.cleanup();
});

test('exceptions in delayed SDK readiness polling reject and clear the interval', async () => {
  const h = harness();
  const promise = vm.runInContext('waitFor(() => { if (Date.now() > 0) throw new Error("probe failed"); return false; })', h.context);
  const rejection = assert.rejects(promise, /probe failed/);
  await h.advance(80); await rejection;
  assert.equal(h.timers.size, 0);
});

test('callback-only renders do not reset playback and Retry explicitly reinitializes it', () => {
  const dependencies = source.slice(end, source.indexOf(']);', end) + 3);
  assert.ok(!/\bonPlaying\b/.test(dependencies));
  assert.match(dependencies, /retryVersion/);
  assert.match(source, /onPlayingRef\.current\?\.\(contentType, contentId\)/);
  assert.match(source, /setRetryVersion\(\(version\) => version \+ 1\)/);
});
