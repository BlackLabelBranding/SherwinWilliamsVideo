const crypto = require('crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.AWS_SECRET_ACCESS_KEY || 'sherwin-dev-session';
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueSession(user, extra = {}) {
  return signToken({
    user: {
      id: user.id || user.username,
      username: user.username,
      display_name: user.display_name || user.username,
      role: user.role || 'driver',
      active: user.active !== false,
      must_change_password: Boolean(user.must_change_password)
    },
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    ...extra
  });
}

module.exports = { signToken, verifyToken, issueSession, SESSION_TTL_MS };
