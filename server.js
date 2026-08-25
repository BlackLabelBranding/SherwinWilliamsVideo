require('dotenv').config();

const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { listArchiveRecordings, buildPresignedPlaylist, trimAndReplacePlaylist, ensureBucketCors } = require('./lib/s3-archive');
const { listActiveLiveStreams, pickLiveEvent } = require('./lib/ivs-live');
const {
  isCognitoEnabled,
  signUp,
  signIn,
  changePassword,
  listUserProfiles
} = require('./lib/aws-auth');

const app = express();
const PORT = process.env.PORT || 3000;

/** static | cognito | both — both = Cognito first, then static fallback */
function authMode() {
  const mode = String(process.env.AUTH_MODE || 'both').toLowerCase().trim();
  if (mode === 'cognito' || mode === 'static' || mode === 'both') return mode;
  return 'both';
}

function allowStaticAuth() {
  const mode = authMode();
  return mode === 'static' || mode === 'both';
}

function allowCognitoAuth() {
  const mode = authMode();
  return (mode === 'cognito' || mode === 'both') && isCognitoEnabled();
}

// Local demo / fallback accounts (always available when AUTH_MODE is static or both)
let users = [
  { id: '1', username: 'driver1', password: 'pass123', display_name: 'Driver One', role: 'driver', active: true },
  { id: '2', username: 'driver2', password: 'pass123', display_name: 'Driver Two', role: 'driver', active: true },
  { id: '3', username: 'admin', password: 'admin123@#', display_name: 'Admin User', role: 'admin', active: true }
];

let sessions = {};
let commentsByKey = {};
let selectedLiveId = null;
let liveEvent = pickLiveEvent([]);
let liveStreams = [];

async function refreshLiveFromIvs() {
  try {
    liveStreams = await listActiveLiveStreams();
  } catch (error) {
    console.warn('IVS list streams failed:', error.message);
    liveStreams = [];
  }
  liveEvent = pickLiveEvent(liveStreams, selectedLiveId);
  if (liveEvent?.playback_url) {
    selectedLiveId = liveEvent.id;
  } else {
    selectedLiveId = null;
  }
  return { live: liveEvent, liveStreams };
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return auth.trim() || '';
}

function publicUser(user) {
  return {
    user_id: user.id,
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    must_change_password: Boolean(user.must_change_password),
    active: user.active !== false
  };
}

function resolveSessionUser(session) {
  if (!session) return null;
  if (session.user) return session.user;
  return users.find((u) => u.username === session.username) || null;
}

function createSession(user, extra = {}) {
  const token = uuidv4();
  sessions[token] = {
    username: user.username,
    user: {
      id: user.id,
      username: user.username,
      password: '',
      display_name: user.display_name,
      role: user.role,
      active: user.active !== false,
      must_change_password: Boolean(user.must_change_password)
    },
    timestamp: Date.now(),
    ...extra
  };
  return token;
}

function staticLogin(username, password) {
  const user = users.find((u) => u.username === username && u.password === password && u.active !== false);
  if (!user) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }
  return user;
}

function staticUserRows() {
  return users.map((u) => ({
    id: u.id,
    user_id: u.id,
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    employee_id: u.employee_id || '',
    active: u.active !== false,
    last_login_at: null,
    source: 'static'
  }));
}

function requireUser(req, res) {
  const token = bearerToken(req);
  const session = token ? sessions[token] : null;
  if (!session) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return null;
  }
  const user = resolveSessionUser(session);
  if (!user) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return null;
  }
  return { token, user, session };
}

function requireAdmin(req, res) {
  const auth = requireUser(req, res);
  if (!auth) return null;
  if (auth.user.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin access required' });
    return null;
  }
  return auth;
}

function commentKey(contentType, contentId) {
  return `${contentType}:${contentId}`;
}

function sessionFromAccess(access) {
  const token = String(access || '').trim();
  if (!token || !sessions[token]) return null;
  const user = resolveSessionUser(sessions[token]);
  if (!user) return null;
  return { token, user };
}

