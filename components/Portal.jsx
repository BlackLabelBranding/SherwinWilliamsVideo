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
  const [mediaVersions, setMediaVersions] = useState({});
  const [loginMessage, setLoginMessage] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [bootError, setBootError] = useState('');
  const trackingRef = useRef(null);
  const heartbeatRef = useRef(null);
  const trackingGeneration = useRef(0);
  const lastLiveIdsRef = useRef('');

  const endTracking = useCallback(async () => {
    trackingGeneration.current += 1;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    const current = trackingRef.current;
    trackingRef.current = null;
    if (!current?.sessionId || !token) return;
    try {
      void api(
        '/api/metrics',
        {
          method: 'POST',
          signal: AbortSignal.timeout(7000),
          body: JSON.stringify({
            action: 'end',
            sessionId: current.sessionId,
            watchSeconds: Math.floor(current.watchSeconds)
          })
        },
        token
      ).catch(() => {});
    } catch {}
  }, [token]);

  const startTracking = useCallback(
    async (contentType, contentId) => {
      if (!contentId || trackingRef.current?.contentId === contentId) return;
      void endTracking();
      const generation = trackingGeneration.current;
      const current = { contentId, watchSeconds: 0, playing: true, pending: false, lastSample: Date.now(), lastSent: Date.now() };
      trackingRef.current = current;
      try {
        const content = contentType === 'live' ? (liveStreams.find((s) => s.id === contentId) || live) : media.find((m) => m.id === contentId);
        const result = await api(
          '/api/metrics',
          {
            method: 'POST',
            signal: AbortSignal.timeout(7000),
            body: JSON.stringify({ action: 'start', contentType, contentId, contentTitle: content?.title, broadcastStarted: content?.started_at })
          },
          token
        );
        if (generation !== trackingGeneration.current) return;
        current.sessionId = result.sessionId;
        heartbeatRef.current = setInterval(async () => {
          if (trackingRef.current !== current) return;
          const now = Date.now();
          const element = [...document.querySelectorAll('video, audio')].find((el) => !el.paused && !el.ended && el.readyState >= 3);
          current.playing = Boolean(element && element.currentTime !== current.lastPosition);
          if (current.playing) current.watchSeconds += Math.min(2, (now - current.lastSample) / 1000);
          if (element) current.lastPosition = element.currentTime;
          current.lastSample = now;
          if (current.pending || now - current.lastSent < 15000) return;
          current.pending = true;
          current.lastSent = now;
          try {
            await api(
              '/api/metrics',
              {
                method: 'POST',
                signal: AbortSignal.timeout(7000),
                body: JSON.stringify({
                  action: 'heartbeat',
                  sessionId: current.sessionId,
                  watchSeconds: Math.floor(current.watchSeconds),
                  playing: current.playing
                })
              },
              token
            );
          } catch {} finally { current.pending = false; }
        }, 1000);
      } catch {
        if (trackingRef.current === current) {
          trackingRef.current = null;
          heartbeatRef.current = setTimeout(() => {
            const playing = [...document.querySelectorAll('video, audio')].some((el) => !el.paused && !el.ended);
            if (playing && generation === trackingGeneration.current) void startTracking(contentType, contentId);
          }, 15000);
        }
      }
    },
    [endTracking, token, liveStreams, live, media]
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

  const bumpMediaVersion = useCallback(
    (playbackKey, version = Date.now()) => {
      if (!playbackKey) return;
      setMediaVersions((prev) => ({ ...prev, [playbackKey]: version }));
      loadContent().catch(() => {});
    },
    [loadContent]
  );

  useEffect(() => {
    patchIvsCompat();
    let saved = '';
    let savedLive = '';
    try {
      saved = localStorage.getItem('sw_session_token') || '';
      savedLive = localStorage.getItem('sw_selected_live_id') || '';
    } catch {}
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
        // Hide forced change-password gate; drivers use the password admin set.
        setMustChange(false);
        setLoadingMessage('Loading live streams…');
        await loadContent(saved);
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
        watchSeconds: Math.floor(trackingRef.current.watchSeconds)
      });
      void fetch('/api/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: payload, keepalive: true }).catch(() => {});
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [token]);

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
    setView('live');
    localStorage.setItem('sw_session_token', result.token);
    // Hide forced change-password gate; drivers use the password admin set.
    setMustChange(false);
    setContentLoading(true);
    setLoadingMessage('Loading portal…');
    try {
      await loadContent(result.token);
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
    setView('live');
    setMustChange(false);
    setChangingPassword(false);
    setContentLoading(false);
    setBootError('');
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

  const navigateToView = useCallback(
    async (next) => {
      if ((next === 'archive' || next === 'admin') && user?.role !== 'admin') {
        next = 'live';
      }
      setChangingPassword(false);
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
    },
    [endTracking, loadContent, token, logout, user?.role]
  );

  async function finishPasswordChange() {
    setView('live');
    setMustChange(false);
    setChangingPassword(false);
    setUser((u) => ({ ...u, must_change_password: false }));
    setContentLoading(true);
    setLoadingMessage('Loading portal…');
    try {
      await loadContent();
    } catch (error) {
      setBootError(error.message);
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

  if (mustChange) {
    return (
      <ChangePassword
        token={token}
        user={user}
        required
        onLogout={logout}
        onDone={finishPasswordChange}
      />
    );
  }

  if (changingPassword) {
    return (
      <ChangePassword
        token={token}
        user={user}
        onNavigate={navigateToView}
        onLogout={logout}
        onDone={finishPasswordChange}
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
        onNavigate={navigateToView}
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
        {view === 'archive' && user?.role === 'admin' ? (
          <ArchiveView
            token={token}
            media={media}
            mediaVersions={mediaVersions}
            onPlaying={startTracking}
            isAdmin={user?.role === 'admin'}
            onMediaChange={loadContent}
          />
        ) : null}
        {view === 'admin' && user?.role === 'admin' ? (
          <AdminView
            token={token}
            user={user}
            live={live}
            liveStreams={liveStreams}
            selectedLiveId={selectedLiveId}
            media={media}
            mediaVersions={mediaVersions}
            onTrimComplete={bumpMediaVersion}
            onSelectStream={(id) => selectLiveStream(id, true)}
            onRefreshLive={refreshLive}
            onPlaying={startTracking}
          />
        ) : null}
      </AppShell>
    </>
  );
}
