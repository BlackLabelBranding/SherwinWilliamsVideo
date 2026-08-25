const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

let archiveCache = { at: 0, masters: [] };
let corsReady = false;

function createS3Client() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !process.env.S3_BUCKET) {
    return null;
  }
  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 15000,
      socketTimeout: 60000
    }),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  });
}

function resolveKey(baseKey, relativePath) {
  const baseDir = baseKey.includes('/') ? baseKey.slice(0, baseKey.lastIndexOf('/') + 1) : '';
  const joined = relativePath.startsWith('/') ? relativePath.slice(1) : `${baseDir}${relativePath}`;
  const stack = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function titleFromKey(key) {
  const match = key.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})\/([^/]+)\/media\/hls\/master\.m3u8$/);
  if (!match) {
    const parts = key.split('/');
    const id = parts[parts.length - 4] || 'recording';
    return `Recording ${id}`;
  }
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  const label = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  });
  return `Live Recording · ${label} UTC`;
}

function recordedAtFromKey(key, fallback) {
  const match = key.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})\//);
  if (!match) return fallback;
  const [, year, month, day, hour, minute] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))).toISOString();
}

function idFromKey(key) {
  return Buffer.from(key).toString('base64url');
}

function preferredPlaybackKey(masterKey) {
  const base = masterKey.replace(/\/master\.m3u8$/i, '/');
  // Smallest rendition first so first fragment can load before player timeouts.
  return `${base}160p30/playlist.m3u8`;
}

function playlistProxyUrl(key, accessToken) {
  return `/api/hls?key=${encodeURIComponent(key)}&access=${encodeURIComponent(accessToken)}`;
}

async function listMasterPlaylists(client, bucket, prefix) {
  const now = Date.now();
  if (archiveCache.masters.length && now - archiveCache.at < 5 * 60 * 1000) {
    return archiveCache.masters;
  }

  const masters = [];
  let token;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || '',
      ContinuationToken: token,
      MaxKeys: 1000
    }));
    for (const item of out.Contents || []) {
      if (item.Key && item.Key.endsWith('/media/hls/master.m3u8')) {
        masters.push(item);
      }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  masters.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  archiveCache = { at: now, masters };
  return masters;
}

async function getObjectText(client, bucket, key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return response.Body.transformToString();
}

async function signGetUrl(client, bucket, key, expiresIn = 3600) {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );
}

async function rewritePlaylistWithPresigns(body, sourceKey, accessToken) {
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  const lines = body.split(/\r?\n/);
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('#EXT-X-PLAYLIST-TYPE:EVENT')) {
        out.push('#EXT-X-PLAYLIST-TYPE:VOD');
        continue;
      }
      if (trimmed.includes('URI="')) {
        let next = trimmed;
        const matches = [...trimmed.matchAll(/URI="([^"]+)"/g)];
        for (const match of matches) {
          const uri = match[1];
          if (/^https?:\/\//i.test(uri)) continue;
          const key = resolveKey(sourceKey, uri);
          const replacement = key.toLowerCase().endsWith('.m3u8')
            ? playlistProxyUrl(key, accessToken)
            : await signGetUrl(client, bucket, key);
          next = next.replace(`URI="${uri}"`, `URI="${replacement}"`);
        }
        out.push(next);
        continue;
      }
      out.push(line);
      continue;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      out.push(line);
      continue;
    }

    const key = resolveKey(sourceKey, trimmed);
    if (key.toLowerCase().endsWith('.m3u8')) {
      out.push(playlistProxyUrl(key, accessToken));
    } else {
      out.push(await signGetUrl(client, bucket, key));
    }
  }

  let text = out.join('\n');
  if (!/#EXT-X-ENDLIST/i.test(text)) {
    text = `${text.replace(/\s*$/, '')}\n#EXT-X-ENDLIST\n`;
  }
  return text;
}

async function listArchiveRecordings(accessToken) {
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!client || !bucket) {
    return { ok: false, error: 'S3 is not configured. Check AWS_* and S3_BUCKET in .env.', media: [] };
  }

  const masters = await listMasterPlaylists(client, bucket, process.env.S3_PREFIX || '');
  const media = masters.map((item) => {
    const key = item.Key;
    const playbackKey = preferredPlaybackKey(key);
    return {
      id: idFromKey(key),
      title: titleFromKey(key),
      description: 'IVS recording via presigned S3 URLs',
      media_type: 'video',
      bucket,
      storage_path: key,
      playback_key: playbackKey,
      url: playlistProxyUrl(playbackKey, accessToken),
      recorded_at: recordedAtFromKey(key, item.LastModified?.toISOString?.() || new Date().toISOString()),
      status: 'published',
      size_bytes: item.Size || null
    };
  });

  return { ok: true, media };
}

function assertAllowedKey(key) {
  const normalized = String(key || '').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    const error = new Error('Invalid media key.');
    error.status = 400;
    throw error;
  }
  const prefix = process.env.S3_PREFIX || '';
  if (prefix && !normalized.startsWith(prefix)) {
    const error = new Error('Media key outside configured prefix.');
    error.status = 403;
    throw error;
  }
  if (!normalized.toLowerCase().endsWith('.m3u8')) {
    const error = new Error('Only HLS playlists are served by the API. Segments use S3 presigned URLs.');
    error.status = 400;
    throw error;
  }
  return normalized;
}

