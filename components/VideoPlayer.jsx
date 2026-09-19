'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function fmtClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** IVS player.play() may return undefined instead of a Promise. */
function safePlay(playFn) {
  try {
    const result = playFn();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {}
}

function patchIvsPlayerPlay(player) {
  if (!player || typeof player.play !== 'function' || player.__swPlayPatched) return;
  const originalPlay = player.play.bind(player);
  player.play = (...args) => {
    const result = originalPlay(...args);
    return result && typeof result.catch === 'function' ? result : Promise.resolve(result);
  };
  player.__swPlayPatched = true;
}

function waitFor(check, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let timer;
    const poll = () => {
      try {
        if (check()) {
          clearInterval(timer);
          resolve(true);
          return true;
        }
        if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
          return true;
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
        return true;
      }
      return false;
    };
    if (!poll()) timer = setInterval(poll, 80);
  });
}

function waitForIvsPlayer() {
  // SDK readiness and browser support are separate. isPlayerSupported is a
  // BOOLEAN, not a function; calling it prevents every IVS stream from loading.
  return waitFor(() => typeof window.IVSPlayer?.create === 'function');
}

function waitForHls() {
  return waitFor(() => Boolean(window.Hls?.isSupported?.()));
}

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && typeof window !== 'undefined' && window.innerWidth < 1024)
  );
}

function destroyPlayers(element) {
  if (!element) return;
  if (element._ivsPlayer) {
    try {
      element._ivsPlayer.delete();
    } catch {}
    element._ivsPlayer = null;
  }
  if (element._hlsPlayer) {
    try {
      element._hlsPlayer.destroy();
    } catch {}
    element._hlsPlayer = null;
  }
}

function isHlsUrl(url) {
  const value = String(url || '');
  return (
    value.includes('playback.live-video.net') ||
    value.includes('.m3u8') ||
    value.includes('/api/hls')
  );
}

function parsePlaylistDuration(text) {
  let total = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) {
      total += Number(trimmed.slice(8).split(',')[0]) || 0;
    }
  }
  return total;
}

function getNativeDuration(element) {
  return Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')?.get?.call(element);
}

function getEffectiveDuration(element) {
  const manifest = element._manifestDuration;
  const media = element.duration;
  if (Number.isFinite(manifest) && manifest > 0) {
    return manifest;
  }
  if (Number.isFinite(media) && media > 0) return media;
  if (element.seekable?.length > 0) {
    return element.seekable.end(element.seekable.length - 1);
  }
  return null;
}

function clampPlayback(element) {
  const limit = getEffectiveDuration(element);
  if (!Number.isFinite(limit) || limit <= 0) return;
  if (element.currentTime > limit + 0.05) {
    element.currentTime = Math.max(0, limit - 0.01);
    element.pause();
  }
}

function applyManifestDuration(element, total, reportDuration) {
  if (!Number.isFinite(total) || total <= 0) return;
  element._manifestDuration = total;
  reportDuration();
}

async function loadManifestDuration(element, url, reportDuration) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return;
    const total = parsePlaylistDuration(await response.text());
    if (total > 0) {
      applyManifestDuration(element, total, reportDuration);
    }
  } catch {}
}

function needsCustomControls(element) {
  const total = getEffectiveDuration(element);
  if (!Number.isFinite(total) || total <= 0) return false;
  return Number.isFinite(element._nativeMediaDuration) && element._nativeMediaDuration > total + 0.25;
}

