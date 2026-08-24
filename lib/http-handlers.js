const { listArchiveRecordings, buildPresignedPlaylist, trimAndReplacePlaylist, ensureBucketCors } = require('./s3-archive');
const { listActiveLiveStreams, pickLiveEvent } = require('./ivs-live');
const { signUp, signIn, changePassword, listUserProfiles } = require('./aws-auth');
const {
  uuidv4,
  authMode,
  allowStaticAuth,
  allowCognitoAuth,
  users,
  sessions,
  commentsByKey,
  getSelectedLiveId,
  setSelectedLiveId,
  getLiveEvent,
  setLiveEvent,
  getLiveStreams,
  setLiveStreams,
  publicUser,
  createSession,
  staticLogin,
  staticUserRows,
  sessionFromAccess,
  requireUser,
  requireAdmin,
  commentKey
} = require('./runtime-state');

function json(status, payload) {
  return { status, json: payload };
}

async function refreshLiveFromIvs() {
  let liveStreams = [];
  try {
    liveStreams = await listActiveLiveStreams();
  } catch (error) {
    console.warn('IVS list streams failed:', error.message);
    liveStreams = [];
  }
  setLiveStreams(liveStreams);
  const liveEvent = pickLiveEvent(liveStreams, getSelectedLiveId());
  setLiveEvent(liveEvent);
  if (liveEvent?.playback_url) {
    setSelectedLiveId(liveEvent.id);
  } else {
    setSelectedLiveId(null);
  }
  return { live: liveEvent, liveStreams };
}

async function handleAuth(request) {
  const body = await request.json().catch(() => ({}));

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
        return json(200, { ok: true, token, ...publicUser(sessions[token].user) });
      } catch (error) {
        lastError = error;
        if (authMode() === 'cognito') {
          const status = error.status || (/not confirmed/i.test(error.message) ? 403 : 401);
          return json(status, { ok: false, error: error.message });
        }
      }
    }

    if (allowStaticAuth()) {
      try {
        const user = staticLogin(username, password);
        const token = createSession(user);
        return json(200, { ok: true, token, ...publicUser(sessions[token].user) });
      } catch (error) {
        lastError = error;
      }
    }

    if (!allowCognitoAuth() && !allowStaticAuth()) {
      return json(503, {
        ok: false,
        error: 'No auth configured. Set AUTH_MODE=static|both, or AUTH_MODE=cognito with Cognito env vars.'
      });
    }

    return json(lastError?.status || 401, {
      ok: false,
      error: lastError?.message || 'Invalid username or password'
    });
  }

  let auth;
  try {
    auth = requireUser(request);
  } catch (error) {
    return json(error.status || 401, { ok: false, error: error.message });
  }

  if (body.action === 'session') {
    return json(200, { ok: true, user: publicUser(auth.user) });
  }

  if (body.action === 'logout') {
    delete sessions[auth.token];
    return json(200, { ok: true });
  }

  if (body.action === 'change-password') {
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!newPassword || newPassword.length < 6) {
      return json(400, { ok: false, error: 'New password must be at least 6 characters.' });
    }

    try {
      if (auth.session.cognitoAccessToken) {
        await changePassword({
          accessToken: auth.session.cognitoAccessToken,
          currentPassword,
          newPassword
        });
        return json(200, { ok: true });
      }

      const local = users.find((u) => u.username === auth.user.username);
      if (!local || local.password !== currentPassword) {
        return json(401, { ok: false, error: 'Current password is incorrect.' });
      }
      local.password = newPassword;
      local.must_change_password = false;
      if (auth.session.user) auth.session.user.must_change_password = false;
      return json(200, { ok: true });
    } catch (error) {
      return json(error.status || 400, { ok: false, error: error.message });
    }
  }

  return json(400, { ok: false, error: 'Unsupported action' });
}

async function handleContentGet(request) {
  let auth;
  try {
    auth = requireUser(request);
  } catch (error) {
    return json(error.status || 401, { ok: false, error: error.message });
  }

  try {
    const liveState = await refreshLiveFromIvs();
    const archive = await listArchiveRecordings(auth.token);
    if (!archive.ok) {
      return json(500, {
        ok: false,
        error: archive.error,
        live: liveState.live,
        liveStreams: liveState.liveStreams,
        media: []
      });
    }
    return json(200, {
      ok: true,
      live: liveState.live,
      liveStreams: liveState.liveStreams,
      media: archive.media
    });
  } catch (error) {
    return json(500, { ok: false, error: error.message || 'Failed to load archive from S3.' });
  }
}

