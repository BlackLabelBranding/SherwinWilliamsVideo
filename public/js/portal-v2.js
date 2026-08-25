const app = document.getElementById('app');

const state = {
  token: localStorage.getItem('sw_session_token') || '',
  user: null,
  live: null,
  liveStreams: [],
  selectedLiveId: localStorage.getItem('sw_selected_live_id') || '',
  media: [],
  currentView: null,
  heartbeatTimer: null,
  adminTimer: null,
  livePollTimer: null,
  _lastLiveIds: ''
};

const BRAND_LOGO = 'https://kilmhwlsqgjxjhvsweqb.supabase.co/storage/v1/object/sign/sherwin%20williams%20test/swlogo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iZjdlOGY4OS00MDI1LTQxMDItYTY4OS0zNGU4YzIzOGUxODYiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJzaGVyd2luIHdpbGxpYW1zIHRlc3Qvc3dsb2dvLnBuZyIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODI0MDMzMTcsImV4cCI6MTgxMzkzOTMxN30.TGAWii5ki334PMuX7End29HH6BdmNHA2dN7XX5VrOj8';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function fmtDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function fmtDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function shell(content, active = 'live') {
  const adminButton = state.user?.role === 'admin'
    ? `<button class="nav-item ${active === 'admin' ? 'active' : ''}" data-nav="admin">Admin</button>`
    : '';
  return `
    <nav class="nav">
      <button class="nav-item ${active === 'live' ? 'active' : ''}" data-nav="live">Live Stream</button>
      <button class="nav-item ${active === 'archive' ? 'active' : ''}" data-nav="archive">Archive</button>
      ${adminButton}
    </nav>
    <main class="app-shell portal-v2">
      <header class="brand-header">
        <img src="${BRAND_LOGO}" alt="Sherwin-Williams logo" class="brand-logo" />
        <div class="brand-copy">
          <p class="eyebrow">Driver Communications Portal</p>
          <h1>Sherwin-Williams Live</h1>
          <p class="portal-user">Signed in as ${escapeHtml(state.user?.display_name || state.user?.username || '')}</p>
        </div>
      </header>
      ${content}
      <div class="portal-footer-actions">
        <button id="change-password-btn" class="secondary-button">Change Password</button>
        <button id="logout-btn" class="secondary-button">Log Out</button>
      </div>
    </main>
  `;
}

function wireShell() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.nav === 'live') renderLive();
      if (button.dataset.nav === 'archive') renderArchive();
      if (button.dataset.nav === 'admin') renderAdmin();
    });
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('change-password-btn')?.addEventListener('click', renderChangePassword);
}

function stopAdminRefresh() {
  if (state.adminTimer) clearInterval(state.adminTimer);
  state.adminTimer = null;
  stopLivePoll();
}

function stopLivePoll() {
  if (state.livePollTimer) clearInterval(state.livePollTimer);
  state.livePollTimer = null;
}

function startLivePoll() {
  stopLivePoll();
  state.livePollTimer = setInterval(async () => {
    if (!document.querySelector('.live-grid') && !document.getElementById('admin-live-streams')) return;
    try {
      await loadContent();
      const ids = (state.liveStreams || []).map((s) => s.id).sort().join(',');
      if (ids !== state._lastLiveIds) {
        state._lastLiveIds = ids;
        if (document.querySelector('.live-grid')) renderLive();
        else if (document.getElementById('admin-live-streams')) fillAdminLiveStreams();
      }
    } catch (error) {
      console.warn('Live stream poll failed.', error);
    }
  }, 12000);
}

function resolveActiveLive() {
  const streams = state.liveStreams || [];
  if (state.selectedLiveId) {
    const selected = streams.find((s) => s.id === state.selectedLiveId);
    if (selected) return selected;
  }
  if (state.live?.status === 'live' && state.live?.playback_url) return state.live;
  return streams[0] || state.live || null;
}

