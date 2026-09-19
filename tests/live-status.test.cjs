// Run with: node --test tests/live-status.test.cjs
// Uses the actual modules, a fake clock, and mocked AWS/other service boundaries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const arn = 'arn:aws:ivs:us-east-1:000000000000:channel/test-channel';
const playbackUrl = 'https://example.playback.live-video.net/test.m3u8';
const throttled = () => new Error('Too Many Requests');

function harness(env = {}) {
  let now = 1800000000000;
  const calls = [];
  const logs = [];
  let list = async () => ({ streams: [{ channelArn: arn, state: 'LIVE', startTime: '2026-09-19T13:00:00Z' }] });
  let channel = async () => ({ channel: { name: 'Test broadcast', playbackUrl } });
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class ListStreamsCommand { constructor(input) { this.input = input; } }
  class GetChannelCommand { constructor(input) { this.input = input; } }
  class IvsClient {
    async send(command) {
      const kind = command instanceof ListStreamsCommand ? 'list' : 'channel';
      calls.push(kind);
      return kind === 'list' ? list(command.input) : channel(command.input);
    }
  }
  const context = {
    Date: Clock, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    process: { env }, console: { warn: (...args) => logs.push(args), log: () => {} },
    URL, module: { exports: {} },
    require: (name) => {
      assert.equal(name, '@aws-sdk/client-ivs');
      return { IvsClient, ListStreamsCommand, GetChannelCommand };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/ivs-live.js'), 'utf8'), context);
  const ivs = context.module.exports;
  const state = { streams: [], live: null, selected: null, writes: 0 };
  let unauthorized = false;
  const auth = () => {
    if (unauthorized) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    return { user: { id: 'test-user', role: 'admin' }, token: 'fake-test-token' };
  };
  const runtime = {
    requireUser: auth, requireAdmin: auth, allowCognitoAuth: () => false,
    getSelectedLiveId: () => state.selected,
    setSelectedLiveId: (id) => { state.selected = id; state.writes++; },
    getLiveEvent: () => state.live,
    setLiveEvent: (event) => { state.live = event; state.writes++; },
    getLiveStreams: () => state.streams,
    setLiveStreams: (streams) => { state.streams = streams; state.writes++; }
  };
  const modules = {
    './ivs-live': ivs, './runtime-state': runtime,
    './s3-archive': { listArchiveRecordings: async () => ({ ok: true, media: [] }) },
    './aws-auth': {}, './viewing-metrics': {}
  };
  const serverContext = { ...context, module: { exports: {} }, require: (name) => {
    assert.ok(name in modules, name); return modules[name];
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/http-handlers.js'), 'utf8'), serverContext);
  return {
    ivs, handlers: serverContext.module.exports, state, calls, logs,
    advance: (ms) => { now += ms; },
    setList: (fn) => { list = fn; }, setChannel: (fn) => { channel = fn; },
    deny: () => { unauthorized = true; }
  };
}

function unavailable(error) { return error.status === 503 && error.code === 'LIVE_STATUS_UNAVAILABLE'; }

test('100 simultaneous viewers share one ListStreams and one GetChannel request', async () => {
  const h = harness();
  const answers = await Promise.all(Array.from({ length: 100 }, () => h.ivs.listActiveLiveStreams()));
  assert.deepEqual(h.calls, ['list', 'channel']);
  assert.ok(answers.every((answer) => answer === answers[0]));
});

test('warm cache reuses results; later status refresh reuses channel metadata', async () => {
  const h = harness();
  const first = await h.ivs.listActiveLiveStreams();
  h.advance(12000);
  assert.equal(await h.ivs.listActiveLiveStreams(), first);
  h.advance(4000);
  assert.equal((await h.ivs.listActiveLiveStreams())[0].id, first[0].id);
  assert.deepEqual(h.calls, ['list', 'channel', 'list']);
});

test('throttling preserves stream ID, playback URL and broadcast start time', async () => {
  const h = harness();
  const before = await h.handlers.handleContentGet({});
  h.advance(16000);
  h.setList(async () => { throw throttled(); });
  const after = await h.handlers.handleContentGet({});
  assert.equal(after.status, 200);
  assert.equal(after.json.live, before.json.live);
  assert.equal(after.json.live.status, 'live');
  assert.equal(after.json.live.playback_url, playbackUrl);
});

test('backoff prevents 100 further viewers from retrying AWS after throttling', async () => {
  const h = harness();
  await h.ivs.listActiveLiveStreams();
  h.advance(16000);
  h.setList(async () => { throw throttled(); });
  await h.ivs.listActiveLiveStreams();
  const count = h.calls.length;
  await Promise.all(Array.from({ length: 100 }, () => h.ivs.listActiveLiveStreams()));
  assert.equal(h.calls.length, count);
  assert.equal(h.logs.length, 1);
});

test('cold instance returns retryable failure, never a false offline response', async () => {
  const h = harness();
  h.setList(async () => { throw throttled(); });
  const answer = await h.handlers.handleContentGet({});
  assert.equal(answer.status, 503);
  assert.equal(answer.json.ok, false);
  assert.equal(h.state.writes, 0);
  assert.equal('live' in answer.json, false);
});

test('failed GetChannel on cold instance cannot silently drop a LIVE stream', async () => {
  const h = harness();
  h.setChannel(async () => { throw throttled(); });
  await assert.rejects(h.ivs.listActiveLiveStreams, unavailable);
});

test('failure to resolve a newly added channel keeps the previous whole snapshot', async () => {
  const h = harness();
  const previous = await h.ivs.listActiveLiveStreams();
  h.advance(16000);
  h.setList(async () => ({ streams: [{ channelArn: arn, state: 'LIVE' }, { channelArn: arn + '2', state: 'LIVE' }] }));
  h.setChannel(async () => { throw throttled(); });
  assert.equal(await h.ivs.listActiveLiveStreams(), previous);
});

test('stale live status is bounded; expiry rejects refresh without clearing runtime state', async () => {
  const h = harness();
  await h.handlers.handleContentGet({});
  const before = h.state.live;
  const writes = h.state.writes;
  h.advance(121000);
  h.setList(async () => { throw throttled(); });
  const answer = await h.handlers.handleContentGet({});
  assert.equal(answer.status, 503);
  assert.equal(h.state.live, before);
  assert.equal(h.state.writes, writes);
});

test('retry recovery returns fresh metadata without changing player identity', async () => {
  const h = harness();
  const original = (await h.ivs.listActiveLiveStreams())[0];
  h.advance(16000);
  h.setList(async () => { throw throttled(); });
  await h.ivs.listActiveLiveStreams();
  h.advance(21000);
  h.setList(async () => ({ streams: [{ channelArn: arn, state: 'LIVE', viewerCount: 42 }] }));
  const recovered = (await h.ivs.listActiveLiveStreams())[0];
  assert.equal(recovered.id, original.id);
  assert.equal(recovered.playback_url, original.playback_url);
  assert.equal(recovered.viewer_count, 42);
});

test('a successfully confirmed broadcast end still shows offline', async () => {
  const h = harness();
  await h.handlers.handleContentGet({});
  h.advance(16000);
  h.setList(async () => ({ streams: [] }));
  const answer = await h.handlers.handleContentGet({});
  assert.equal(answer.status, 200);
  assert.equal(answer.json.live.status, 'offline');
  assert.equal(answer.json.liveStreams.length, 0);
});

test('configured fallback is not selected when status lookup fails', async () => {
  const h = harness({ IVS_PLAYBACK_URL: playbackUrl });
  h.setList(async () => { throw throttled(); });
  const answer = await h.handlers.handleContentGet({});
  assert.equal(answer.status, 503);
  assert.equal(h.state.selected, null);
});

test('admin refresh also rejects unavailable status instead of clearing playback', async () => {
  const h = harness();
  h.setList(async () => { throw throttled(); });
  const answer = await h.handlers.handleAdminGet({});
  assert.equal(answer.status, 503);
  assert.equal(h.state.writes, 0);
});

test('authorization is still required before live discovery', async () => {
  const h = harness();
  h.deny();
  assert.equal((await h.handlers.handleContentGet({})).status, 401);
  assert.equal((await h.handlers.handleAdminGet({})).status, 401);
  assert.equal(h.calls.length, 0);
});

test('pagination and explicit stream selection continue to work', async () => {
  const h = harness();
  h.setList(async ({ nextToken }) => nextToken
    ? { streams: [{ channelArn: arn + '2', state: 'LIVE' }] }
    : { streams: [{ channelArn: arn, state: 'LIVE' }], nextToken: 'next-page' });
  const streams = await h.ivs.listActiveLiveStreams();
  assert.equal(streams.length, 2);
  assert.equal(h.ivs.pickLiveEvent(streams, 'test-channel2').id, 'test-channel2');
});

test('alternating failures and successes never produce the old Playing-Off cycle', async () => {
  const h = harness();
  const first = await h.handlers.handleContentGet({});
  let browserLive = first.json.live;
  const identity = browserLive.id;
  for (let i = 0; i < 12; i++) {
    h.advance(26000);
    h.setList(i % 2 === 0
      ? async () => { throw throttled(); }
      : async () => ({ streams: [{ channelArn: arn, state: 'LIVE' }] }));
    const result = await h.handlers.handleContentGet({});
    if (result.status === 200 && result.json.ok) browserLive = result.json.live;
    assert.equal(browserLive.status, 'live');
    assert.equal(browserLive.id, identity);
    assert.equal(browserLive.playback_url, playbackUrl);
  }
});