async function buildPresignedPlaylist(key, accessToken) {
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!client || !bucket) {
    const error = new Error('S3 is not configured.');
    error.status = 500;
    throw error;
  }

  const normalized = assertAllowedKey(key);
  const text = await getObjectText(client, bucket, normalized);
  const rewritten = await rewritePlaylistWithPresigns(text, normalized, accessToken);
  return {
    contentType: 'application/vnd.apple.mpegurl',
    body: rewritten
  };
}

function trimMediaPlaylist(playlistText, startSeconds, endSeconds) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Number(endSeconds);
  if (!Number.isFinite(end) || end <= start) {
    throw Object.assign(new Error('End time must be greater than start time.'), { status: 400 });
  }

  const lines = playlistText.split(/\r?\n/);
  const header = [];
  const kept = [];
  let elapsed = 0;
  let pending = [];
  let pendingDuration = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (
      trimmed.startsWith('#EXTM3U')
      || trimmed.startsWith('#EXT-X-VERSION')
      || trimmed.startsWith('#EXT-X-TARGETDURATION')
      || trimmed.startsWith('#EXT-X-PLAYLIST-TYPE')
      || trimmed.startsWith('#ID3-')
      || trimmed.startsWith('#EXT-X-TWITCH')
    ) {
      if (trimmed.startsWith('#EXT-X-PLAYLIST-TYPE')) header.push('#EXT-X-PLAYLIST-TYPE:VOD');
      else header.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-MEDIA-SEQUENCE') || trimmed.startsWith('#EXT-X-ENDLIST')) continue;

    if (trimmed.startsWith('#EXTINF:')) {
      pendingDuration = Number(trimmed.slice(8).split(',')[0]);
      pending.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      pending.push(line);
      continue;
    }

    const segStart = elapsed;
    const segEnd = elapsed + (Number.isFinite(pendingDuration) ? pendingDuration : 0);
    elapsed = segEnd;
    if (segEnd > start && segStart < end) {
      kept.push(...pending, line);
    }
    pending = [];
    pendingDuration = 0;
  }

  if (!kept.length) {
    throw Object.assign(new Error('No segments found in the selected trim range.'), { status: 400 });
  }

  const baseHeader = header.length
    ? header
    : ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10', '#EXT-X-PLAYLIST-TYPE:VOD'];
  if (!baseHeader.some((line) => line.startsWith('#EXTM3U'))) baseHeader.unshift('#EXTM3U');
  return `${baseHeader.join('\n')}\n#EXT-X-MEDIA-SEQUENCE:0\n${kept.join('\n')}\n#EXT-X-ENDLIST\n`;
}

async function trimAndReplacePlaylist({ playbackKey, startSeconds, endSeconds, replaceOriginal = true }) {
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!client || !bucket) {
    const error = new Error('S3 is not configured.');
    error.status = 500;
    throw error;
  }

  const key = assertAllowedKey(playbackKey);
  const original = await getObjectText(client, bucket, key);
  const trimmed = trimMediaPlaylist(original, startSeconds, endSeconds);

  const backupKey = key.replace(/\.m3u8$/i, `.backup-${Date.now()}.m3u8`);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: backupKey,
    Body: original,
    ContentType: 'application/vnd.apple.mpegurl'
  }));

  const targetKey = replaceOriginal ? key : key.replace(/\.m3u8$/i, `.trimmed-${Date.now()}.m3u8`);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    Body: trimmed,
    ContentType: 'application/vnd.apple.mpegurl'
  }));

  archiveCache = { at: 0, masters: [] };
  return { ok: true, backupKey, targetKey, replaceOriginal: Boolean(replaceOriginal) };
}

async function ensureBucketCors() {
  if (corsReady) return;
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!client || !bucket) return;

  const origins = (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    await client.send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedOrigins: origins.includes('*') ? ['*'] : origins,
            ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Accept-Ranges', 'Content-Range'],
            MaxAgeSeconds: 3000
          }
        ]
      }
    }));
    corsReady = true;
    console.log(`S3 CORS configured for: ${origins.join(', ')}`);
  } catch (error) {
    console.warn('Could not set S3 CORS automatically:', error.message);
    console.warn('Set bucket CORS manually so the browser can load presigned .ts segments.');
  }
}

function buildLiveEvent() {
  const playbackUrl = (process.env.IVS_PLAYBACK_URL || '').trim();
  return {
    id: 'live-1',
    title: 'Sherwin-Williams Driver Live Stream',
    subtitle: playbackUrl ? 'Amazon IVS live broadcast' : 'No live stream configured',
    playback_url: playbackUrl || null,
    status: playbackUrl ? 'live' : 'offline',
    started_at: playbackUrl ? new Date().toISOString() : null,
    created_at: new Date().toISOString()
  };
}

module.exports = {
  listArchiveRecordings,
  buildPresignedPlaylist,
  trimAndReplacePlaylist,
  buildLiveEvent,
  createS3Client,
  ensureBucketCors,
  preferredPlaybackKey
};
