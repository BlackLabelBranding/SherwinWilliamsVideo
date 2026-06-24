
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

function renderLogin() {
  app.innerHTML = `
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

function renderLive() {
  app.innerHTML = `
    <h1>Live Stream</h1>
    <div class="video-container">
      <video id="live-video" controls autoplay muted></video>
    </div>
    <form id="comment-form">
      <textarea id="comment-body" placeholder="Enter your comment" rows="3" required></textarea>
      <button type="submit">Post Comment</button>
    </form>
    <ul class="comment-list" id="comment-list"></ul>
    <button id="logout-btn">Log Out</button>
  `;

  // Setup video player with a placeholder HLS URL. Replace with actual IVS or other HLS URL.
  const video = document.getElementById('live-video');
  video.src = 'https://example.com/your-live-stream.m3u8';

  const commentForm = document.getElementById('comment-form');
  const commentList = document.getElementById('comment-list');
  const logoutBtn = document.getElementById('logout-btn');

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

  loadComments();

  // Periodically refresh comments every 10 seconds
  setInterval(loadComments, 10000);
}

// Check token and render accordingly
if (getToken()) {
  renderLive();
} else {
  renderLogin();
}
