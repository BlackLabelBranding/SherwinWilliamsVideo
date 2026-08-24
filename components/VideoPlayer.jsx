'use client';

import { useEffect, useRef } from 'react';

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
  return (
    url.includes('playback.live-video.net') ||
    url.includes('.m3u8') ||
    url.includes('/api/hls')
  );
}

export default function VideoPlayer({ url, contentType, contentId, muted = false, onPlaying }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !url) return undefined;

    destroyPlayers(element);
    const begin = () => onPlaying?.(contentType, contentId);
    element.addEventListener('playing', begin, { once: true });

    const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).toString();
    const isArchiveProxy = url.includes('/api/hls');
    const isIvsLive = url.includes('playback.live-video.net');

    if (isArchiveProxy || (isHlsUrl(url) && !isIvsLive)) {
      if (window.Hls?.isSupported()) {
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
          element.muted = true;
          element.play().catch(() => {});
        });
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (!data?.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        });
        element._hlsPlayer = hls;
      } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src = absoluteUrl;
        element.load();
        element.play().catch(() => {});
      }
    } else if (isIvsLive && window.IVSPlayer?.isPlayerSupported) {
      const player = window.IVSPlayer.create();
      player.setLiveLowLatencyEnabled?.(true);
      player.attachHTMLVideoElement(element);
      player.load(absoluteUrl);
      player.play().catch(() => {});
      element._ivsPlayer = player;
    } else {
      element.src = absoluteUrl;
      element.load();
    }

    return () => {
      element.removeEventListener('playing', begin);
      destroyPlayers(element);
    };
  }, [url, contentType, contentId, onPlaying]);

  return (
    <div className="video-shell">
      <video ref={ref} controls playsInline muted={muted} preload="metadata" />
    </div>
  );
}