app.post('/api/auth', async (req, res) => {
  const body = req.body || {};

  if (body.action === 'login') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    let lastError = null;

    if (allowCognitoAuth()) {
      try {
        const result = await signIn({ username, password });
        const token = createSession({
          id: result.profile.user_id || result.profile.username,
          username: result.profile.username,
          display_name: result.profile.display_name || result.profile.username,
          role: result.profile.role || 'driver',
          active: result.profile.active !== false
        }, { cognitoAccessToken: result.accessToken });
        return res.json({ ok: true, token, ...publicUser(sessions[token].user) });
      } catch (error) {
        lastError = error;
        if (authMode() === 'cognito') {
          const status = error.status || (/not confirmed/i.test(error.message) ? 403 : 401);
          return res.status(status).json({ ok: false, error: error.message });
        }
        // both: fall through to static
      }
    }

    if (allowStaticAuth()) {
      try {
        const user = staticLogin(username, password);
        const token = createSession(user);
        return res.json({ ok: true, token, ...publicUser(sessions[token].user) });
      } catch (error) {
        lastError = error;
      }
    }

    if (!allowCognitoAuth() && !allowStaticAuth()) {
      return res.status(503).json({
        ok: false,
        error: 'No auth configured. Set AUTH_MODE=static|both, or AUTH_MODE=cognito with Cognito env vars.'
      });
    }

    const status = lastError?.status || 401;
    return res.status(status).json({
      ok: false,
      error: lastError?.message || 'Invalid username or password'
    });
  }

  const auth = requireUser(req, res);
  if (!auth) return;

  if (body.action === 'session') {
    return res.json({ ok: true, user: publicUser(auth.user) });
  }

  if (body.action === 'logout') {
    delete sessions[auth.token];
    return res.json({ ok: true });
  }

  if (body.action === 'change-password') {
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters.' });
    }

    try {
      if (auth.session.cognitoAccessToken) {
        await changePassword({
          accessToken: auth.session.cognitoAccessToken,
          currentPassword,
          newPassword
        });
        return res.json({ ok: true });
      }

      const local = users.find((u) => u.username === auth.user.username);
      if (!local || local.password !== currentPassword) {
        return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
      }
      local.password = newPassword;
      local.must_change_password = false;
      if (auth.session.user) auth.session.user.must_change_password = false;
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Unsupported action' });
});

