async function supabaseFetch(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(JSON.stringify(payload));
  }

  return payload;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const action = body.action;

    if (action === 'start') {
      const inserted = await supabaseFetch('sw_view_sessions', {
        method: 'POST',
        body: JSON.stringify({
          content_id: body.contentId || null,
          content_title: body.contentTitle || null,
          content_type: body.contentType || 'archive',
          user_id: body.userId || null,
          driver_name: body.driverName || null,
          device_id: body.deviceId || null,
          user_agent: req.headers['user-agent'] || null,
          status: 'active',
          watch_seconds: 0
        })
      });
      return res.status(200).json({ ok: true, sessionId: inserted?.[0]?.id || null });
    }

    if (action === 'heartbeat' || action === 'end') {
      if (!body.sessionId) return res.status(400).json({ ok: false, error: 'Missing sessionId' });
      const status = action === 'end' ? 'ended' : 'active';
      await supabaseFetch(`sw_view_sessions?id=eq.${body.sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          last_heartbeat_at: new Date().toISOString(),
          ended_at: action === 'end' ? new Date().toISOString() : null,
          watch_seconds: Number(body.watchSeconds || 0),
          status
        })
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'comment') {
      if (!body.body) return res.status(400).json({ ok: false, error: 'Missing comment body' });
      await supabaseFetch('sw_video_comments', {
        method: 'POST',
        body: JSON.stringify({
          content_id: body.contentId || null,
          content_title: body.contentTitle || null,
          content_type: body.contentType || 'archive',
          user_id: body.userId || null,
          driver_name: body.driverName || null,
          device_id: body.deviceId || null,
          body: body.body,
          status: 'visible'
        })
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
