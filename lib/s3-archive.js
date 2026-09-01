const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
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

function playlistProxyUrl(key, accessToken, cacheVersion) {
  let url = `/api/hls?key=${encodeURIComponent(key)}&access=${encodeURIComponent(accessToken)}`;
  if (cacheVersion != null && cacheVersion !== '') {
    url += `&v=${encodeURIComponent(String(cacheVersion))}`;
  }
  return url;
}

function playlistDurationSeconds(playlistText) {
  let total = 0;
  for (const line of String(playlistText || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      total += Number(trimmed.slice(8).split(',')[0]) || 0;
    }
  }
  return total;
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

async function rewritePlaylistWithPresigns(body, sourceKey, accessToken, cacheVersion) {
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
            ? playlistProxyUrl(key, accessToken, cacheVersion)
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
      out.push(playlistProxyUrl(key, accessToken, cacheVersion));
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
      description: '',
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

async function buildPresignedPlaylist(key, accessToken, cacheVersion) {
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!client || !bucket) {
    const error = new Error('S3 is not configured.');
    error.status = 500;
    throw error;
  }

  const normalized = assertAllowedKey(key);
  const text = await getObjectText(client, bucket, normalized);
  const rewritten = await rewritePlaylistWithPresigns(text, normalized, accessToken, cacheVersion);
  return {
    contentType: 'application/vnd.apple.mpegurl',
    body: rewritten,
    durationSeconds: playlistDurationSeconds(text)
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
  const parsedSegments = [];
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
    if (trimmed.startsWith('#EXT-X-START')) continue;

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
    const segDuration = Number.isFinite(pendingDuration) ? pendingDuration : 0;
    const segEnd = segStart + segDuration;
    elapsed = segEnd;

    parsedSegments.push({
      pending: [...pending],
      uri: line,
      segStart,
      segEnd,
      segDuration
    });
    pending = [];
    pendingDuration = 0;
  }

  const keptSegments = [];
  let playlistStartOffset = null;

  for (const segment of parsedSegments) {
    const overlapStart = Math.max(segment.segStart, start);
    const overlapEnd = Math.min(segment.segEnd, end);
    if (overlapEnd <= overlapStart) continue;

    const keptDuration = overlapEnd - overlapStart;
    const trimFromStart = overlapStart - segment.segStart;
    if (playlistStartOffset == null && trimFromStart > 0.001) {
      playlistStartOffset = trimFromStart;
    }

    const tags = segment.pending.filter((tag) => !tag.trim().startsWith('#EXTINF:'));
    keptSegments.push({
      tags,
      extinfLine: `#EXTINF:${keptDuration.toFixed(3)},`,
      uri: segment.uri,
      keptDuration
    });
  }

  if (!keptSegments.length) {
    throw Object.assign(new Error('No segments found in the selected trim range.'), { status: 400 });
  }

  const baseHeader = header.length
    ? header
    : ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10', '#EXT-X-PLAYLIST-TYPE:VOD'];
  if (!baseHeader.some((line) => line.startsWith('#EXTM3U'))) baseHeader.unshift('#EXTM3U');

  const maxSeg = Math.max(...keptSegments.map((segment) => segment.keptDuration));
  const headerOut = baseHeader.map((line) => {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      return `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(maxSeg))}`;
    }
    return line;
  });

  const body = [...headerOut, '#EXT-X-MEDIA-SEQUENCE:0'];
  if (playlistStartOffset != null && playlistStartOffset > 0) {
    body.push(`#EXT-X-START:TIME-OFFSET=${playlistStartOffset.toFixed(3)},PRECISE=YES`);
  }
  for (const segment of keptSegments) {
    body.push(...segment.tags);
    body.push(segment.extinfLine);
    body.push(segment.uri);
  }
  body.push('#EXT-X-ENDLIST');

  return `${body.join('\n')}\n`;
}

