module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase server configuration is missing.');

    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
    const rpc = async (name, payload) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(payload || {}) });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(data?.message || 'Authentication request failed.');
      return data;
    };

    if (body.action === 'login') {
      const rows = await rpc('sw_login', {
        p_username: body.username || '',
        p_password: body.password || '',
        p_user_agent: req.headers['user-agent'] || null
      });
      const result = Array.isArray(rows) ? rows[0] : rows;
      return res.status(200).json({ ok: true, ...result });
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    if (body.action === 'session') {
      const rows = await rpc('sw_session_user', { p_token: token });
      const user = Array.isArray(rows) ? rows[0] : rows;
      if (!user) return res.status(401).json({ ok: false, error: 'Session expired' });
      return res.status(200).json({ ok: true, user });
    }

    if (body.action === 'logout') {
      await rpc('sw_logout', { p_token: token });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'change-password') {
      await rpc('sw_change_password', {
        p_token: token,
        p_current_password: body.currentPassword || '',
        p_new_password: body.newPassword || ''
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    const status = /invalid credentials/i.test(error.message) ? 401 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }
};