function liveStreamListHtml(streams, activeId, emptyText) {
  if (!streams.length) {
    return `<p class="empty-comments">${escapeHtml(emptyText || 'No active streams on AWS IVS right now.')}</p>`;
  }
  return streams.map((stream) => {
    const active = stream.id === activeId;
    const started = stream.started_at ? fmtDate(stream.started_at) : '';
    return `<button type="button" class="live-stream-item ${active ? 'active' : ''}" data-live-id="${escapeHtml(stream.id)}">
      <span class="live-stream-dot"></span>
      <span class="live-stream-copy">
        <strong>${escapeHtml(stream.title)}</strong>
        <span>${started ? `Started ${escapeHtml(started)}` : 'Live now'}${stream.viewer_count != null ? ` · ${stream.viewer_count} viewers` : ''}</span>
      </span>
      <span class="live-stream-badge">${active ? 'Watching' : 'Live'}</span>
    </button>`;
  }).join('');
}

async function selectLiveStream(streamId, { persist = false } = {}) {
  const stream = (state.liveStreams || []).find((s) => s.id === streamId);
  if (!stream) return;
  state.selectedLiveId = stream.id;
  state.live = stream;
  localStorage.setItem('sw_selected_live_id', stream.id);
  if (persist && state.user?.role === 'admin') {
    try {
      await api('/api/admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'select-live', channelId: stream.id })
      });
    } catch (error) {
      console.warn('Could not persist selected live stream.', error);
    }
  }
}

async function endTracking() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
  const current = state.currentView;
  state.currentView = null;
  if (!current?.sessionId) return;
  try {
    await api('/api/metrics', {
      method: 'POST',
      body: JSON.stringify({ action: 'end', sessionId: current.sessionId, watchSeconds: Math.round((Date.now() - current.startedAt) / 1000) })
    });
  } catch (error) {
    console.warn('Could not end analytics session.', error);
  }
}

async function startTracking(contentType, contentId) {
  if (!contentId || state.currentView?.contentId === contentId) return;
  await endTracking();
  try {
    const deviceId = localStorage.getItem('sw_device_id') || crypto.randomUUID();
    localStorage.setItem('sw_device_id', deviceId);
    const result = await api('/api/metrics', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', contentType, contentId, deviceId })
    });
    state.currentView = { sessionId: result.sessionId, contentId, startedAt: Date.now() };
    state.heartbeatTimer = setInterval(async () => {
      if (!state.currentView) return;
      try {
        await api('/api/metrics', {
          method: 'POST',
          body: JSON.stringify({ action: 'heartbeat', sessionId: state.currentView.sessionId, watchSeconds: Math.round((Date.now() - state.currentView.startedAt) / 1000) })
        });
      } catch (error) {
        console.warn('Analytics heartbeat failed.', error);
      }
    }, 15000);
  } catch (error) {
    console.warn('Could not start analytics session.', error);
  }
}

window.addEventListener('beforeunload', () => {
  if (!state.currentView?.sessionId) return;
  const payload = JSON.stringify({ action: 'end', sessionId: state.currentView.sessionId, watchSeconds: Math.round((Date.now() - state.currentView.startedAt) / 1000) });
  navigator.sendBeacon?.('/api/metrics', new Blob([payload], { type: 'application/json' }));
});

function renderLogin(message = '') {
  stopAdminRefresh();
  endTracking();
  app.innerHTML = `
    <main class="login-page">
      <section class="login-card">
        <img src="${BRAND_LOGO}" alt="Sherwin-Williams logo" class="login-logo" />
        <div class="login-copy">
          <p class="eyebrow">Driver Communications Portal</p>
          <h1>Log In</h1>
          <p>Use your assigned driver account to access live broadcasts and recordings.</p>
        </div>
        <form id="login-form" class="login-form">
          <input type="text" id="username" placeholder="Username" autocomplete="username" required />
          <input type="password" id="password" placeholder="Password" autocomplete="current-password" required />
          <button type="submit" class="primary-button">Log In</button>
        </form>
        <div id="error" class="error-message">${escapeHtml(message)}</div>
      </section>
    </main>
  `;

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const result = await api('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'login', username: document.getElementById('username').value.trim(), password: document.getElementById('password').value })
      });
      state.token = result.token;
      state.user = {
        id: result.user_id,
        username: result.username,
        display_name: result.display_name,
        role: result.role,
        must_change_password: result.must_change_password
      };
      localStorage.setItem('sw_session_token', state.token);
      if (state.user.must_change_password) renderChangePassword(true);
      else await loadContentAndRender();
    } catch (error) {
      document.getElementById('error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

}

async function restoreSession() {
  if (!state.token) return false;
  try {
    const result = await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'session' }) });
    state.user = result.user;
    return true;
  } catch {
    state.token = '';
    state.user = null;
    localStorage.removeItem('sw_session_token');
    return false;
  }
}