export default function VideoPlayer({ url, contentType, contentId, muted = false, onPlaying, onDuration }) {
  const playbackUrl = String(url || '');
  const isArchiveHls = playbackUrl.includes('/api/hls');
  const shellRef = useRef(null);
  const ref = useRef(null);
  const onDurationRef = useRef(onDuration);
  const onPlayingRef = useRef(onPlaying);
  const lastReportedDurationRef = useRef(0);
  const [customControls, setCustomControls] = useState(isArchiveHls);
  const [playing, setPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(muted);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [needsUserPlay, setNeedsUserPlay] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const isLive = contentType === 'live';

  useEffect(() => {
    onDurationRef.current = onDuration;
  }, [onDuration]);

  useEffect(() => {
    onPlayingRef.current = onPlaying;
  }, [onPlaying]);

  useEffect(() => {
    setIsMuted(muted);
  }, [muted, url]);

  const togglePlay = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (element.paused) {
      if (element._ivsPlayer) safePlay(() => element._ivsPlayer.play());
      else safePlay(() => element.play());
      setNeedsUserPlay(false);
    } else {
      if (element._ivsPlayer) element._ivsPlayer.pause();
      else element.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const next = !element.muted;
    element._ivsPlayer?.setMuted(next);
    element.muted = next;
    setIsMuted(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    shell.requestFullscreen?.().catch(() => {});
  }, []);

  const onSeek = useCallback(
    (event) => {
      const element = ref.current;
      if (!element || !progress.total) return;
      const pct = Number(event.target.value) / 100;
      element.currentTime = Math.min(progress.total, Math.max(0, pct * progress.total));
    },
    [progress.total]
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || !playbackUrl) return undefined;

    lastReportedDurationRef.current = 0;
    element._manifestDuration = 0;
    element._nativeMediaDuration = 0;
    setCustomControls(isArchiveHls);
    setPlaying(false);
    setProgress({ current: 0, total: 0 });
    setNeedsUserPlay(false);
    setPlaybackError('');

    let cancelled = false;
    let userPlayTimer;

    const showPlaybackError = (message) => {
      if (cancelled) return;
      clearTimeout(userPlayTimer);
      setPlaying(false);
      setNeedsUserPlay(false);
      setPlaybackError(message);
    };

    const markNeedsUserPlay = () => {
      if (cancelled || !isLive) return;
      clearTimeout(userPlayTimer);
      userPlayTimer = window.setTimeout(() => {
        if (!cancelled && element.paused) setNeedsUserPlay(true);
      }, 600);
    };

    const updateUi = () => {
      const total = getEffectiveDuration(element);
      const useCustom = isArchiveHls || needsCustomControls(element);
      if (!Number.isFinite(total) || total <= 0) {
        setCustomControls(useCustom);
        return;
      }
      setCustomControls(useCustom);
      setProgress({
        current: Math.min(element.currentTime || 0, total),
        total
      });
    };

    const reportDuration = () => {
      const manifest = element._manifestDuration;
      const native = getNativeDuration(element);
      if (Number.isFinite(manifest) && Number.isFinite(native) && native > manifest + 0.25) {
        element._nativeMediaDuration = native;
      }
      updateUi();
      const value = getEffectiveDuration(element);
      if (!Number.isFinite(value) || value <= 0) return;
      if (Math.abs(value - lastReportedDurationRef.current) < 0.25) return;
      lastReportedDurationRef.current = value;
      onDurationRef.current?.(value);
    };

    const onTimeUpdate = () => {
      if (!isLive) clampPlayback(element);
      updateUi();
    };

    const onPlay = () => {
      setPlaying(true);
      setNeedsUserPlay(false);
    };
    const onPause = () => setPlaying(false);
    const onVolumeChange = () => setIsMuted(element.muted);

    destroyPlayers(element);
    const begin = () => {
      setPlaybackError('');
      onPlayingRef.current?.(contentType, contentId);
    };
    const onMediaError = () => {
      if (isLive) showPlaybackError('The live stream could not be loaded. Select Retry to reconnect.');
    };
    element.addEventListener('error', onMediaError);
    element.addEventListener('playing', begin, { once: true });
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('volumechange', onVolumeChange);
    element.addEventListener('loadedmetadata', reportDuration);
    element.addEventListener('durationchange', reportDuration);
    element.addEventListener('loadeddata', reportDuration);
    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('seeking', onTimeUpdate);
    element.addEventListener('seeked', onTimeUpdate);

    const absoluteUrl = playbackUrl.startsWith('http')
      ? playbackUrl
      : new URL(playbackUrl, window.location.origin).toString();
    const isArchiveProxy = playbackUrl.includes('/api/hls');
    const isIvsLive = playbackUrl.includes('playback.live-video.net');

    async function setupPlayer() {
      if (isArchiveProxy || (isHlsUrl(playbackUrl) && !isIvsLive)) {
        loadManifestDuration(element, absoluteUrl, reportDuration);
        const hlsReady = await waitForHls();
        if (cancelled) return;
        if (hlsReady && window.Hls?.isSupported()) {
          const hls = new window.Hls({
            enableWorker: false,
            lowLatencyMode: false,
            startLevel: 0,
            capLevelToPlayerSize: true,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            manifestLoadingTimeOut: 120000,
            levelLoadingTimeOut: 120000,
            fragLoadingTimeOut: 180000,
            fragLoadingMaxRetry: 6,
            levelLoadingMaxRetry: 6,
            xhrSetup: (xhr) => {
              xhr.withCredentials = false;
            }
          });
          hls.loadSource(absoluteUrl);
          hls.attachMedia(element);
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            element.muted = muted;
            setIsMuted(muted);
            safePlay(() => element.play());
            markNeedsUserPlay();
          });
          hls.on(window.Hls.Events.LEVEL_LOADED, (_, data) => {
            const total = data.details?.totalduration;
            if (Number.isFinite(total) && total > 0) {
              applyManifestDuration(element, total, reportDuration);
            }
          });
          hls.on(window.Hls.Events.ERROR, (_, data) => {
            if (!data?.fatal) return;
            if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          });
          element._hlsPlayer = hls;
        } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
          element.src = absoluteUrl;
          element.muted = muted;
          setIsMuted(muted);
          element.load();
          safePlay(() => element.play());
          markNeedsUserPlay();
        }
        return;
      }

      if (!isIvsLive) {
        element.src = absoluteUrl;
        element.load();
        return;
      }

      const ivsReady = await waitForIvsPlayer();
      if (cancelled) return;

      if (ivsReady && window.IVSPlayer.isPlayerSupported === true) {
        const player = window.IVSPlayer.create();
        // Retain immediately so cleanup also works if attachment/load throws.
        element._ivsPlayer = player;
        patchIvsPlayerPlay(player);
        const events = window.IVSPlayer.PlayerEventType;
        if (events?.ERROR) {
          player.addEventListener(events.ERROR, (error) => {
            if (cancelled) return;
            console.error('[Sherwin Safety] IVS playback error', {
              code: error?.code, type: error?.type, source: error?.source
            });
            const code = Number.isFinite(error?.code) ? ` (code ${error.code})` : '';
            showPlaybackError(`The live stream could not be played${code}. Select Retry to reconnect.`);
          });
        }
        const playbackBlocked = () => {
          if (!cancelled) setNeedsUserPlay(true);
        };
        if (events?.PLAYBACK_BLOCKED) player.addEventListener(events.PLAYBACK_BLOCKED, playbackBlocked);
        if (events?.AUDIO_BLOCKED) player.addEventListener(events.AUDIO_BLOCKED, playbackBlocked);
        if (isMobileDevice()) player.setLiveLowLatencyEnabled?.(false);
        else player.setLiveLowLatencyEnabled?.(true);
        player.attachHTMLVideoElement(element);
        player.setMuted(muted);
        element.muted = muted;
        setIsMuted(muted);
        element.setAttribute('playsinline', '');
        element.setAttribute('webkit-playsinline', '');
        player.load(absoluteUrl);
        safePlay(() => player.play());
        markNeedsUserPlay();
        return;
      }

      if (element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src = absoluteUrl;
        element.muted = muted;
        setIsMuted(muted);
        element.load();
        safePlay(() => element.play());
        markNeedsUserPlay();
        return;
      }

      showPlaybackError(
        ivsReady
          ? 'This browser does not support live playback. Try an updated browser.'
          : 'The video player could not load. Check your connection and select Retry.'
      );
    }

    setupPlayer().catch((error) => {
      if (cancelled) return;
      console.error('[Sherwin Safety] Player initialization failed', error);
      destroyPlayers(element);
      showPlaybackError('The video player could not start. Select Retry to reconnect.');
    });

    return () => {
      cancelled = true;
      clearTimeout(userPlayTimer);
      element.removeEventListener('error', onMediaError);
      element.removeEventListener('playing', begin);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('volumechange', onVolumeChange);
      element.removeEventListener('loadedmetadata', reportDuration);
      element.removeEventListener('durationchange', reportDuration);
      element.removeEventListener('loadeddata', reportDuration);
      element.removeEventListener('timeupdate', onTimeUpdate);
      element.removeEventListener('seeking', onTimeUpdate);
      element.removeEventListener('seeked', onTimeUpdate);
      destroyPlayers(element);
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [url, playbackUrl, contentType, contentId, muted, isArchiveHls, isLive, retryVersion]);

  const seekPct = progress.total ? Math.min(100, (progress.current / progress.total) * 100) : 0;
  const showCustomControls = customControls;

  if (!playbackUrl) {
    return (
      <div className="video-shell">
        <div className="no-video">Video unavailable.</div>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={`video-shell${showCustomControls ? ' video-shell--custom-controls' : ''}`}
    >
      <video
        ref={ref}
        controls={!showCustomControls}
        playsInline
        muted={isMuted}
        preload="metadata"
        autoPlay={isLive && muted}
      />
      {playbackError ? (
        <div
          className="video-playback-error"
          style={{
            position: 'absolute', inset: 0, zIndex: 5, display: 'grid',
            placeContent: 'center', gap: '0.75rem', padding: '1.25rem',
            textAlign: 'center', background: 'rgba(0, 14, 30, 0.94)', color: '#fff'
          }}
        >
          <p role="alert">{playbackError}</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => setRetryVersion((version) => version + 1)}
          >
            Retry playback
          </button>
        </div>
      ) : null}
      {needsUserPlay && !playbackError ? (
        <button type="button" className="video-tap-play" aria-label="Tap to play live stream" onClick={togglePlay}>
          <span className="video-tap-play-icon" aria-hidden="true">
            ▶
          </span>
          <span>Tap to play</span>
        </button>
      ) : null}
      {showCustomControls ? (
        <div className="video-custom-controls">
          <button type="button" className="video-ctrl-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            {playing ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M8 5v14l11-7L8 5z" />
              </svg>
            )}
          </button>
          <span className="video-ctrl-time">
            {fmtClock(progress.current)} / {fmtClock(progress.total)}
          </span>
          <input
            className="video-ctrl-seek"
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={seekPct}
            aria-label="Seek"
            onChange={onSeek}
          />
          <button type="button" className="video-ctrl-btn" aria-label={isMuted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
            {isMuted ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77 0-4.28-2.99-7.86-7-8.77z"
                />
              </svg>
            )}
          </button>
          <button type="button" className="video-ctrl-btn" aria-label="Fullscreen" onClick={toggleFullscreen}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
