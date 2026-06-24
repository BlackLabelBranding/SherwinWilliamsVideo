
const app = document.getElementById('app');

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

async function login(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) {
    throw new Error('Login failed');
  }
  return res.json();
}

async function logout() {
  const token = getToken();
  await fetch('/api/logout', {
    method: 'POST',
    headers: { 'Authorization': token }
  });
  clearToken();
}

async function fetchComments() {
  // Fetch comments for the live stream
  const token = getToken();
  const res = await fetch('/api/comments', {
    headers: { 'Authorization': token }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch comments');
  }
  return res.json();
}

async function postComment(body) {
  // Post a comment to the live stream
  const token = getToken();
  const res = await fetch('/api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token },
    body: JSON.stringify({ body })
  });
  if (!res.ok) {
    throw new Error('Failed to post comment');
  }
  return res.json();
}

// Fetch live stream status and playback URL
async function fetchIsLive() {
  const token = getToken();
  const res = await fetch('/api/is-live', {
    headers: { 'Authorization': token }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch live status');
  }
  return res.json();
}

// Navigation bar HTML helper. Pass 'live' or 'archive' as the active tab.
function navHTML(active) {
  return `
    <nav class="nav">
      <ul>
        <li id="nav-live" class="${active === 'live' ? 'active' : ''}">Live Stream</li>
        <li id="nav-archive" class="${active === 'archive' ? 'active' : ''}">Archive</li>
      </ul>
    </nav>
  `;
}

// Attach click handlers to navigation items
function attachNavHandlers() {
  const liveNav = document.getElementById('nav-live');
  const archiveNav = document.getElementById('nav-archive');
  if (liveNav) {
    liveNav.addEventListener('click', () => {
      renderLive();
    });
  }
  if (archiveNav) {
    archiveNav.addEventListener('click', () => {
      renderArchive();
    });
  }
}

function renderLogin() {
  app.innerHTML = `
    <img src="/images/logo.png" alt="Sherwin-Williams logo" class="logo" />
    <h1>Log In</h1>
    <form id="login-form">
      <input type="text" id="username" placeholder="Username" required />
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit">Log In</button>
    </form>
    <div id="error" style="color: red"></div>
  `;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    try {
      const data = await login(username, password);
      setToken(data.token);
      renderLive();
    } catch (err) {
      document.getElementById('error').textContent = 'Invalid username or password';
    }
  });
}

async function renderLive() {
  // Build the live stream page with navigation and banner
  app.innerHTML = navHTML('live') + `
    <img src="/images/banner.jpeg" alt="Sherwin-Williams banner" class="banner" />
    <h1>Live Stream</h1>
    <div id="live-message" class="live-message"></div>
    <div class="video-container" id="live-video-container" style="display:none;">
      <video id="live-video" controls autoplay muted></video>
    </div>
    <form id="comment-form">
      <textarea id="comment-body" placeholder="Enter your comment" rows="3" required></textarea>
      <button type="submit">Post Comment</button>
    </form>
    <ul class="comment-list" id="comment-list"></ul>
    <button id="logout-btn">Log Out</button>
  `;
  // Attach nav handlers
  attachNavHandlers();

  const liveMessage = document.getElementById('live-message');
  const videoContainer = document.getElementById('live-video-container');
  const video = document.getElementById('live-video');
  const commentForm = document.getElementById('comment-form');
  const commentList = document.getElementById('comment-list');
  const logoutBtn = document.getElementById('logout-btn');

  // Fetch live status to determine if a live stream is available
  try {
    const status = await fetchIsLive();
    if (status.isLive) {
      video.src = status.url;
      videoContainer.style.display = 'block';
      liveMessage.textContent = '';
    } else {
      liveMessage.textContent = 'No live video at this time.';
      liveMessage.style.padding = '20px';
      liveMessage.style.backgroundColor = '#003c83';
      liveMessage.style.borderRadius = '4px';
    }
  } catch (err) {
    console.error(err);
    liveMessage.textContent = 'Failed to load live stream status.';
  }

  async function loadComments() {
    try {
      const comments = await fetchComments();
      commentList.innerHTML = '';
      comments.forEach(c => {
        const li = document.createElement('li');
        li.className = 'comment';
        const date = new Date(c.timestamp).toLocaleString();
        li.innerHTML = `<div class="comment-meta"><strong>${c.username}</strong> at ${date}</div><div>${c.body}</div>`;
        commentList.appendChild(li);
      });
      // Scroll to the bottom to show latest comment
      commentList.scrollTop = commentList.scrollHeight;
    } catch (err) {
      console.error(err);
    }
  }

  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = document.getElementById('comment-body').value;
    try {
      await postComment(body);
      document.getElementById('comment-body').value = '';
      await loadComments();
    } catch (err) {
      console.error(err);
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await logout();
    clearToken();
    renderLogin();
  });

  // Initial load and periodic refresh of comments
  await loadComments();
  window.liveCommentInterval && clearInterval(window.liveCommentInterval);
  window.liveCommentInterval = setInterval(loadComments, 10000);
}