async function handleContentPost(request) {
  let auth;
  try {
    auth = requireUser(request);
  } catch (error) {
    return json(error.status || 401, { ok: false, error: error.message });
  }

  const body = await request.json().catch(() => ({}));

  if (body.action === 'comments') {
    const key = commentKey(body.contentType, body.contentId);
    return json(200, { ok: true, comments: commentsByKey[key] || [] });
  }

  if (body.action === 'comment') {
    if (!body.body?.trim()) {
      return json(400, { ok: false, error: 'Comment is required.' });
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
    return json(200, { ok: true, comment });
  }

  return json(400, { ok: false, error: 'Unsupported action' });
}

async function handleHls(request) {
  const url = new URL(request.url);
  const access = url.searchParams.get('access');
  const key = url.searchParams.get('key');
  const auth = sessionFromAccess(access);
  if (!auth) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  try {
    const file = await buildPresignedPlaylist(String(key || ''), auth.token);
    return {
      status: 200,
      body: file.body,
      headers: {
        'Content-Type': file.contentType || 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, max-age=60',
        'Access-Control-Allow-Origin': '*'
      }
    };
  } catch (error) {
    const status = error.status || error.$metadata?.httpStatusCode || 500;
    return json(status, { ok: false, error: error.message || 'Failed to build playlist.' });
  }
}

async function handleMetrics(request) {
  let auth;
  try {
    auth = requireUser(request);
  } catch (error) {
    return json(error.status || 401, { ok: false, error: error.message });
  }
  const body = await request.json().catch(() => ({}));

  if (body.action === 'start') {
    return json(200, { ok: true, sessionId: uuidv4() });
  }
  if (body.action === 'heartbeat') {
    return json(200, { ok: true, currentViewers: 1 });
  }
  if (body.action === 'end') {
    return json(200, { ok: true });
  }
  if (body.action === 'dashboard') {
    if (auth.user.role !== 'admin') {
      return json(403, { ok: false, error: 'Admin access required' });
    }
    return json(200, { ok: true, live: [], media: [], active: [] });
  }

  return json(400, { ok: false, error: 'Unsupported action' });
}

async function handleAdminGet(request) {
  let auth;
  try {
    auth = requireAdmin(request);
  } catch (error) {
    return json(error.status || 401, { ok: false, error: error.message });
  }

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
        console.warn('listUserProfiles failed:', error.message);
      }
    }

    return json(200, {
      ok: true,
      users: userRows,
      live: liveState.live,
      liveStreams: liveState.liveStreams,
      media: archive.media || []
    });
  } catch (error) {
    return json(500, { ok: false, error: error.message });
  }
}

async function handleAdminPost(request) {
  let auth;
  try {
    auth = requireAdmin(request);
  } catch (error) {
    return json(error.status || 401, { ok: false, error: error.message });
  }
  const body = await request.json().catch(() => ({}));

  if (body.action === 'save-live' || body.action === 'select-live') {
    const liveState = await refreshLiveFromIvs();
    const wanted = String(body.channelId || body.id || '').trim();
    if (wanted) {
      const match = liveState.liveStreams.find((s) => s.id === wanted || s.channel_arn === wanted);
      if (!match) {
        return json(404, { ok: false, error: 'That stream is not currently live on IVS.' });
      }
      setSelectedLiveId(match.id);
      setLiveEvent(match);
    }
    return json(200, { ok: true, live: getLiveEvent(), liveStreams: liveState.liveStreams });
  }

  if (body.action === 'create-user') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();
    const employeeId = String(body.employeeId || '').trim();
    const role = body.role === 'admin' ? 'admin' : 'driver';

    if (!username || !password) {
      return json(400, { ok: false, error: 'Username and password are required.' });
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
        return json(200, { ok: true, id: result.user?.user_id || result.user?.username });
      } catch (error) {
        return json(error.status || 500, { ok: false, error: error.message });
      }
    }

    if (users.some((u) => u.username === username)) {
      return json(400, { ok: false, error: 'Username already exists.' });
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
    return json(200, { ok: true, id });
  }

  if (body.action === 'reset-password') {
    const userId = String(body.userId || body.id || '').trim();
    const local = users.find((u) => u.id === userId || u.username === userId);
    if (local) {
      const temp = String(body.password || 'pass123');
      local.password = temp;
      local.must_change_password = true;
      return json(200, { ok: true, temporaryPassword: temp });
    }
    return json(400, {
      ok: false,
      error: 'For Cognito users, reset password in the Cognito console (or Forgot Password flow).'
    });
  }

  if (body.action === 'set-user-active') {
    const userId = String(body.userId || body.id || '').trim();
    const local = users.find((u) => u.id === userId || u.username === userId);
    if (local) {
      local.active = body.active !== false;
      return json(200, { ok: true });
    }
    return json(200, { ok: true });
  }

  if (body.action === 'trim-media') {
    try {
      const result = await trimAndReplacePlaylist({
        playbackKey: body.playbackKey || body.storagePath,
        startSeconds: body.startSeconds,
        endSeconds: body.endSeconds,
        replaceOriginal: body.replaceOriginal !== false
      });
      return json(200, result);
    } catch (error) {
      return json(error.status || 500, { ok: false, error: error.message });
    }
  }

  return json(400, { ok: false, error: 'Unsupported action' });
}

function boot() {
  const mode = authMode();
  const cognito = allowCognitoAuth() ? 'on' : 'off';
  const staticOn = allowStaticAuth() ? 'on' : 'off';
  console.log(`Auth mode: ${mode} (static=${staticOn}, cognito=${cognito})`);
  console.log(`S3 archive bucket: ${process.env.S3_BUCKET || '(not set)'} | Live: auto-detect from IVS`);
  ensureBucketCors().catch(() => {});
}

module.exports = {
  handleAuth,
  handleContentGet,
  handleContentPost,
  handleHls,
  handleMetrics,
  handleAdminGet,
  handleAdminPost,
  boot
};
