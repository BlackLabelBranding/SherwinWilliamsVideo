'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import LoginForm from '@/components/LoginForm';
import AppShell from '@/components/AppShell';
import LiveView from '@/components/LiveView';
import ArchiveView from '@/components/ArchiveView';
import AdminView from '@/components/AdminView';
import ChangePassword from '@/components/ChangePassword';
import LoadingScreen from '@/components/LoadingScreen';
import { ModalProvider, friendlyError, useModal } from '@/components/ModalProvider';
import { api } from '@/lib/client';

function patchIvsCompat() {
  const ivs = window.IVSPlayer;
  if (!ivs?.create || ivs.__swCompatPatched) return;
  try {
    const originalCreate = ivs.create.bind(ivs);
    ivs.create = (...args) => {
      const player = originalCreate(...args);
      if (player && typeof player.play === 'function' && !player.__swPlayPatched) {
        const originalPlay = player.play.bind(player);
        player.play = (...playArgs) => {
          const result = originalPlay(...playArgs);
          return result && typeof result.catch === 'function' ? result : Promise.resolve(result);
        };
        player.__swPlayPatched = true;
      }
      return player;
    };
    ivs.__swCompatPatched = true;
  } catch (error) {
    console.warn('IVS compatibility patch could not be applied.', error);
  }
}

export default function Portal() {
  return (
    <ModalProvider>
      <PortalApp />
    </ModalProvider>
  );
}