async function logout() {
  stopAdminRefresh();
  await endTracking();
  try { await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); } catch {}
  state.token = '';
  state.user = null;
  localStorage.removeItem('sw_session_token');
  renderLogin();
}

function renderChangePassword(required = false) {
  stopAdminRefresh();
  endTracking();
  app.innerHTML = shell(`
    <section class="portal-card narrow-card">
      <p class="eyebrow">Account Security</p>
      <h2>${required ? 'Create a New Password' : 'Change Password'}</h2>
      <p>${required ? 'Your temporary password must be changed before continuing.' : 'Choose a password with at least 10 characters.'}</p>
      <form id="password-form" class="portal-form">
        <label>Current Password<input type="password" id="current-password" required /></label>
        <label>New Password<input type="password" id="new-password" minlength="10" required /></label>
        <label>Confirm New Password<input type="password" id="confirm-password" minlength="10" required /></label>
        <button class="primary-button" type="submit">Save Password</button>
        <div id="password-error" class="error-message"></div>
      </form>
    </section>
  `, '');
  wireShell();
  if (required) document.querySelectorAll('[data-nav], #logout-btn, #change-password-btn').forEach(el => { if (el.id !== 'logout-btn') el.style.display = 'none'; });
  document.getElementById('password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    if (newPassword !== confirm) return document.getElementById('password-error').textContent = 'New passwords do not match.';
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'change-password', currentPassword, newPassword }) });
      state.user.must_change_password = false;
      await loadContentAndRender();
    } catch (error) {
      document.getElementById('password-error').textContent = error.message;
    }
  });
}

async function loadContent() {
  const result = await api('/api/content');
  state.live = result.live;
  state.liveStreams = result.liveStreams || [];
  state.media = result.media || [];
  if (state.selectedLiveId && !state.liveStreams.some((s) => s.id === state.selectedLiveId)) {
    state.selectedLiveId = state.liveStreams[0]?.id || '';
    if (state.selectedLiveId) localStorage.setItem('sw_selected_live_id', state.selectedLiveId);
    else localStorage.removeItem('sw_selected_live_id');
  }
}

async function loadContentAndRender() {
  try {
    await loadContent();
    renderLive();
  } catch (error) {
    if (error.status === 401) return renderLogin('Your session expired. Please sign in again.');
    app.innerHTML = `<main class="login-page"><section class="login-card"><h1>Portal Error</h1><p>${escapeHtml(error.message)}</p></section></main>`;
  }
}

function isHlsUrl(url) {
  return url.includes('playback.live-video.net')
    || url.includes('.m3u8')
    || url.includes('/api/hls');
}

function destroyPlayers(element) {
  if (!element) return;
  if (element._ivsPlayer) {
    try { element._ivsPlayer.delete(); } catch {}
    element._ivsPlayer = null;
  }
  if (element._hlsPlayer) {
    try { element._hlsPlayer.destroy(); } catch {}
    element._hlsPlayer = null;
  }
}

