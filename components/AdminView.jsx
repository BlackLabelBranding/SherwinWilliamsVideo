'use client';

import { useEffect, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import { StreamList } from '@/components/LiveView';
import { friendlyError, useModal } from '@/components/ModalProvider';
import { api, fmtDate, fmtDuration } from '@/lib/client';

function MetricCard({ value, label }) {
  return (
    <div className="metric-card">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

export default function AdminView({
  token,
  user,
  live,
  liveStreams,
  selectedLiveId,
  media,
  onSelectStream,
  onRefreshLive,
  onPlaying
}) {
  const { notify, prompt, confirm } = useModal();
  const [users, setUsers] = useState([]);
  const [metrics, setMetrics] = useState({ live: {}, active: [] });
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [trimProgress, setTrimProgress] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState({});

  const streams = liveStreams || [];
  const active =
    streams.find((s) => s.id === selectedLiveId) ||
    (live?.status === 'live' && live?.playback_url ? live : null) ||
    streams[0] ||
    live;

  function setRowAction(userKey, action) {
    setRowBusy((prev) => {
      const next = { ...prev };
      if (!action) delete next[userKey];
      else next[userKey] = action;
      return next;
    });
  }

  async function loadAdmin({ showLoading = false } = {}) {
    if (showLoading) setUsersLoading(true);
    try {
      const data = await api('/api/admin', {}, token);
      setUsers(data.users || []);
      return data;
    } finally {
      if (showLoading) setUsersLoading(false);
    }
  }

  async function loadMetrics({ showLoading = false } = {}) {
    if (showLoading) setMetricsLoading(true);
    const started = Date.now();
    try {
      const result = await api(
        '/api/metrics',
        { method: 'POST', body: JSON.stringify({ action: 'dashboard' }) },
        token
      );
      const row =
        (result.live || []).find((r) => r.id === live?.id) || result.live?.[0] || {};
      setMetrics({ live: row, active: result.active || [] });
    } catch (error) {
      setMetrics({ live: { error: error.message }, active: [] });
    } finally {
      if (showLoading) {
        const wait = 450 - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        setMetricsLoading(false);
      }
    }
  }

  useEffect(() => {
    loadAdmin({ showLoading: true }).catch((error) => {
      setUsersLoading(false);
      notify({ message: friendlyError(error), tone: 'error' });
    });
    loadMetrics();
    const timer = setInterval(loadMetrics, 10000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function createUser(event) {
    event.preventDefault();
    setCreateBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api(
        '/api/admin',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'create-user',
            displayName: form.get('displayName'),
            username: form.get('username'),
            employeeId: form.get('employeeId'),
            password: form.get('password'),
            role: form.get('role')
          })
        },
        token
      );
      event.currentTarget.reset();
      notify({
        title: 'Account created',
        message: 'Driver account created. They will be required to change the temporary password.',
        tone: 'success'
      });
      await loadAdmin();
    } catch (error) {
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleUser(row) {
    const userKey = row.id || row.username;
    setRowAction(userKey, row.active ? 'disable' : 'enable');
    try {
      await api(
        '/api/admin',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'set-user-active',
            userId: userKey,
            active: !row.active
          })
        },
        token
      );
      await loadAdmin();
    } catch (error) {
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setRowAction(userKey, null);
    }
  }

  async function resetPassword(row) {
    const userKey = row.id || row.username;
    const password = await prompt({
      title: 'Reset password',
      message: 'Enter a temporary password (minimum 10 characters).',
      inputType: 'password',
      minLength: 10,
      confirmLabel: 'Reset password'
    });
    if (!password) return;
    setRowAction(userKey, 'reset');
    try {
      await api(
        '/api/admin',
        { method: 'POST', body: JSON.stringify({ action: 'reset-password', userId: userKey, password }) },
        token
      );
      notify({
        title: 'Password reset',
        message: 'Password reset. The driver must change it after login.',
        tone: 'success'
      });
    } catch (error) {
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setRowAction(userKey, null);
    }
  }

  async function deleteUser(row) {
    const userKey = row.id || row.username;
    if (userKey === user?.username || userKey === user?.id) {
      notify({ message: 'You cannot delete your own account.', tone: 'error' });
      return;
    }
    const ok = await confirm({
      title: 'Delete account?',
      message: `Permanently delete “${row.display_name || row.username}” (${row.username})? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'error'
    });
    if (!ok) return;
    setRowAction(userKey, 'delete');
    try {
      await api(
        '/api/admin',
        { method: 'POST', body: JSON.stringify({ action: 'delete-user', userId: userKey }) },
        token
      );
      notify({
        title: 'Account deleted',
        message: `${row.username} has been removed.`,
        tone: 'success'
      });
      await loadAdmin();
    } catch (error) {
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setRowAction(userKey, null);
    }
  }

  async function trimMedia(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setTrimProgress('Trimming playlist in S3…');
    try {
      const result = await api(
        '/api/admin',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'trim-media',
            playbackKey: form.get('playbackKey'),
            startSeconds: Number(form.get('startSeconds')),
            endSeconds: Number(form.get('endSeconds')),
            replaceOriginal: form.get('replaceOriginal') === 'on'
          })
        },
        token
      );
      setTrimProgress(`Saved. Backup: ${result.backupKey}`);
      notify({
        title: 'Trim complete',
        message: 'Archive will use the updated playlist.',
        tone: 'success'
      });
    } catch (error) {
      setTrimProgress(friendlyError(error));
      notify({ message: friendlyError(error), tone: 'error' });
    }
  }

  if (user?.role !== 'admin') return null;

  const liveMetrics = metrics.live || {};

  return (
    <section className="admin-page">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h2>Portal Control Center</h2>
        </div>
        <span className="admin-status">REAL DATA</span>
      </div>

      <section className="portal-card">
        <div className="admin-section-title">
          <div>
            <h3>Live Streams</h3>
            <p>Auto-detected from AWS IVS. Click a stream to select and preview it.</p>
          </div>
          <button type="button" className="secondary-button" onClick={onRefreshLive}>
            Refresh
          </button>
        </div>
        <StreamList
          streams={streams}
          activeId={active?.id}
          emptyText="No active streams. Start broadcasting on an AWS IVS channel and it will show up here."
          onSelect={onSelectStream}
        />
        <div className="admin-live-preview">
          {active?.status === 'live' && active?.playback_url ? (
            <>
              <div className="section-title-row compact">
                <div>
                  <p className="eyebrow">Selected Stream</p>
                  <h3>{active.title}</h3>
                </div>
                <span className="live-pill on">LIVE</span>
              </div>
              <VideoPlayer
                url={active.playback_url}
                contentType="live"
                contentId={active.id}
                muted
                onPlaying={onPlaying}
              />
            </>
          ) : (
            <div className="no-video">No live preview — waiting for an IVS stream.</div>
          )}
        </div>
      </section>

      <section className="portal-card">
        <div className="admin-section-title">
          <div>
            <h3>Real-Time Analytics</h3>
            <p>Updates every 10 seconds from driver viewing sessions.</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => loadMetrics({ showLoading: true })}
            disabled={metricsLoading}
          >
            {metricsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className={`analytics-body ${metricsLoading ? 'is-loading' : ''}`}>
          {metricsLoading ? (
            <div className="section-loading" role="status" aria-live="polite">
              <span className="section-spinner" />
              <span>Refreshing analytics…</span>
            </div>
          ) : null}
          <div className="metrics-strip admin-metrics">
            {liveMetrics.error ? (
              <p className="error-message">{liveMetrics.error}</p>
            ) : (
              <>
                <MetricCard value={liveMetrics.current_viewers || 0} label="Watching Now" />
                <MetricCard value={liveMetrics.peak_viewers || 0} label="Peak Viewers" />
                <MetricCard value={liveMetrics.unique_viewers || 0} label="Unique Drivers" />
                <MetricCard value={fmtDuration(liveMetrics.total_watch_seconds || 0)} label="Total Watch Time" />
              </>
            )}
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Content</th>
                  <th>Watch Time</th>
                  <th>Last Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {metrics.active?.length ? (
                  metrics.active.map((row) => (
                    <tr key={row.sessionId || `${row.user_id}-${row.content_type}`}>
                      <td>{row.user?.display_name || row.user?.username || 'Driver'}</td>
                      <td>{row.content_type}</td>
                      <td>{fmtDuration(row.watch_seconds)}</td>
                      <td>{fmtDate(row.last_heartbeat_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>No active viewers.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="portal-card">
        <div className="admin-section-title">
          <div>
            <h3>Driver Accounts</h3>
            <p>Create individual accounts so analytics identify each driver.</p>
          </div>
        </div>
        <form className="portal-form form-grid" onSubmit={createUser}>
          <label>
            Driver Name
            <input name="displayName" type="text" required disabled={createBusy} />
          </label>
          <label>
            Username
            <input name="username" type="text" autoComplete="username" required disabled={createBusy} />
          </label>
          <label>
            Employee ID
            <input name="employeeId" type="text" disabled={createBusy} />
          </label>
          <label>
            Temporary Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              disabled={createBusy}
            />
          </label>
          <label>
            Role
            <select name="role" defaultValue="driver" disabled={createBusy}>
              <option value="driver">Driver</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <div className="form-action">
            <button className="primary-button" type="submit" disabled={createBusy}>
              {createBusy ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
        <div className={`users-body ${usersLoading ? 'is-loading' : ''}`}>
          {usersLoading ? (
            <div className="section-loading" role="status" aria-live="polite">
              <span className="section-spinner" />
              <span>Loading users…</span>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Employee ID</th>
                  <th>Role</th>
                  <th>Last Login</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!usersLoading && !users.length ? (
                  <tr>
                    <td colSpan={7}>No users yet.</td>
                  </tr>
                ) : null}
                {users.map((row) => {
                  const userKey = row.id || row.username;
                  const busy = rowBusy[userKey];
                  const isSelf = userKey === user?.username || userKey === user?.id;
                  return (
                    <tr key={userKey}>
                      <td>{row.display_name}</td>
                      <td>{row.username}</td>
                      <td>{row.employee_id || ''}</td>
                      <td>{row.role}</td>
                      <td>{row.last_login_at ? fmtDate(row.last_login_at) : 'Never'}</td>
                      <td>{row.active ? 'Active' : 'Disabled'}</td>
                      <td className="user-actions">
                        <button
                          type="button"
                          className="table-action"
                          disabled={Boolean(busy)}
                          onClick={() => toggleUser(row)}
                        >
                          {busy === 'disable'
                            ? 'Disabling…'
                            : busy === 'enable'
                              ? 'Enabling…'
                              : row.active
                                ? 'Disable'
                                : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          disabled={Boolean(busy)}
                          onClick={() => resetPassword(row)}
                        >
                          {busy === 'reset' ? 'Resetting…' : 'Reset Password'}
                        </button>
                        <button
                          type="button"
                          className="table-action table-action-danger"
                          disabled={Boolean(busy) || isSelf}
                          onClick={() => deleteUser(row)}
                          title={isSelf ? 'You cannot delete your own account' : 'Delete account'}
                        >
                          {busy === 'delete' ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="portal-card">
        <h3>Trim Archive Recording</h3>
        <p>
          Admin-only: keep a time range from an IVS recording playlist and replace it in S3. Original
          playlist is backed up first.
        </p>
        <form className="portal-form form-grid" onSubmit={trimMedia}>
          <label className="wide-field">
            Recording
            <select name="playbackKey" required defaultValue="">
              <option value="">Select a recording…</option>
              {(media || []).map((item) => (
                <option key={item.id} value={item.playback_key || ''}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start (seconds)
            <input name="startSeconds" type="number" min={0} step={1} defaultValue={0} required />
          </label>
          <label>
            End (seconds)
            <input name="endSeconds" type="number" min={1} step={1} defaultValue={60} required />
          </label>
          <label className="wide-field checkbox-row">
            <input name="replaceOriginal" type="checkbox" defaultChecked /> Replace original playlist
            in S3
          </label>
          <div className="wide-field">
            <div className="upload-progress">{trimProgress}</div>
          </div>
          <div className="form-action">
            <button className="primary-button" type="submit">
              Trim & Save
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}
