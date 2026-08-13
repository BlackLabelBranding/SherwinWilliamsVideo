async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is missing.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.details || 'Supabase request failed.');
  return data;
}

async function userFrom(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const rows = await supabase('rpc/sw_session_user', { method: 'POST', body: JSON.stringify({ p_token: token }) });
  const user = Array.isArray(rows) ? rows[0] : rows;
  return user ? { ...user, token } : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const user = await userFrom(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (body.action === 'start') {
      const rows = await supabase('rpc/sw_start_view', { method: 'POST', body: JSON.stringify({ p_token: user.token, p_content_type: body.contentType, p_content_id: body.contentId, p_device_id: body.deviceId || null, p_user_agent: req.headers['user-agent'] || null }) });
      return res.status(200).json({ ok: true, sessionId: Array.isArray(rows) ? rows[0] : rows });
    }

    if (body.action === 'heartbeat') {
      const rows = await supabase('rpc/sw_heartbeat', { method: 'POST', body: JSON.stringify({ p_token: user.token, p_view_session_id: body.sessionId, p_watch_seconds: Math.max(0, Number(body.watchSeconds || 0)) }) });
      return res.status(200).json({ ok: true, currentViewers: Array.isArray(rows) ? rows[0] : rows });
    }

    if (body.action === 'end') {
      await supabase('rpc/sw_end_view', { method: 'POST', body: JSON.stringify({ p_token: user.token, p_view_session_id: body.sessionId, p_watch_seconds: Math.max(0, Number(body.watchSeconds || 0)) }) });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'dashboard') {
      if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin access required' });
      const live = await supabase('sw_live_metrics?select=*');
      const media = await supabase('sw_media_metrics?select=*');
      const cutoff = encodeURIComponent(new Date(Date.now() - 45000).toISOString());
      const active = await supabase(`sw_view_sessions?select=id,user_id,content_type,content_id,started_at,last_heartbeat_at,watch_seconds&status=eq.active&last_heartbeat_at=gt.${cutoff}&order=last_heartbeat_at.desc`);
      const userIds = [...new Set((active || []).map(row => row.user_id))];
      let users = [];
      if (userIds.length) users = await supabase(`sw_users?select=id,display_name,username&id=in.(${userIds.join(',')})`);
      const userMap = Object.fromEntries((users || []).map(item => [item.id, item]));
      return res.status(200).json({ ok: true, live, media, active: (active || []).map(row => ({ ...row, user: userMap[row.user_id] || null })) });
    }

    return res.status(400).json({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