function initVideoPlayer(element, url, contentType, contentId) {
  if (!element || !url) return;
  destroyPlayers(element);
  const begin = () => startTracking(contentType, contentId);
  element.addEventListener('playing', begin, { once: true });

  const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).toString();
  const isArchiveProxy = url.includes('/api/hls');
  const isIvsLive = url.includes('playback.live-video.net');

  // Archive HLS from private S3 proxy — use hls.js (Chrome) or native Safari
  if (isArchiveProxy || (isHlsUrl(url) && !isIvsLive)) {
    if (window.Hls?.isSupported()) {
      const hls = new window.Hls({
        enableWorker: false,
        lowLatencyMode: false,
        startLevel: 0,
        capLevelToPlayerSize: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 120000,
        levelLoadingTimeOut: 120000,
        fragLoadingTimeOut: 180000,
        fragLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });
      hls.loadSource(absoluteUrl);
      hls.attachMedia(element);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        element.muted = true;
        element.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        console.warn('HLS playback error', data);
        if (!data?.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        }
      });
      element._hlsPlayer = hls;
      return;
    }
    if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = absoluteUrl;
      element.load();
      element.play().catch(() => {});
      return;
    }
  }

  if (isIvsLive && window.IVSPlayer?.isPlayerSupported) {
    const player = window.IVSPlayer.create();
    player.setLiveLowLatencyEnabled?.(true);
    player.attachHTMLVideoElement(element);
    player.load(absoluteUrl);
    player.play().catch(() => {});
    element._ivsPlayer = player;
    return;
  }

  element.src = absoluteUrl;
  element.load();
}

async function loadComments(contentType, contentId, listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  try {
    const result = await api('/api/content', { method: 'POST', body: JSON.stringify({ action: 'comments', contentType, contentId }) });
    list.innerHTML = result.comments?.length
      ? result.comments.map(comment => `<li class="live-comment"><div class="comment-bubble"><span class="comment-user">${escapeHtml(comment.display_name)}</span><span class="comment-time">${escapeHtml(fmtDate(comment.created_at))}</span><p>${escapeHtml(comment.body)}</p></div></li>`).join('')
      : '<li class="empty-comments">No comments yet.</li>';
  } catch (error) {
    list.innerHTML = `<li class="empty-comments">${escapeHtml(error.message)}</li>`;
  }
}

function wireCommentForm(formId, inputId, contentType, contentId, listId) {
  document.getElementById(formId)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById(inputId);
    if (!input.value.trim()) return;
    const value = input.value.trim();
    input.value = '';
    try {
      await api('/api/content', { method: 'POST', body: JSON.stringify({ action: 'comment', contentType, contentId, body: value }) });
      await loadComments(contentType, contentId, listId);
    } catch (error) {
      input.value = value;
      alert(error.message);
    }
  });
}

function renderLive() {
  stopAdminRefresh();
  endTracking();
  const streams = state.liveStreams || [];
  const live = resolveActiveLive();
  state.live = live;
  const isLive = live?.status === 'live' && Boolean(live?.playback_url);
  state._lastLiveIds = streams.map((s) => s.id).sort().join(',');

  app.innerHTML = shell(`
    <section class="content-grid live-grid">
      <div class="video-card">
        <div class="section-title-row">
          <div><p class="eyebrow">${isLive ? 'Live Now' : 'Broadcast'}</p><h2>${escapeHtml(live?.title || 'Sherwin-Williams Driver Live Stream')}</h2><p>${escapeHtml(live?.subtitle || 'Waiting for an IVS stream to start')}</p></div>
          <span class="live-pill ${isLive ? 'on' : 'off'}">${isLive ? 'LIVE' : 'OFF AIR'}</span>
        </div>
        ${streams.length > 1 ? `<div class="live-stream-list" id="live-stream-picker">${liveStreamListHtml(streams, live?.id, '')}</div>` : ''}
        ${isLive ? `<div class="video-shell"><video id="live-video" controls playsinline muted preload="metadata"></video></div><p class="video-note">Amazon IVS low-latency playback · auto-detects when a stream goes live.</p>` : '<div class="no-video">No live video at this time. When streaming starts on AWS IVS, it will appear here automatically.</div>'}
      </div>
      <aside class="chat-card">
        <div class="section-title-row compact"><div><p class="eyebrow">Live Comments</p><h2>Driver Chat</h2></div></div>
        <ul class="live-comment-list" id="live-comment-list"></ul>
        ${live ? `<form id="live-comment-form" class="comment-form"><textarea id="live-comment-body" placeholder="Add a live comment..." rows="3" required></textarea><button type="submit" class="primary-button">Send</button></form>` : ''}
      </aside>
    </section>
  `, 'live');
  wireShell();
  startLivePoll();

  document.querySelectorAll('#live-stream-picker [data-live-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await selectLiveStream(button.dataset.liveId);
      renderLive();
    });
  });

  if (isLive && live?.playback_url) initVideoPlayer(document.getElementById('live-video'), live.playback_url, 'live', live.id);
  if (live?.id) {
    loadComments('live', live.id, 'live-comment-list');
    wireCommentForm('live-comment-form', 'live-comment-body', 'live', live.id, 'live-comment-list');
  }
}

