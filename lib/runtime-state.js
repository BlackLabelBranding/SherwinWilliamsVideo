const { v4: uuidv4 } = require('uuid');
const { pickLiveEvent } = require('./ivs-live');

function authMode() {
  const mode = String(process.env.AUTH_MODE || 'both').toLowerCase().trim();
  if (mode === 'cognito' || mode === 'static' || mode === 'both') return mode;
  return 'both';
}

function allowStaticAuth() {
  const mode = authMode();
  return mode === 'static' || mode === 'both';
}

const { isCognitoEnabled } = require('./aws-auth');

function allowCognitoAuth() {
  const mode = authMode();
  return (mode === 'cognito' || mode === 'both') && isCognitoEnabled();
}

const users = [
  { id: '1', username: 'driver1', password: 'pass123', display_name: 'Driver One', role: 'driver', active: true },
  { id: '2', username: 'driver2', password: 'pass123', display_name: 'Driver Two', role: 'driver', active: true },
  { id: '3', username: 'admin', password: 'admin123@#', display_name: 'Admin User', role: 'admin', active: true }
];

const sessions = {};
const commentsByKey = {};
let selectedLiveId = null;
let liveEvent = pickLiveEvent([]);
let liveStreams = [];

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

function bearerToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return auth.trim() || '';
}

function sessionFromAccess(access) {
  const token = String(access || '').trim();
  if (!token || !sessions[token]) return null;
  const user = resolveSessionUser(sessions[token]);
  if (!user) return null;
  return { token, user, session: sessions[token] };
}

function requireUser(request) {
  const token = bearerToken(request);
  const session = token ? sessions[token] : null;
  if (!session) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  const user = resolveSessionUser(session);
  if (!user) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  return { token, user, session };
}

function requireAdmin(request) {
  const auth = requireUser(request);
  if (auth.user.role !== 'admin') {
    const err = new Error('Admin access required');
    err.status = 403;
    throw err;
  }
  return auth;
}

function commentKey(contentType, contentId) {
  return `${contentType}:${contentId}`;
}

module.exports = {
  uuidv4,
  authMode,
  allowStaticAuth,
  allowCognitoAuth,
  users,
  sessions,
  commentsByKey,
  getSelectedLiveId: () => selectedLiveId,
  setSelectedLiveId: (id) => { selectedLiveId = id; },
  getLiveEvent: () => liveEvent,
  setLiveEvent: (event) => { liveEvent = event; },
  getLiveStreams: () => liveStreams,
  setLiveStreams: (list) => { liveStreams = list; },
  publicUser,
  createSession,
  staticLogin,
  staticUserRows,
  sessionFromAccess,
  requireUser,
  requireAdmin,
  commentKey
};
