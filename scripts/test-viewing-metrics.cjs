const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const memory = new Map();
let fail = false;
process.env.SESSION_SECRET = 'test-only-not-a-production-secret';
process.env.S3_BUCKET = 'test-only';
process.env.S3_PREFIX = 'recordings/';
require.cache[require.resolve('../lib/s3-archive')] = { exports: { createS3Client: () => ({ send: async (command) => {
  if (fail) throw new Error('AccessDenied');
  const input = command.input;
  if (command.constructor.name === 'PutObjectCommand') { memory.set(input.Key, input.Body); return {}; }
  if (command.constructor.name === 'GetObjectCommand') return { Body: { transformToString: async () => memory.get(input.Key) } };
  if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [...memory.keys()].filter((key) => key.startsWith(input.Prefix)).map((Key) => ({ Key })) };
  throw new Error('Unexpected command');
} }) } };
const metrics = require('../lib/viewing-metrics');
const { signToken, verifyToken, issueSession } = require('../lib/session');
const { attendanceCsv } = require('../lib/attendance-csv');
const driver = { id: 'driver-1', username: 'driver1', display_name: '=SUM(A1)', role: 'driver' };

test('durable report survives module reload, deduplicates snapshots, ends sessions and rejects another driver', async () => {
  const start = await metrics.startSession(driver, { contentType: 'live', contentId: 'stream1', contentTitle: 'Safety, meeting', broadcastStarted: '2026-09-19T14:00:00Z' });
  const decoded = verifyToken(start.sessionId);
  decoded.started -= 60000;
  const sessionId = signToken(decoded);
  await metrics.updateSession(driver, { action: 'heartbeat', sessionId, watchSeconds: 30, playing: true });
  let result = await metrics.report(metrics.chicagoDay(decoded.started));
  assert.equal(result.current_viewers, 1);
  assert.equal(result.total_watch_seconds, 30);
  await assert.rejects(metrics.updateSession({ id: 'other' }, { action: 'end', sessionId }), /Invalid viewing session/);
  await metrics.updateSession(driver, { action: 'end', sessionId, watchSeconds: 40 });
  await metrics.updateSession(driver, { action: 'heartbeat', sessionId, watchSeconds: 30, playing: true });
  delete require.cache[require.resolve('../lib/viewing-metrics')];
  result = await require('../lib/viewing-metrics').report(metrics.chicagoDay(decoded.started));
  assert.equal(result.current_viewers, 0);
  assert.equal(result.unique_viewers, 1);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.total_watch_seconds, 40);
  const csv = attendanceCsv(result.sessions);
  assert.ok(csv.includes("'=SUM(A1)"));
  assert.ok(csv.includes('"Safety, meeting"'));
  assert.ok(csv.includes('CDT'));
});

test('Chicago day rollover and stale/paused/admin sessions', () => {
  assert.equal(metrics.chicagoDay('2026-09-19T04:40:00Z'), '2026-09-18');
  assert.equal(metrics.chicagoDay('2026-01-02T05:40:00Z'), '2026-01-01');
  const now = Date.now();
  const row = { user_id: '1', user: { role: 'driver' }, watch_seconds: 20, last_heartbeat_at: new Date(now).toISOString() };
  const result = metrics.summarize([row, { ...row, user_id: '2', playing: true, last_heartbeat_at: new Date(now - 46000).toISOString() }, { ...row, user: { role: 'admin' } }], now);
  assert.equal(result.current_viewers, 0);
  assert.equal(result.unique_viewers, 2);
});

test('storage failures are explicit; drivers cannot read attendance; unauthenticated requests denied', async () => {
  const { handleMetrics } = require('../lib/http-handlers');
  const request = (body, token) => new Request('https://example.test/api/metrics', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {}, body: JSON.stringify(body) });
  assert.equal((await handleMetrics(request({ action: 'dashboard' }))).status, 401);
  assert.equal((await handleMetrics(request({ action: 'dashboard' }, issueSession(driver)))).status, 403);
  fail = true;
  assert.equal((await handleMetrics(request({ action: 'start', contentType: 'live', contentId: 's' }, issueSession(driver)))).status, 503);
  await assert.rejects(metrics.report(metrics.chicagoDay()), /AccessDenied/);
  fail = false;
});
