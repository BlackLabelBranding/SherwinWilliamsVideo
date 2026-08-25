const { v4: uuidv4 } = require('uuid');
const { pickLiveEvent } = require('./ivs-live');
const { issueSession, verifyToken } = require('./session');
const { isCognitoEnabled } = require('./aws-auth');

function authMode() {
  const mode = String(process.env.AUTH_MODE || 'cognito').toLowerCase().trim();
  if (mode === 'cognito') return 'cognito';
  // Legacy env values (static/both) are ignored — Cognito only.
  return 'cognito';
}

function allowCognitoAuth() {
  return isCognitoEnabled();
}

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

function createSession(user, extra = {}) {
  return issueSession(user, { source: 'cognito', ...extra });
}

function readSession(token) {
  const payload = verifyToken(token);
  if (!payload?.user) return null;
  return { token, user: payload.user, session: payload };
}

function bearerToken(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return auth.trim() || '';
}

function sessionFromAccess(access) {
  return readSession(String(access || '').trim());
}

function requireUser(request) {
  const token = bearerToken(request);
  const auth = token ? readSession(token) : null;
  if (!auth) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  return auth;
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
  allowCognitoAuth,
  commentsByKey,
  getSelectedLiveId: () => selectedLiveId,
  setSelectedLiveId: (id) => { selectedLiveId = id; },
  getLiveEvent: () => liveEvent,
  setLiveEvent: (event) => { liveEvent = event; },
  getLiveStreams: () => liveStreams,
  setLiveStreams: (list) => { liveStreams = list; },
  publicUser,
  createSession,
  sessionFromAccess,
  requireUser,
  requireAdmin,
  commentKey
};