// Render the archive page with a list of past videos and comments
async function renderArchive() {
  app.innerHTML = navHTML('archive') + `
    <h1>Archive</h1>
    <div id="archive-list"></div>
    <div id="archive-details"></div>
    <button id="logout-btn">Log Out</button>
  `;
  attachNavHandlers();
  const logoutBtn = document.getElementById('logout-btn');
  logoutBtn.addEventListener('click', async () => {
    await logout();
    clearToken();
    renderLogin();
  });
  // Load and display archive videos
  try {
    const token = getToken();
    const res = await fetch('/api/archive-videos', { headers: { 'Authorization': token } });
    if (!res.ok) throw new Error('Failed to fetch archive videos');
    const videos = await res.json();
    const listElem = document.getElementById('archive-list');
    if (videos.length === 0) {
      listElem.innerHTML = '<p>No archived videos available.</p>';
    } else {
      videos.forEach(video => {
        const item = document.createElement('div');
        item.className = 'archive-item';
        item.textContent = video.title;
        item.addEventListener('click', () => {
          renderArchiveDetails(video);
        });
        listElem.appendChild(item);
      });
    }
  } catch (err) {
    console.error(err);
    document.getElementById('archive-list').innerHTML = '<p>Error loading archive.</p>';
  }
}

// Fetch comments for a specific archived video
async function fetchArchiveComments(videoId) {
  const token = getToken();
  const res = await fetch(`/api/archive-comments/${videoId}`, {
    headers: { 'Authorization': token }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch archive comments');
  }
  return res.json();
}

// Post a comment on an archived video
async function postArchiveComment(videoId, body) {
  const token = getToken();
  const res = await fetch(`/api/archive-comments/${videoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token },
    body: JSON.stringify({ body })
  });
  if (!res.ok) {
    throw new Error('Failed to post archive comment');
  }
  return res.json();
}

// Render details for a selected archive video including player and comments
async function renderArchiveDetails(video) {
  const details = document.getElementById('archive-details');
  details.innerHTML = `
    <h2>${video.title}</h2>
    <div class="video-container">
      <video id="archive-video" controls autoplay></video>
    </div>
    <form id="archive-comment-form">
      <textarea id="archive-comment-body" placeholder="Enter your comment" rows="3" required></textarea>
      <button type="submit">Post Comment</button>
    </form>
    <ul class="comment-list" id="archive-comment-list"></ul>
  `;
  // Set video source
  const videoEl = document.getElementById('archive-video');
  videoEl.src = video.url;
  // Load comments
  async function loadArchiveComments() {
    try {
      const comments = await fetchArchiveComments(video.id);
      const list = document.getElementById('archive-comment-list');
      list.innerHTML = '';
      comments.forEach(c => {
        const li = document.createElement('li');
        li.className = 'comment';
        const date = new Date(c.timestamp).toLocaleString();
        li.innerHTML = `<div class="comment-meta"><strong>${c.username}</strong> at ${date}</div><div>${c.body}</div>`;
        list.appendChild(li);
      });
    } catch (err) {
      console.error(err);
    }
  }
  // Submit handler for archive comments
  const form = document.getElementById('archive-comment-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = document.getElementById('archive-comment-body').value;
    try {
      await postArchiveComment(video.id, body);
      document.getElementById('archive-comment-body').value = '';
      await loadArchiveComments();
    } catch (err) {
      console.error(err);
    }
  });
  await loadArchiveComments();
}

// Check token and render accordingly
if (getToken()) {
  renderLive();
} else {
  renderLogin();
}