function renderArchive() {
  stopAdminRefresh();
  endTracking();
  app.innerHTML = shell(`
    <section class="archive-layout">
      <div class="archive-list-card">
        <p class="eyebrow">Past Broadcasts & Audio</p>
        <h2>Archive</h2>
        <div id="archive-list" class="archive-list"></div>
      </div>
      <div id="archive-details" class="archive-details-card"><div class="no-video">Select a recording.</div></div>
    </section>
  `, 'archive');
  wireShell();
  const list = document.getElementById('archive-list');
  if (!state.media.length) {
    list.innerHTML = '<p class="empty-comments">No published recordings yet.</p>';
    return;
  }
  state.media.forEach((item, index) => {
    const button = document.createElement('button');
    button.className = 'archive-item';
    button.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${item.media_type === 'audio' ? 'Audio' : 'Video'} · ${escapeHtml(new Date(item.recorded_at).toLocaleDateString())}</span>`;
    button.addEventListener('click', () => renderMediaDetails(item));
    list.appendChild(button);
    if (index === 0) renderMediaDetails(item);
  });
}

function renderMediaDetails(item) {
  endTracking();
  const panel = document.getElementById('archive-details');
  if (!panel) return;
  const mediaTag = item.media_type === 'audio'
    ? `<audio id="archive-media" controls preload="metadata" class="audio-player"></audio>`
    : `<div class="video-shell"><video id="archive-media" controls playsinline preload="metadata"></video></div>`;
  panel.innerHTML = `
    <div class="section-title-row"><div><p class="eyebrow">${item.media_type === 'audio' ? 'Audio Recording' : 'Archive Video'}</p><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(new Date(item.recorded_at).toLocaleDateString())}</p></div></div>
    ${item.description ? `<p class="media-description">${escapeHtml(item.description)}</p>` : ''}
    ${mediaTag}
    <div class="archive-comments-block">
      <h3>Comments</h3>
      <form id="archive-comment-form" class="comment-form archive-style"><textarea id="archive-comment-body" placeholder="Add a comment..." rows="3" required></textarea><button type="submit" class="primary-button">Post Comment</button></form>
      <ul class="archive-comment-list" id="archive-comment-list"></ul>
    </div>`;
  initVideoPlayer(document.getElementById('archive-media'), item.url, 'media', item.id);
  loadComments('media', item.id, 'archive-comment-list');
  wireCommentForm('archive-comment-form', 'archive-comment-body', 'media', item.id, 'archive-comment-list');
}

async function adminData() {
  return api('/api/admin');
}

function metricCard(value, label) {
  return `<div class="metric-card"><span class="metric-value">${escapeHtml(value)}</span><span class="metric-label">${escapeHtml(label)}</span></div>`;
}

async function refreshAdminMetrics() {
  const container = document.getElementById('admin-metrics');
  const viewers = document.getElementById('admin-viewers');
  if (!container || !viewers) return;
  try {
    const result = await api('/api/metrics', { method: 'POST', body: JSON.stringify({ action: 'dashboard' }) });
    const live = (result.live || []).find(row => row.id === state.live?.id) || result.live?.[0] || {};
    container.innerHTML = [
      metricCard(live.current_viewers || 0, 'Watching Now'),
      metricCard(live.peak_viewers || 0, 'Peak Viewers'),
      metricCard(live.unique_viewers || 0, 'Unique Drivers'),
      metricCard(fmtDuration(live.total_watch_seconds || 0), 'Total Watch Time')
    ].join('');
    viewers.innerHTML = result.active?.length
      ? result.active.map(row => `<tr><td>${escapeHtml(row.user?.display_name || row.user?.username || 'Driver')}</td><td>${escapeHtml(row.content_type)}</td><td>${fmtDuration(row.watch_seconds)}</td><td>${escapeHtml(fmtDate(row.last_heartbeat_at))}</td></tr>`).join('')
      : '<tr><td colspan="4">No active viewers.</td></tr>';
  } catch (error) {
    container.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`;
  }
}