app.get('/api/content', async (req, res) => {
  const auth = requireUser(req, res);
  if (!auth) return;

  try {
    const liveState = await refreshLiveFromIvs();
    const archive = await listArchiveRecordings(auth.token);
    if (!archive.ok) {
      return res.status(500).json({
        ok: false,
        error: archive.error,
        live: liveState.live,
        liveStreams: liveState.liveStreams,
        media: []
      });
    }
    res.json({
      ok: true,
      live: liveState.live,
      liveStreams: liveState.liveStreams,
      media: archive.media
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Failed to load archive from S3.' });
  }
});

app.post('/api/content', (req, res) => {
  const auth = requireUser(req, res);
  if (!auth) return;
  const body = req.body || {};

  if (body.action === 'comments') {
    const key = commentKey(body.contentType, body.contentId);
    return res.json({ ok: true, comments: commentsByKey[key] || [] });
  }

  if (body.action === 'comment') {
    if (!body.body?.trim()) {
      return res.status(400).json({ ok: false, error: 'Comment is required.' });
    }
    const key = commentKey(body.contentType, body.contentId);
    if (!commentsByKey[key]) commentsByKey[key] = [];
    const comment = {
      id: uuidv4(),
      user_id: auth.user.id,
      display_name: auth.user.display_name,
      body: body.body.trim(),
      created_at: new Date().toISOString()
    };
    commentsByKey[key].push(comment);
    return res.json({ ok: true, comment });
  }

  return res.status(400).json({ ok: false, error: 'Unsupported action' });
});

// Serves rewritten HLS playlists; segment URLs inside are S3 presigned (browser → S3 direct)
app.get('/api/hls', async (req, res) => {
  const auth = sessionFromAccess(req.query.access);
  if (!auth) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const file = await buildPresignedPlaylist(String(req.query.key || ''), auth.token);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(file.body);
  } catch (error) {
    const status = error.status || error.$metadata?.httpStatusCode || 500;
    res.status(status).json({ ok: false, error: error.message || 'Failed to build playlist.' });
  }
});

app.post('/api/metrics', (req, res) => {
  const auth = requireUser(req, res);
  if (!auth) return;
  const body = req.body || {};

  if (body.action === 'start') {
    return res.json({ ok: true, sessionId: uuidv4() });
  }
  if (body.action === 'heartbeat') {
    return res.json({ ok: true, currentViewers: 1 });
  }
  if (body.action === 'end') {
    return res.json({ ok: true });
  }
  if (body.action === 'dashboard') {
    if (auth.user.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }
    return res.json({ ok: true, live: [], media: [], active: [] });
  }

  return res.status(400).json({ ok: false, error: 'Unsupported action' });
});

app.get('/api/admin', async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  try {
    const liveState = await refreshLiveFromIvs();
    const archive = await listArchiveRecordings(auth.token);
    let userRows = allowStaticAuth() ? staticUserRows() : [];

    if (allowCognitoAuth()) {
      try {
        const cognitoRows = (await listUserProfiles()).map((u) => ({
          ...u,
          id: u.user_id || u.username,
          source: 'cognito'
        }));
        const byUsername = new Map(userRows.map((u) => [u.username, u]));
        for (const row of cognitoRows) {
          byUsername.set(row.username, row);
        }
        userRows = Array.from(byUsername.values());
      } catch (error) {
        // DynamoDB optional when Cognito not fully wired; keep static list
        console.warn('listUserProfiles failed:', error.message);
      }
    }

    res.json({
      ok: true,
      users: userRows,
      live: liveState.live,
      liveStreams: liveState.liveStreams,
      media: archive.media || []
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/admin', async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const body = req.body || {};

  if (body.action === 'save-live' || body.action === 'select-live') {
    const liveState = await refreshLiveFromIvs();
    const wanted = String(body.channelId || body.id || '').trim();
    if (wanted) {
      const match = liveState.liveStreams.find((s) => s.id === wanted || s.channel_arn === wanted);
      if (!match) {
        return res.status(404).json({ ok: false, error: 'That stream is not currently live on IVS.' });
      }
      selectedLiveId = match.id;
      liveEvent = match;
    }
    return res.json({ ok: true, live: liveEvent, liveStreams: liveState.liveStreams });
  }

  if (body.action === 'create-user') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();
    const employeeId = String(body.employeeId || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'driver';

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password are required.' });
    }

    if (allowCognitoAuth()) {
      try {
        const result = await signUp({
          username,
          password,
          displayName,
          employeeId,
          role,
          email: String(body.email || '').trim()
        });
        return res.json({ ok: true, id: result.user?.user_id || result.user?.username });
      } catch (error) {
        return res.status(error.status || 500).json({ ok: false, error: error.message });
      }
    }

    if (users.some((u) => u.username === username)) {
      return res.status(400).json({ ok: false, error: 'Username already exists.' });
    }
    const id = uuidv4();
    users.push({
      id,
      username,
      password,
      display_name: displayName || username,
      employee_id: employeeId,
      role,
      active: true,
      must_change_password: true
    });
    return res.json({ ok: true, id });
  }

  if (body.action === 'reset-password') {
    const userId = String(body.userId || body.id || '').trim();
    const local = users.find((u) => u.id === userId || u.username === userId);
    if (local) {
      const temp = String(body.password || 'pass123');
      local.password = temp;
      local.must_change_password = true;
      return res.json({ ok: true, temporaryPassword: temp });
    }
    return res.status(400).json({
      ok: false,
      error: 'For Cognito users, reset password in the Cognito console (or Forgot Password flow).'
    });
  }

  if (body.action === 'set-user-active') {
    const userId = String(body.userId || body.id || '').trim();
    const local = users.find((u) => u.id === userId || u.username === userId);
    if (local) {
      local.active = body.active !== false;
      return res.json({ ok: true });
    }
    return res.json({ ok: true });
  }

  if (body.action === 'trim-media') {
    try {
      const result = await trimAndReplacePlaylist({
        playbackKey: body.playbackKey || body.storagePath,
        startSeconds: body.startSeconds,
        endSeconds: body.endSeconds,
        replaceOriginal: body.replaceOriginal !== false
      });
      return res.json(result);
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ ok: false, error: error.message });
    }
  }

  return res.status(400).json({ ok: false, error: 'Unsupported action' });
});

app.post('/api/login', (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Deprecated endpoint. Use /api/auth with action=login.'
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  const mode = authMode();
  const cognito = allowCognitoAuth() ? 'on' : 'off';
  const staticOn = allowStaticAuth() ? 'on' : 'off';
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Auth mode: ${mode} (static=${staticOn}, cognito=${cognito})`);
  console.log(`S3 archive bucket: ${process.env.S3_BUCKET || '(not set)'} | Live: auto-detect from IVS`);
  ensureBucketCors().catch(() => {});
});
