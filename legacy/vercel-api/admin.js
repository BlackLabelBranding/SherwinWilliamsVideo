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
  if (!response.ok) throw new Error(data?.message || data?.details || data?.hint || 'Supabase request failed.');
  return data;
}

async function admin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const rows = await supabase('rpc/sw_session_user', { method: 'POST', body: JSON.stringify({ p_token: token }) });
  const user = Array.isArray(rows) ? rows[0] : rows;
  if (!user || user.role !== 'admin') return null;
  return { ...user, token };
}

async function storageSignedUpload(path) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fullPath = `sw-media/${path}`;
  const response = await fetch(`${base}/storage/v1/object/upload/sign/${fullPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || 'Could not create upload URL.');
  const signedUrl = new URL(`${base}/storage/v1${payload.url}`);
  return { signedUrl: signedUrl.toString(), token: signedUrl.searchParams.get('token'), path };
}

function safeFileName(name) {
  return String(name || 'media').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-120) || 'media';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const actor = await admin(req);
    if (!actor) return res.status(403).json({ ok: false, error: 'Admin access required' });

    if (req.method === 'GET') {
      const users = await supabase('sw_users?select=id,username,display_name,employee_id,role,active,must_change_password,last_login_at,created_at&order=display_name.asc');
      const live = await supabase('sw_live_events?select=*&order=created_at.desc&limit=1');
      const media = await supabase('sw_media?select=*&order=recorded_at.desc');
      return res.status(200).json({ ok: true, users, live: live?.[0] || null, media });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (body.action === 'create-user') {
      const rows = await supabase('rpc/sw_admin_create_user', { method: 'POST', body: JSON.stringify({
        p_actor_token: actor.token,
        p_username: body.username || '',
        p_display_name: body.displayName || '',
        p_employee_id: body.employeeId || '',
        p_role: body.role || 'driver',
        p_password: body.password || ''
      }) });
      return res.status(200).json({ ok: true, id: Array.isArray(rows) ? rows[0] : rows });
    }

    if (body.action === 'reset-password') {
      await supabase('rpc/sw_admin_reset_password', { method: 'POST', body: JSON.stringify({ p_actor_token: actor.token, p_user_id: body.userId, p_new_password: body.password || '' }) });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'set-user-active') {
      await supabase('rpc/sw_admin_set_user_active', { method: 'POST', body: JSON.stringify({ p_actor_token: actor.token, p_user_id: body.userId, p_active: Boolean(body.active) }) });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'save-live') {
      const record = {
        title: body.title || 'Sherwin-Williams Driver Live Stream',
        subtitle: body.subtitle || null,
        playback_url: body.playbackUrl || '',
        status: body.status || 'offline',
        updated_at: new Date().toISOString(),
        started_at: body.status === 'live' ? (body.startedAt || new Date().toISOString()) : body.startedAt || null,
        ended_at: body.status === 'ended' ? new Date().toISOString() : null
      };
      if (!record.playback_url) return res.status(400).json({ ok: false, error: 'Playback URL is required.' });
      if (body.id) {
        await supabase(`sw_live_events?id=eq.${encodeURIComponent(body.id)}`, { method: 'PATCH', body: JSON.stringify(record) });
      } else {
        record.created_by = actor.user_id;
        await supabase('sw_live_events', { method: 'POST', body: JSON.stringify(record) });
      }
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'sign-upload') {
      const mediaType = body.mediaType === 'audio' ? 'audio' : 'video';
      const folder = mediaType === 'audio' ? 'audio' : 'video';
      const path = `${folder}/${Date.now()}-${safeFileName(body.fileName)}`;
      const signed = await storageSignedUpload(path);
      return res.status(200).json({ ok: true, ...signed });
    }

    if (body.action === 'finalize-media') {
      const record = {
        title: body.title || 'Sherwin-Williams Recording',
        description: body.description || null,
        media_type: body.mediaType === 'audio' ? 'audio' : 'video',
        bucket: 'sw-media',
        storage_path: body.storagePath,
        original_name: body.originalName || null,
        mime_type: body.mimeType || null,
        size_bytes: Number(body.sizeBytes || 0) || null,
        duration_seconds: Number(body.durationSeconds || 0) || null,
        recorded_at: body.recordedAt || new Date().toISOString(),
        status: body.status === 'draft' ? 'draft' : 'published',
        created_by: actor.user_id
      };
      if (!record.storage_path) return res.status(400).json({ ok: false, error: 'Storage path is required.' });
      const rows = await supabase('sw_media', { method: 'POST', body: JSON.stringify(record) });
      return res.status(200).json({ ok: true, media: rows?.[0] || null });
    }

    if (body.action === 'set-media-status') {
      const status = ['draft','published','archived'].includes(body.status) ? body.status : 'archived';
      await supabase(`sw_media?id=eq.${encodeURIComponent(body.mediaId)}`, { method: 'PATCH', body: JSON.stringify({ status, updated_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
