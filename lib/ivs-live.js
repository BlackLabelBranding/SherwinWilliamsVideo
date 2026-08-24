const {
  IvsClient,
  ListStreamsCommand,
  GetChannelCommand
} = require('@aws-sdk/client-ivs');

function awsRegion() {
  return process.env.AWS_REGION || 'us-east-1';
}

function createIvsClient() {
  const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
    : undefined;
  return new IvsClient({ region: awsRegion(), credentials });
}

function channelIdFromArn(arn) {
  const parts = String(arn || '').split('/');
  return parts[parts.length - 1] || arn;
}

/**
 * Returns currently LIVE IVS channels with playback URLs.
 * Requires IAM: ivs:ListStreams, ivs:GetChannel
 */
async function listActiveLiveStreams() {
  const client = createIvsClient();
  const streams = [];
  let nextToken;

  do {
    const page = await client.send(new ListStreamsCommand({
      maxResults: 50,
      nextToken
    }));
    for (const stream of page.streams || []) {
      if (!stream.channelArn) continue;
      if (stream.state && stream.state !== 'LIVE') continue;

      let channel = null;
      try {
        const response = await client.send(new GetChannelCommand({ arn: stream.channelArn }));
        channel = response.channel || null;
      } catch (error) {
        console.warn('GetChannel failed for', stream.channelArn, error.message);
      }

      const name = channel?.name || channelIdFromArn(stream.channelArn);
      streams.push({
        id: channelIdFromArn(stream.channelArn),
        channel_arn: stream.channelArn,
        title: name,
        subtitle: 'Amazon IVS live broadcast',
        playback_url: channel?.playbackUrl || null,
        status: 'live',
        health: stream.health || null,
        viewer_count: Number(stream.viewerCount || 0),
        started_at: stream.startTime ? new Date(stream.startTime).toISOString() : null,
        created_at: new Date().toISOString()
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);

  return streams.filter((s) => Boolean(s.playback_url));
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

module.exports = {
  listActiveLiveStreams,
  pickLiveEvent
};
