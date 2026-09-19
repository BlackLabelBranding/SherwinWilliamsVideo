// Analytics is isolated from authentication, stream discovery and playback.
const { randomUUID } = require('crypto');
const { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { createS3Client } = require('./s3-archive');
const { signToken, verifyToken } = require('./session');

function chicagoDay(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function prefix() {
  return `${(process.env.S3_PREFIX || '').replace(/\/+$/, '')}${process.env.S3_PREFIX ? '/' : ''}_analytics/viewing-v1/`;
}
function storage() {
  const client = createS3Client();
  if (!client) throw new Error('Attendance storage is unavailable. Video playback is unaffected.');
  return {
    send: (command) => client.send(command, { abortSignal: AbortSignal.timeout(5000) }),
    bucket: process.env.S3_BUCKET
  };
}
async function saveSnapshot(session, seconds, ended, playing) {
  const now = Date.now();
  const watch = Math.max(0, Math.min(Math.floor(Number(seconds) || 0), Math.floor((now - session.started) / 1000)));
  const row = {
    sessionId: session.id, user_id: session.user.id, user: session.user,
    content_type: session.contentType, content_id: session.contentId,
    content_title: session.title, broadcast_started_at: session.broadcastStarted || '',
    started_at: new Date(session.started).toISOString(),
    last_heartbeat_at: new Date(now).toISOString(),
    ended_at: ended ? new Date(now).toISOString() : null,
    watch_seconds: watch, playing: !ended && Boolean(playing)
  };
  const { send, bucket } = storage();
  // Immutable snapshots prevent late heartbeats from overwriting an end event.
  const key = `${prefix()}${chicagoDay(session.started)}/${session.id}/${String(watch).padStart(10, '0')}-${ended ? '1' : '0'}-${now}.json`;
  await send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(row), ContentType: 'application/json', CacheControl: 'no-store' }));
  return row;
}
async function startSession(user, body) {
  if (!['live', 'media'].includes(body.contentType) || typeof body.contentId !== 'string' || !body.contentId || body.contentId.length > 2048) {
    throw new Error('Invalid viewing content.');
  }
  const session = {
    purpose: 'viewing', id: randomUUID(), started: Date.now(),
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    contentType: body.contentType, contentId: body.contentId,
    title: String(body.contentTitle || body.contentId).slice(0, 300),
    broadcastStarted: Number.isFinite(Date.parse(body.broadcastStarted)) ? new Date(body.broadcastStarted).toISOString() : '',
    exp: Date.now() + 24 * 60 * 60 * 1000
  };
  await saveSnapshot(session, 0, false, true);
  return { ok: true, sessionId: signToken(session) };
}
async function updateSession(user, body) {
  const session = verifyToken(body.sessionId);
  if (!session || session.purpose !== 'viewing' || session.user.id !== user.id) {
    throw Object.assign(new Error('Invalid viewing session.'), { status: 403 });
  }
  await saveSnapshot(session, body.watchSeconds, body.action === 'end', body.playing);
  return { ok: true };
}
function summarize(rows, now = Date.now()) {
  const drivers = rows.filter((row) => row.user?.role === 'driver');
  const active = drivers.filter((row) => !row.ended_at && row.playing && now - Date.parse(row.last_heartbeat_at) < 45000);
  return {
    current_viewers: new Set(active.map((row) => row.user_id)).size,
    unique_viewers: new Set(drivers.map((row) => row.user_id)).size,
    session_count: drivers.length,
    total_watch_seconds: drivers.reduce((total, row) => total + row.watch_seconds, 0),
    active, sessions: drivers
  };
}
async function report(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Choose a report date.');
  const { send, bucket } = storage();
  // Confirm write access too: an empty readable report alone does not prove
  // that driver heartbeats can be persisted with the deployed AWS permissions.
  await send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix()}health.json`, Body: JSON.stringify({ checked_at: new Date().toISOString() }), ContentType: 'application/json' }));
  const latest = new Map();
  let token;
  let count = 0;
  do {
    const page = await send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix()}${day}/`, ContinuationToken: token }));
    for (const item of page.Contents || []) {
      if (++count > 50000) throw new Error('This report is too large to load in one request. Contact your administrator.');
      const id = item.Key.split('/').at(-2);
      if (!latest.has(id) || item.Key > latest.get(id)) latest.set(id, item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const keys = [...latest.values()];
  const rows = [];
  for (let i = 0; i < keys.length; i += 20) {
    rows.push(...await Promise.all(keys.slice(i, i + 20).map(async (key) => {
      const result = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return JSON.parse(await result.Body.transformToString());
    })));
  }
  return { ok: true, date: day, ...summarize(rows.sort((a, b) => a.started_at.localeCompare(b.started_at))) };
}
module.exports = { startSession, updateSession, report, chicagoDay, summarize };
