const {
  IvsClient,
  ListStreamsCommand,
  GetChannelCommand
} = require('@aws-sdk/client-ivs');

// Share status checks between viewers handled by this server instance. Never
// confuse an unavailable control-plane API with a stopped video broadcast.
const LIVE_CACHE_MS = 15000;
const STALE_LIVE_MS = 120000;
const CHANNEL_CACHE_MS = 30 * 60 * 1000;
const CHANNEL_STALE_MS = 60 * 60 * 1000;
let ivsClient;
let liveSnapshot = null;
let liveCheckedAt = 0;
let liveExpiresAt = 0;
let liveRequest = null;
let retryAfter = 0;
const channelCache = new Map();

function awsRegion() {
  return process.env.AWS_REGION || 'us-east-1';
}

function createIvsClient() {
  if (ivsClient) return ivsClient;
  const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
    : undefined;
  ivsClient = new IvsClient({ region: awsRegion(), credentials, maxAttempts: 2 });
  return ivsClient;
}

function channelIdFromArn(arn) {
  const parts = String(arn || '').split('/');
  return parts[parts.length - 1] || arn;
}

function statusUnavailable() {
  const error = new Error('Live status is temporarily unavailable. Please try again.');
  error.status = 503;
  error.code = 'LIVE_STATUS_UNAVAILABLE';
  return error;
}

function lastKnownStreams() {
  if (liveSnapshot !== null && Date.now() - liveCheckedAt < STALE_LIVE_MS) {
    return liveSnapshot;
  }
  // A cold instance has no authoritative answer. Returning [] here would
  // unmount existing players, so the API must reject this refresh instead.
  throw statusUnavailable();
}

async function getChannel(client, arn) {
  const cached = channelCache.get(arn);
  if (cached && Date.now() - cached.checkedAt < CHANNEL_CACHE_MS) {
    return cached.channel;
  }
  try {
    const response = await client.send(new GetChannelCommand({ arn }));
    const channel = response.channel;
    if (!channel?.playbackUrl) throw new Error('IVS channel playback URL unavailable');
    channelCache.set(arn, { channel, checkedAt: Date.now() });
    return channel;
  } catch (error) {
    if (cached && Date.now() - cached.checkedAt < CHANNEL_STALE_MS) {
      return cached.channel;
    }
    // Do not silently remove a LIVE channel when GetChannel is throttled.
    throw error;
  }
}

async function fetchActiveLiveStreams() {
  const client = createIvsClient();
  const streams = [];
  let nextToken;
  do {
    const page = await client.send(new ListStreamsCommand({ maxResults: 50, nextToken }));
    for (const stream of page.streams || []) {
      if (!stream.channelArn) continue;
      if (stream.state && stream.state !== 'LIVE') continue;
      const channel = await getChannel(client, stream.channelArn);
      streams.push({
        id: channelIdFromArn(stream.channelArn),
        channel_arn: stream.channelArn,
        title: channel.name || channelIdFromArn(stream.channelArn),
        subtitle: 'Amazon IVS live broadcast',
        playback_url: channel.playbackUrl,
        status: 'live',
        health: stream.health || null,
        viewer_count: Number(stream.viewerCount || 0),
        started_at: stream.startTime ? new Date(stream.startTime).toISOString() : null,
        created_at: new Date().toISOString()
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return streams;
}

/** Returns confirmed live channels, or a bounded last-known-good snapshot. */
async function listActiveLiveStreams() {
  const now = Date.now();
  if (liveSnapshot !== null && now < liveExpiresAt) return liveSnapshot;
  if (liveRequest) return liveRequest;
  if (now < retryAfter) return lastKnownStreams();

  liveRequest = (async () => {
    try {
      const streams = await fetchActiveLiveStreams();
      liveSnapshot = streams;
      liveCheckedAt = Date.now();
      liveExpiresAt = liveCheckedAt + LIVE_CACHE_MS + Math.floor(Math.random() * 5000);
      retryAfter = 0;
      return streams;
    } catch (error) {
      // Back off once per instance, not once per viewer, with jitter so
      // instances do not all retry at exactly the same instant.
      retryAfter = Date.now() + 20000 + Math.floor(Math.random() * 5000);
      console.warn('IVS status refresh deferred:', error.message);
      return lastKnownStreams();
    }
  })();
  try {
    return await liveRequest;
  } finally {
    liveRequest = null;
  }
}

function pickLiveEvent(streams, selectedId) {
  if (!streams.length) {
    const fallbackUrl = (process.env.IVS_PLAYBACK_URL || '').trim();
    if (fallbackUrl) {
      return {
        id: 'env-fallback',
        title: 'Sherwin-Williams Driver Live Stream',
        subtitle: 'Playback URL from IVS_PLAYBACK_URL',
        playback_url: fallbackUrl,
        status: 'live',
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
    }
    return {
      id: 'live-1',
      title: 'Sherwin-Williams Driver Live Stream',
      subtitle: 'No active IVS stream right now',
      playback_url: null,
      status: 'offline',
      started_at: null,
      created_at: new Date().toISOString()
    };
  }
  const selected = streams.find((s) => s.id === selectedId || s.channel_arn === selectedId);
  return selected || streams[0];
}

module.exports = { listActiveLiveStreams, pickLiveEvent };