async function listRenditionPlaylistKeys(client, bucket, playbackKey) {
  const key = assertAllowedKey(playbackKey);
  const hlsBaseMatch = key.match(/^(.*\/media\/hls\/)/i);
  if (!hlsBaseMatch) return [key];

  const hlsBase = hlsBaseMatch[1];
  const keys = [];
  let token;
  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: hlsBase,
      ContinuationToken: token,
      MaxKeys: 1000
    }));
    for (const item of out.Contents || []) {
      if (
        item.Key
        && /\/playlist\.m3u8$/i.test(item.Key)
        && !item.Key.endsWith('/master.m3u8')
        && !item.Key.includes('.backup-')
        && !item.Key.includes('.trimmed-')
      ) {
        keys.push(item.Key);
      }
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  keys.sort();
  return keys.length ? keys : [key];
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
  const playlistKeys = await listRenditionPlaylistKeys(client, bucket, key);
  const stamp = Date.now();
  const trimmedKeys = [];
  let keptDuration = 0;

  for (const playlistKey of playlistKeys) {
    const original = await getObjectText(client, bucket, playlistKey);
    const trimmed = trimMediaPlaylist(original, startSeconds, endSeconds);
    const duration = playlistDurationSeconds(trimmed);
    if (playlistKey === key || !keptDuration) {
      keptDuration = duration;
    }
    const backupKey = playlistKey.replace(/\.m3u8$/i, `.backup-${stamp}.m3u8`);

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: backupKey,
      Body: original,
      ContentType: 'application/vnd.apple.mpegurl',
      CacheControl: 'no-cache, no-store, must-revalidate'
    }));

    const targetKey = replaceOriginal
      ? playlistKey
      : playlistKey.replace(/\.m3u8$/i, `.trimmed-${stamp}.m3u8`);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      Body: trimmed,
      ContentType: 'application/vnd.apple.mpegurl',
      CacheControl: 'no-cache, no-store, must-revalidate'
    }));

    trimmedKeys.push({ playlistKey, backupKey, targetKey, durationSeconds: duration });
  }

  archiveCache = { at: 0, masters: [] };
  const primary = trimmedKeys.find((item) => item.playlistKey === key) || trimmedKeys[0];
  return {
    ok: true,
    backupKey: primary?.backupKey,
    targetKey: primary?.targetKey,
    trimmedKeys,
    keptDuration,
    replaceOriginal: Boolean(replaceOriginal),
    updatedAt: stamp
  };
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

function recordingPrefixFromMasterKey(masterKey) {
  const normalized = String(masterKey || '').replace(/^\/+/, '');
  const match = normalized.match(/^(.*)\/media\/hls\/master\.m3u8$/i);
  if (!match) {
    const error = new Error('Invalid archive recording path.');
    error.status = 400;
    throw error;
  }
  const prefix = `${match[1]}/`;
  const configured = process.env.S3_PREFIX || '';
  if (configured && !prefix.startsWith(configured)) {
    const error = new Error('Recording path outside configured prefix.');
    error.status = 403;
    throw error;
  }
  return prefix;
}

async function deleteArchiveRecording(storagePath) {
  const client = createS3Client();
  const bucket = process.env.S3_BUCKET;
  if (!client || !bucket) {
    const error = new Error('S3 is not configured.');
    error.status = 500;
    throw error;
  }

  const masterKey = assertAllowedKey(storagePath);
  const prefix = recordingPrefixFromMasterKey(masterKey);
  let deleted = 0;
  let token;

  do {
    const out = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token,
      MaxKeys: 1000
    }));
    const objects = (out.Contents || []).map((item) => ({ Key: item.Key }));
    if (objects.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects, Quiet: true }
      }));
      deleted += objects.length;
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  if (!deleted) {
    const error = new Error('Recording not found or already deleted.');
    error.status = 404;
    throw error;
  }

  archiveCache = { at: 0, masters: [] };
  return { ok: true, deletedObjects: deleted, prefix };
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
  deleteArchiveRecording,
  buildLiveEvent,
  createS3Client,
  ensureBucketCors,
  preferredPlaybackKey,
  playlistDurationSeconds
};