function fillAdminLiveStreams() {
  const list = document.getElementById('admin-live-streams');
  const preview = document.getElementById('admin-live-preview');
  if (!list) return;
  const streams = state.liveStreams || [];
  const live = resolveActiveLive();
  list.innerHTML = liveStreamListHtml(streams, live?.id, 'No active streams. Start broadcasting on an AWS IVS channel and it will show up here.');

  list.querySelectorAll('[data-live-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await selectLiveStream(button.dataset.liveId, { persist: true });
      fillAdminLiveStreams();
    });
  });

  if (!preview) return;
  if (live?.status === 'live' && live?.playback_url) {
    preview.innerHTML = `
      <div class="section-title-row compact"><div><p class="eyebrow">Selected Stream</p><h3>${escapeHtml(live.title)}</h3></div><span class="live-pill on">LIVE</span></div>
      <div class="video-shell"><video id="admin-live-video" controls playsinline muted preload="metadata"></video></div>`;
    initVideoPlayer(document.getElementById('admin-live-video'), live.playback_url, 'live', live.id);
  } else {
    preview.innerHTML = '<div class="no-video">No live preview — waiting for an IVS stream.</div>';
  }
}

async function renderAdmin() {
  if (state.user?.role !== 'admin') return renderLive();
  stopAdminRefresh();
  await endTracking();
  let data;
  try { data = await adminData(); } catch (error) { return alert(error.message); }
  state.live = data.live || state.live;
  state.liveStreams = data.liveStreams || [];
  state._lastLiveIds = (state.liveStreams || []).map((s) => s.id).sort().join(',');

  app.innerHTML = shell(`
    <section class="admin-page">
      <div class="admin-heading"><div><p class="eyebrow">Administration</p><h2>Portal Control Center</h2></div><span class="admin-status">REAL DATA</span></div>

      <section class="portal-card">
        <div class="admin-section-title">
          <div>
            <h3>Live Streams</h3>
            <p>Auto-detected from AWS IVS. When a channel goes live it appears here. Click a stream to select and preview it.</p>
          </div>
          <button type="button" id="refresh-live-streams" class="secondary-button">Refresh</button>
        </div>
        <div id="admin-live-streams" class="live-stream-list"></div>
        <div id="admin-live-preview" class="admin-live-preview"></div>
      </section>

      <section class="portal-card">
        <div class="admin-section-title"><div><h3>Real-Time Analytics</h3><p>Updates every 10 seconds from driver viewing sessions.</p></div><button id="refresh-metrics" class="secondary-button">Refresh</button></div>
        <div id="admin-metrics" class="metrics-strip admin-metrics"></div>
        <div class="table-wrap"><table class="admin-table"><thead><tr><th>Driver</th><th>Content</th><th>Watch Time</th><th>Last Heartbeat</th></tr></thead><tbody id="admin-viewers"></tbody></table></div>
      </section>

      <section class="portal-card">
        <div class="admin-section-title"><div><h3>Driver Accounts</h3><p>Create individual accounts so analytics identify each driver.</p></div></div>
        <form id="create-driver-form" class="portal-form form-grid">
          <label>Driver Name<input id="driver-name" required /></label>
          <label>Username<input id="driver-username" required /></label>
          <label>Employee ID<input id="driver-employee" /></label>
          <label>Temporary Password<input id="driver-password" type="password" minlength="10" required /></label>
          <label>Role<select id="driver-role"><option value="driver">Driver</option><option value="admin">Admin</option></select></label>
          <div class="form-action"><button class="primary-button" type="submit">Create Account</button></div>
        </form>
        <div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Username</th><th>Employee ID</th><th>Role</th><th>Last Login</th><th>Status</th><th>Actions</th></tr></thead><tbody id="driver-table">${(data.users || []).map(user => `<tr><td>${escapeHtml(user.display_name)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.employee_id || '')}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.last_login_at ? fmtDate(user.last_login_at) : 'Never')}</td><td>${user.active ? 'Active' : 'Disabled'}</td><td><button class="table-action" data-toggle-user="${user.id}" data-active="${user.active}">${user.active ? 'Disable' : 'Enable'}</button><button class="table-action" data-reset-user="${user.id}">Reset Password</button></td></tr>`).join('')}</tbody></table></div>
      </section>

      <section class="portal-card">
        <h3>Trim Archive Recording</h3>
        <p>Admin-only: keep a time range from an IVS recording playlist and replace it in S3. Original playlist is backed up first.</p>
        <form id="media-trim-form" class="portal-form form-grid">
          <label class="wide-field">Recording
            <select id="trim-media" required>
              <option value="">Select a recording…</option>
              ${(data.media || []).map((item) => `<option value="${escapeHtml(item.playback_key || '')}">${escapeHtml(item.title)}</option>`).join('')}
            </select>
          </label>
          <label>Start (seconds)<input id="trim-start" type="number" min="0" step="1" value="0" required /></label>
          <label>End (seconds)<input id="trim-end" type="number" min="1" step="1" value="60" required /></label>
          <label class="wide-field"><input id="trim-replace" type="checkbox" checked /> Replace original playlist in S3</label>
          <div class="wide-field"><div id="trim-progress" class="upload-progress"></div></div>
          <div class="form-action"><button class="primary-button" type="submit">Trim & Save</button></div>
        </form>
        <div class="table-wrap"><table class="admin-table"><thead><tr><th>Title</th><th>Type</th><th>Date</th><th>Path</th></tr></thead><tbody>${(data.media || []).map(item => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.media_type)}</td><td>${escapeHtml(new Date(item.recorded_at).toLocaleDateString())}</td><td>${escapeHtml(item.playback_key || item.storage_path || '')}</td></tr>`).join('')}</tbody></table></div>
      </section>
    </section>
  `, 'admin');
  wireShell();
  fillAdminLiveStreams();
  startLivePoll();

  document.getElementById('refresh-live-streams')?.addEventListener('click', async () => {
    try {
      const fresh = await adminData();
      state.live = fresh.live;
      state.liveStreams = fresh.liveStreams || [];
      fillAdminLiveStreams();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('create-driver-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'create-user', displayName: document.getElementById('driver-name').value, username: document.getElementById('driver-username').value, employeeId: document.getElementById('driver-employee').value, password: document.getElementById('driver-password').value, role: document.getElementById('driver-role').value }) });
      alert('Driver account created. They will be required to change the temporary password.');
      renderAdmin();
    } catch (error) { alert(error.message); }
  });

  document.querySelectorAll('[data-toggle-user]').forEach(button => button.addEventListener('click', async () => {
    try {
      await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set-user-active', userId: button.dataset.toggleUser, active: button.dataset.active !== 'true' }) });
      renderAdmin();
    } catch (error) { alert(error.message); }
  }));

  document.querySelectorAll('[data-reset-user]').forEach(button => button.addEventListener('click', async () => {
    const password = prompt('Enter a temporary password (minimum 10 characters):');
    if (!password) return;
    try {
      await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'reset-password', userId: button.dataset.resetUser, password }) });
      alert('Password reset. The driver must change it after login.');
    } catch (error) { alert(error.message); }
  }));

  document.getElementById('media-trim-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const progress = document.getElementById('trim-progress');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      progress.textContent = 'Trimming playlist in S3…';
      const result = await api('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'trim-media',
          playbackKey: document.getElementById('trim-media').value,
          startSeconds: Number(document.getElementById('trim-start').value),
          endSeconds: Number(document.getElementById('trim-end').value),
          replaceOriginal: document.getElementById('trim-replace').checked
        })
      });
      progress.textContent = `Saved. Backup: ${result.backupKey}`;
      await loadContent();
      alert('Trim complete. Archive will use the updated playlist.');
    } catch (error) {
      progress.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('refresh-metrics').addEventListener('click', refreshAdminMetrics);
  refreshAdminMetrics();
  state.adminTimer = setInterval(refreshAdminMetrics, 10000);
}

(async function init() {
  const restored = await restoreSession();
  if (!restored) return renderLogin();
  if (state.user.must_change_password) return renderChangePassword(true);
  await loadContentAndRender();
})();