function PortalApp() {
  const { notify } = useModal();
  const [ready, setReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Loading…');
  const [contentLoading, setContentLoading] = useState(false);
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [view, setView] = useState('live');
  const [live, setLive] = useState(null);
  const [liveStreams, setLiveStreams] = useState([]);
  const [selectedLiveId, setSelectedLiveId] = useState('');
  const [media, setMedia] = useState([]);
  const [loginMessage, setLoginMessage] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [bootError, setBootError] = useState('');
  const trackingRef = useRef(null);
  const heartbeatRef = useRef(null);
  const lastLiveIdsRef = useRef('');

  const endTracking = useCallback(async () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    const current = trackingRef.current;
    trackingRef.current = null;
    if (!current?.sessionId || !token) return;
    try {
      await api(
        '/api/metrics',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'end',
            sessionId: current.sessionId,
            watchSeconds: Math.round((Date.now() - current.startedAt) / 1000)
          })
        },
        token
      );
    } catch {}
  }, [token]);

  const startTracking = useCallback(
    async (contentType, contentId) => {
      if (!contentId || trackingRef.current?.contentId === contentId) return;
      await endTracking();
      try {
        const deviceId = localStorage.getItem('sw_device_id') || crypto.randomUUID();
        localStorage.setItem('sw_device_id', deviceId);
        const result = await api(
          '/api/metrics',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'start', contentType, contentId, deviceId })
          },
          token
        );
        trackingRef.current = { sessionId: result.sessionId, contentId, startedAt: Date.now() };
        heartbeatRef.current = setInterval(async () => {
          if (!trackingRef.current) return;
          try {
            await api(
              '/api/metrics',
              {
                method: 'POST',
                body: JSON.stringify({
                  action: 'heartbeat',
                  sessionId: trackingRef.current.sessionId,
                  watchSeconds: Math.round((Date.now() - trackingRef.current.startedAt) / 1000)
                })
              },
              token
            );
          } catch {}
        }, 15000);
      } catch {}
    },
    [endTracking, token]
  );

  const loadContent = useCallback(
    async (sessionToken = token) => {
      const result = await api('/api/content', {}, sessionToken);
      setLive(result.live);
      setLiveStreams(result.liveStreams || []);
      setMedia(result.media || []);
      setSelectedLiveId((prev) => {
        const streams = result.liveStreams || [];
        if (prev && streams.some((s) => s.id === prev)) return prev;
        const next = streams[0]?.id || '';
        if (next) localStorage.setItem('sw_selected_live_id', next);
        else localStorage.removeItem('sw_selected_live_id');
        return next;
      });
      lastLiveIdsRef.current = (result.liveStreams || [])
        .map((s) => s.id)
        .sort()
        .join(',');
      return result;
    },
    [token]
  );

  useEffect(() => {
    patchIvsCompat();
    const saved = localStorage.getItem('sw_session_token') || '';
    const savedLive = localStorage.getItem('sw_selected_live_id') || '';
    setSelectedLiveId(savedLive);
    setLoadingMessage(saved ? 'Restoring your session…' : 'Loading…');
    (async () => {
      if (!saved) {
        setReady(true);
        return;
      }
      try {
        const result = await api(
          '/api/auth',
          { method: 'POST', body: JSON.stringify({ action: 'session' }) },
          saved
        );
        setToken(saved);
        setUser(result.user);
        setMustChange(Boolean(result.user?.must_change_password));
        if (!result.user?.must_change_password) {
          setLoadingMessage('Loading live streams…');
          await loadContent(saved);
        }
      } catch {
        localStorage.removeItem('sw_session_token');
        setLoginMessage('Your session expired. Please sign in again.');
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token || mustChange || changingPassword) return undefined;
    if (view !== 'live' && view !== 'admin') return undefined;
    const timer = setInterval(async () => {
      try {
        await loadContent();
      } catch {}
    }, 12000);
    return () => clearInterval(timer);
  }, [token, mustChange, changingPassword, view, loadContent]);

  useEffect(() => {
    const onUnload = () => {
      if (!trackingRef.current?.sessionId) return;
      const payload = JSON.stringify({
        action: 'end',
        sessionId: trackingRef.current.sessionId,
        watchSeconds: Math.round((Date.now() - trackingRef.current.startedAt) / 1000)
      });
      navigator.sendBeacon?.('/api/metrics', new Blob([payload], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  async function handleLogin(result) {
    setToken(result.token);
    const nextUser = {
      id: result.user_id,
      username: result.username,
      display_name: result.display_name,
      role: result.role,
      must_change_password: result.must_change_password
    };
    setUser(nextUser);
    localStorage.setItem('sw_session_token', result.token);
    setMustChange(Boolean(result.must_change_password));
    if (result.must_change_password) return;
    setContentLoading(true);
    setLoadingMessage('Loading portal…');
    try {
      await loadContent(result.token);
      setView('live');
    } catch (error) {
      setBootError(error.message);
    } finally {
      setContentLoading(false);
    }
  }

  async function logout() {
    await endTracking();
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }, token);
    } catch {}
    setToken('');
    setUser(null);
    setLive(null);
    setLiveStreams([]);
    setMedia([]);
    setMustChange(false);
    setChangingPassword(false);
    setContentLoading(false);
    localStorage.removeItem('sw_session_token');
  }

  async function selectLiveStream(streamId, persist = false) {
    const stream = (liveStreams || []).find((s) => s.id === streamId);
    if (!stream) return;
    setSelectedLiveId(stream.id);
    setLive(stream);
    localStorage.setItem('sw_selected_live_id', stream.id);
    if (persist && user?.role === 'admin') {
      try {
        await api(
          '/api/admin',
          { method: 'POST', body: JSON.stringify({ action: 'select-live', channelId: stream.id }) },
          token
        );
      } catch {}
    }
  }

  async function refreshLive() {
    setContentLoading(true);
    setLoadingMessage('Refreshing live streams…');
    try {
      const data = await api('/api/admin', {}, token);
      setLive(data.live);
      setLiveStreams(data.liveStreams || []);
      setMedia(data.media || []);
    } catch (error) {
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setContentLoading(false);
    }
  }

  if (!ready) {
    return <LoadingScreen message={loadingMessage} />;
  }

  if (!token || !user) {
    return <LoginForm message={loginMessage} onSuccess={handleLogin} />;
  }

  if (mustChange || changingPassword) {
    return (
      <ChangePassword
        token={token}
        user={user}
        required={mustChange}
        onLogout={logout}
        onDone={async () => {
          setMustChange(false);
          setChangingPassword(false);
          setUser((u) => ({ ...u, must_change_password: false }));
          setContentLoading(true);
          setLoadingMessage('Loading portal…');
          try {
            await loadContent();
            setView('live');
          } catch (error) {
            setBootError(error.message);
          } finally {
            setContentLoading(false);
          }
        }}
      />
    );
  }

  if (bootError) {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>Portal Error</h1>
          <p>{bootError}</p>
          <button type="button" className="primary-button" onClick={() => setBootError('')}>
            Dismiss
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      {contentLoading ? (
        <div className="content-loading-overlay">
          <LoadingScreen message={loadingMessage} />
        </div>
      ) : null}
      <AppShell
        user={user}
        active={view}
        onNavigate={async (next) => {
          await endTracking();
          setView(next);
          setContentLoading(true);
          setLoadingMessage(
            next === 'admin' ? 'Loading admin…' : next === 'archive' ? 'Loading archive…' : 'Loading…'
          );
          try {
            if (next === 'admin') {
              const data = await api('/api/admin', {}, token);
              setLive(data.live);
              setLiveStreams(data.liveStreams || []);
              setMedia(data.media || []);
            } else {
              await loadContent();
            }
          } catch (error) {
            if (error.status === 401) {
              setLoginMessage('Your session expired. Please sign in again.');
              await logout();
            }
          } finally {
            setContentLoading(false);
          }
        }}
        onLogout={logout}
        onChangePassword={() => setChangingPassword(true)}
      >
        {view === 'live' ? (
          <LiveView
            token={token}
            live={live}
            liveStreams={liveStreams}
            selectedLiveId={selectedLiveId}
            onSelectStream={(id) => selectLiveStream(id)}
            onPlaying={startTracking}
          />
        ) : null}
        {view === 'archive' ? (
          <ArchiveView token={token} media={media} onPlaying={startTracking} />
        ) : null}
        {view === 'admin' ? (
          <AdminView
            token={token}
            user={user}
            live={live}
            liveStreams={liveStreams}
            selectedLiveId={selectedLiveId}
            media={media}
            onSelectStream={(id) => selectLiveStream(id, true)}
            onRefreshLive={refreshLive}
            onPlaying={startTracking}
          />
        ) : null}
      </AppShell>
    </>
  );
}
