const app = document.getElementById('app');

const CONFIG = {
  brandLogoUrl:
    'https://kilmhwlsqgjxjhvsweqb.supabase.co/storage/v1/object/sign/sherwin%20williams%20test/logosw.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iZjdlOGY4OS00MDI1LTQxMDItYTY4OS0zNGU4YzIzOGUxODYiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJzaGVyd2luIHdpbGxpYW1zIHRlc3QvbG9nb3N3LnBuZyIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODIzNjE1MzgsImV4cCI6MTgxMzg5NzUzOH0.qJegJ35FBIyXGE1bPCSETdFiKmCzrjMtgqZA0PYOPPk',
  users: {
    driver1: 'pass123',
    driver2: 'pass123',
    admin: 'pass123'
  },
  live: {
    isLive: true,
    title: 'Sherwin-Williams Driver Live Stream',
    subtitle: 'Quarterly Driver Broadcast',
    url:
      'https://kilmhwlsqgjxjhvsweqb.supabase.co/storage/v1/object/sign/sherwin%20williams%20test/swtestdelete.mov?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iZjdlOGY4OS00MDI1LTQxMDItYTY4OS0zNGU4YzIzOGUxODYiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJzaGVyd2luIHdpbGxpYW1zIHRlc3Qvc3d0ZXN0ZGVsZXRlLm1vdiIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODIzNDExNTIsImV4cCI6MTgxMzg3NzE1Mn0.vBdU__lOCAIVpeSLZMjj0_ycaKOLTSO3UC8G3Lm1AlQ',
    type: 'video/quicktime'
  },
  archiveVideos: [
    {
      id: 'supabase-test-video',
      title: 'Supabase Test Video',
      date: 'Test Recording',
      url:
        'https://kilmhwlsqgjxjhvsweqb.supabase.co/storage/v1/object/sign/sherwin%20williams%20test/swtestdelete.mov?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iZjdlOGY4OS00MDI1LTQxMDItYTY4OS0zNGU4YzIzOGUxODYiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJzaGVyd2luIHdpbGxpYW1zIHRlc3Qvc3d0ZXN0ZGVsZXRlLm1vdiIsInNjb3BlIjoiZG93bmxvYWQiLCJpYXQiOjE3ODIzNDExNTIsImV4cCI6MTgxMzg3NzE1Mn0.vBdU__lOCAIVpeSLZMjj0_ycaKOLTSO3UC8G3Lm1AlQ',
      type: 'video/quicktime'
    }
  ]
};

function getToken() {
  return localStorage.getItem('sw_session_token');
}

function setToken(username) {
  localStorage.setItem('sw_session_token', `demo-session-${Date.now()}`);
  localStorage.setItem('sw_username', username);
}

function clearToken() {
  localStorage.removeItem('sw_session_token');
  localStorage.removeItem('sw_username');
}

function getUsername() {
  return localStorage.getItem('sw_username') || 'driver';
}

function getStoredComments(key) {
  return JSON.parse(localStorage.getItem(key) || '[]');
}

function saveStoredComments(key, comments) {
  localStorage.setItem(key, JSON.stringify(comments));
}

function addComment(key, body) {
  const comments = getStoredComments(key);
  comments.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    username: getUsername(),
    body: body.trim(),
    timestamp: Date.now()
  });
  saveStoredComments(key, comments);
  return comments;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function login(username, password) {
  const expectedPassword = CONFIG.users[username];
  if (!expectedPassword || expectedPassword !== password) {
    throw new Error('Invalid username or password');
  }
  setToken(username);
}

function logout() {
  clearToken();
  renderLogin();
}

function navHTML(active) {
  return `
    <nav class="nav">
      <button id="nav-live" class="nav-item ${active === 'live' ? 'active' : ''}" type="button">Live Stream</button>
      <button id="nav-archive" class="nav-item ${active === 'archive' ? 'active' : ''}" type="button">Archive</button>
    </nav>
  `;
}

function attachNavHandlers() {
  document.getElementById('nav-live')?.addEventListener('click', renderLive);
  document.getElementById('nav-archive')?.addEventListener('click', renderArchive);
}

