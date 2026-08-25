async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is missing.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.details || 'Supabase request failed.');
  return data;
}

async function currentUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const rows = await supabase('rpc/sw_session_user', { method: 'POST', body: JSON.stringify({ p_token: token }) });
  const user = Array.isArray(rows) ? rows[0] : rows;
  return user ? { ...user, token } : null;
}

async function signedMediaUrl(bucket, path) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || 'Could not sign media URL.');
  const value = payload.signedURL || payload.signedUrl;
  return value.startsWith('http') ? value : `${base}/storage/v1${value}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    if (req.method === 'GET') {
      const liveRows = await supabase('sw_live_events?select=*&order=created_at.desc&limit=1');
      const mediaRows = await supabase('sw_media?select=*&status=eq.published&order=recorded_at.desc');
      const live = liveRows?.[0] || null;
      const media = [];
      for (const item of mediaRows || []) {
        media.push({ ...item, url: await signedMediaUrl(item.bucket, item.storage_path) });
      }
      return res.status(200).json({ ok: true, live, media });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      if (body.action === 'comments') {
        const rows = await supabase(`sw_comments?select=id,body,created_at,user_id&content_type=eq.${encodeURIComponent(body.contentType)}&content_id=eq.${encodeURIComponent(body.contentId)}&status=eq.visible&order=created_at.asc`);
        const userIds = [...new Set((rows || []).map(row => row.user_id))];
        let users = [];
        if (userIds.length) {
          users = await supabase(`sw_users?select=id,display_name&id=in.(${userIds.join(',')})`);
        }
        const names = Object.fromEntries((users || []).map(item => [item.id, item.display_name]));
        return res.status(200).json({ ok: true, comments: (rows || []).map(row => ({ ...row, display_name: names[row.user_id] || 'Driver' })) });
      }

      if (body.action === 'comment') {
        if (!body.body?.trim()) return res.status(400).json({ ok: false, error: 'Comment is required.' });
        await supabase('sw_comments', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: user.user_id,
            content_type: body.contentType,
            content_id: body.contentId,
            body: body.body.trim(),
            status: 'visible'
          })
        });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'Unsupported action' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message });
  }
};