function renderHeader() {
  return `
    <header class="brand-header">
      <img src="${CONFIG.brandLogoUrl}" alt="Sherwin-Williams logo" class="brand-logo" />
      <div class="brand-copy">
        <p class="eyebrow">Driver Communications Portal</p>
        <h1>Sherwin-Williams Live</h1>
      </div>
    </header>
  `;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-card">
        <img src="${CONFIG.brandLogoUrl}" alt="Sherwin-Williams logo" class="login-logo" />
        <div class="login-copy">
          <p class="eyebrow">Driver Communications Portal</p>
          <h1>Log In</h1>
          <p>Access live broadcasts, archived driver meetings, and event comments.</p>
        </div>
        <form id="login-form" class="login-form">
          <input type="text" id="username" placeholder="Username" autocomplete="username" required />
          <input type="password" id="password" placeholder="Password" autocomplete="current-password" required />
          <button type="submit" class="primary-button">Log In</button>
        </form>
        <p class="demo-note">Demo login: <strong>driver1</strong> / <strong>pass123</strong></p>
        <div id="error" class="error-message"></div>
      </section>
    </main>
  `;

  document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    try {
      login(username, password);
      renderLive();
    } catch (error) {
      document.getElementById('error').textContent = 'Invalid username or password.';
    }
  });
}

function renderVideo(video, idPrefix) {
  return `
    <div class="video-shell">
      <video id="${idPrefix}-video" controls playsinline preload="metadata">
        <source src="${video.url}" type="${video.type || 'video/mp4'}" />
        Your browser does not support this video format.
      </video>
    </div>
    <p class="video-note">
      If the video area loads but the file will not play, upload an MP4 version to Supabase and replace the URL.
    </p>
  `;
}

function renderLiveComments() {
  const comments = getStoredComments('sw_live_comments');
  const list = document.getElementById('comment-list');
  list.innerHTML = '';

  if (!comments.length) {
    list.innerHTML = '<li class="empty-comments">No live comments yet.</li>';
    return;
  }

  comments.forEach((comment) => {
    const li = document.createElement('li');
    li.className = 'live-comment';
    li.innerHTML = `
      <div class="comment-bubble">
        <span class="comment-user">${comment.username}</span>
        <span class="comment-time">${formatTime(comment.timestamp)}</span>
        <p>${comment.body}</p>
      </div>
    `;
    list.appendChild(li);
  });

  list.scrollTop = list.scrollHeight;
}

function renderLive() {
  app.innerHTML = `
    ${navHTML('live')}
    <main class="app-shell">
      ${renderHeader()}
      <section class="content-grid live-grid">
        <div class="video-card">
          <div class="section-title-row">
            <div>
              <p class="eyebrow">Live Now</p>
              <h2>${CONFIG.live.title}</h2>
              <p>${CONFIG.live.subtitle}</p>
            </div>
            <span class="live-pill ${CONFIG.live.isLive ? 'on' : 'off'}">${CONFIG.live.isLive ? 'LIVE' : 'OFF AIR'}</span>
          </div>
          ${CONFIG.live.isLive ? renderVideo(CONFIG.live, 'live') : '<div class="no-video">No live video at this time.</div>'}
        </div>

        <aside class="chat-card">
          <div class="section-title-row compact">
            <div>
              <p class="eyebrow">Live Comments</p>
              <h2>Driver Chat</h2>
            </div>
          </div>
          <ul class="live-comment-list" id="comment-list"></ul>
          <form id="comment-form" class="comment-form">
            <textarea id="comment-body" placeholder="Add a live comment..." rows="3" required></textarea>
            <button type="submit" class="primary-button">Send</button>
          </form>
        </aside>
      </section>
      <button id="logout-btn" type="button" class="secondary-button">Log Out</button>
    </main>
  `;

  attachNavHandlers();
  renderLiveComments();

  document.getElementById('comment-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('comment-body');
    if (!input.value.trim()) return;
    addComment('sw_live_comments', input.value);
    input.value = '';
    renderLiveComments();
  });

  document.getElementById('logout-btn').addEventListener('click', logout);
}

function renderArchive() {
  const firstVideo = CONFIG.archiveVideos[0];
  app.innerHTML = `
    ${navHTML('archive')}
    <main class="app-shell">
      ${renderHeader()}
      <section class="archive-layout">
        <div class="archive-list-card">
          <p class="eyebrow">Past Broadcasts</p>
          <h2>Archive</h2>
          <div id="archive-list" class="archive-list"></div>
        </div>
        <div id="archive-details" class="archive-details-card"></div>
      </section>
      <button id="logout-btn" type="button" class="secondary-button">Log Out</button>
    </main>
  `;

  attachNavHandlers();
  document.getElementById('logout-btn').addEventListener('click', logout);

  const list = document.getElementById('archive-list');
  CONFIG.archiveVideos.forEach((video) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'archive-item';
    button.innerHTML = `<strong>${video.title}</strong><span>${video.date}</span>`;
    button.addEventListener('click', () => renderArchiveDetails(video));
    list.appendChild(button);
  });

  if (firstVideo) {
    renderArchiveDetails(firstVideo);
  }
}

function renderArchiveComments(videoId) {
  const comments = getStoredComments(`sw_archive_comments_${videoId}`);
  const list = document.getElementById('archive-comment-list');
  list.innerHTML = '';

  if (!comments.length) {
    list.innerHTML = '<li class="empty-comments">No archive comments yet.</li>';
    return;
  }

  comments.forEach((comment) => {
    const li = document.createElement('li');
    li.className = 'archive-comment';
    li.innerHTML = `
      <div class="comment-meta"><strong>${comment.username}</strong> · ${formatTime(comment.timestamp)}</div>
      <p>${comment.body}</p>
    `;
    list.appendChild(li);
  });
}

function renderArchiveDetails(video) {
  const details = document.getElementById('archive-details');
  details.innerHTML = `
    <div class="section-title-row">
      <div>
        <p class="eyebrow">Archive Video</p>
        <h2>${video.title}</h2>
        <p>${video.date}</p>
      </div>
    </div>
    ${renderVideo(video, 'archive')}
    <div class="archive-comments-block">
      <h3>Comments</h3>
      <form id="archive-comment-form" class="comment-form archive-style">
        <textarea id="archive-comment-body" placeholder="Add a comment on this recording..." rows="3" required></textarea>
        <button type="submit" class="primary-button">Post Comment</button>
      </form>
      <ul class="archive-comment-list" id="archive-comment-list"></ul>
    </div>
  `;

  renderArchiveComments(video.id);

  document.getElementById('archive-comment-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('archive-comment-body');
    if (!input.value.trim()) return;
    addComment(`sw_archive_comments_${video.id}`, input.value);
    input.value = '';
    renderArchiveComments(video.id);
  });
}

if (getToken()) {
  renderLive();
} else {
  renderLogin();
}
