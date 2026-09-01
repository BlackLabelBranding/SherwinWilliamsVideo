'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import { friendlyError, useModal } from '@/components/ModalProvider';
import { api, withCacheBust } from '@/lib/client';

function fmtTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function TrimRecordingPanel({ media = [], token, mediaVersions = {}, onTrimComplete }) {
  const { notify } = useModal();
  const railRef = useRef(null);
  const videoShellRef = useRef(null);
  const dragRef = useRef(null);
  const timelineReadyRef = useRef(false);
  const [playbackKey, setPlaybackKey] = useState('');
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(60);
  const [trimProgress, setTrimProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);

  const selected = (media || []).find((item) => item.playback_key === playbackKey) || null;
  const cacheVersion = mediaVersions[playbackKey] || previewVersion;
  const previewUrl = selected?.url ? withCacheBust(selected.url, cacheVersion) : '';

  useEffect(() => {
    timelineReadyRef.current = false;
    setDuration(0);
    setStartSec(0);
    setEndSec(60);
  }, [playbackKey]);

  useEffect(() => {
    timelineReadyRef.current = false;
    setDuration(0);
    setStartSec(0);
    setEndSec(60);
  }, [previewUrl]);

  const applyTimelineDuration = useCallback((seconds) => {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return;
    const resetRange = !timelineReadyRef.current;
    setDuration(total);
    if (resetRange) {
      setStartSec(0);
      setEndSec(total);
      timelineReadyRef.current = true;
      return;
    }
    setEndSec((prevEnd) => Math.min(prevEnd, total));
    setStartSec((prevStart) => Math.min(prevStart, Math.max(0, total - 1)));
  }, []);

  useEffect(() => {
    if (!duration) return;
    setStartSec((prev) => Math.min(prev, Math.max(0, duration - 1)));
    setEndSec((prev) => {
      if (prev <= 0 || prev > duration) return duration;
      return Math.max(prev, 1);
    });
  }, [duration]);

  const seekVideo = useCallback(
    (time) => {
      const video = videoShellRef.current?.querySelector('video');
      if (!video || !Number.isFinite(time)) return;
      const limit = duration || video.duration || time;
      try {
        video.currentTime = Math.min(Math.max(0, time), limit);
      } catch {}
    },
    [duration]
  );

  const updateFromPct = useCallback(
    (handle, pct) => {
      if (!duration) return;
      const t = pct * duration;
      if (handle === 'start') {
        const next = Math.min(t, endSec - 1);
        setStartSec(Math.max(0, next));
        seekVideo(next);
      } else {
        const next = Math.max(t, startSec + 1);
        setEndSec(Math.min(duration, next));
        seekVideo(next);
      }
    },
    [duration, endSec, startSec, seekVideo]
  );

  useEffect(() => {
    function onMove(event) {
      const drag = dragRef.current;
      const rail = railRef.current;
      if (!drag || !rail || !duration) return;
      const rect = rail.getBoundingClientRect();
      const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      updateFromPct(drag, pct);
    }

    function onUp() {
      dragRef.current = null;
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [duration, updateFromPct]);

  function beginDrag(handle, event) {
    if (!duration || busy) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = handle;
  }

  function onRailPointerDown(event) {
    if (!duration || busy || !railRef.current) return;
    if (event.target.closest('.trim-handle')) return;
    event.preventDefault();
    const rect = railRef.current.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const midpoint = (startSec + endSec) / 2 / duration;
    updateFromPct(pct <= midpoint ? 'start' : 'end', pct);
    dragRef.current = pct <= midpoint ? 'start' : 'end';
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!playbackKey) return;
    if (endSec <= startSec) {
      notify({ message: 'End time must be after start time.', tone: 'error' });
      return;
    }

    const trimStart = Number(startSec.toFixed(2));
    const trimEnd = Number(endSec.toFixed(2));
    const keepSeconds = Math.max(0, trimEnd - trimStart);

    setBusy(true);
    setTrimProgress('Trimming playlist in S3…');
    try {
      const result = await api(
        '/api/admin',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'trim-media',
            playbackKey,
            startSeconds: trimStart,
            endSeconds: trimEnd,
            replaceOriginal: true
          })
        },
        token
      );
      const cacheVersion = result.updatedAt || Date.now();
      setPreviewVersion(cacheVersion);
      timelineReadyRef.current = false;
      setDuration(0);
      setStartSec(0);
      setEndSec(60);
      setTrimProgress(`Saved · ${fmtTime(keepSeconds)} kept`);
      onTrimComplete?.(playbackKey, cacheVersion);
      notify({
        title: 'Trim complete',
        message: `Kept ${fmtTime(keepSeconds)} from the recording.`,
        tone: 'success'
      });
    } catch (error) {
      setTrimProgress(friendlyError(error));
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const startPct = duration ? (startSec / duration) * 100 : 0;
  const endPct = duration ? (endSec / duration) * 100 : 100;

  return (
    <form className="portal-form form-grid trim-form" onSubmit={onSubmit}>
      <label className="wide-field">
        Recording
        <select
          name="playbackKey"
          required
          value={playbackKey}
          disabled={busy}
          onChange={(event) => setPlaybackKey(event.target.value)}
        >
          <option value="">Select a recording…</option>
          {(media || []).map((item) => (
            <option key={item.id} value={item.playback_key || ''}>
              {item.title}
            </option>
          ))}
        </select>
      </label>

      {selected?.url ? (
        <div className="wide-field trim-preview-block">
          <div ref={videoShellRef} className="trim-video-wrap">
            <VideoPlayer
              key={`trim-${selected.id}-${cacheVersion || 'initial'}`}
              url={previewUrl}
              contentType="media"
              contentId={`trim-${selected.id}`}
              muted
              onDuration={applyTimelineDuration}
            />
          </div>
          <div className="trim-rail-wrap">
            <p className="trim-rail-hint">Drag the handles to choose the part to keep.</p>
            <div
              ref={railRef}
              className={`trim-rail${duration && !busy ? '' : ' is-disabled'}`}
              aria-hidden={!duration}
              onMouseDown={onRailPointerDown}
              onTouchStart={onRailPointerDown}
            >
              <div className="trim-rail-track" />
              <div
                className="trim-rail-selection"
                style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
              />
              <button
                type="button"
                className="trim-handle trim-handle-start"
                style={{ left: `${startPct}%` }}
                aria-disabled={!duration || busy}
                aria-label="Trim start"
                onMouseDown={(event) => beginDrag('start', event)}
                onTouchStart={(event) => beginDrag('start', event)}
              />
              <button
                type="button"
                className="trim-handle trim-handle-end"
                style={{ left: `${endPct}%` }}
                aria-disabled={!duration || busy}
                aria-label="Trim end"
                onTouchStart={(event) => beginDrag('end', event)}
                onMouseDown={(event) => beginDrag('end', event)}
              />
            </div>
            <div className="trim-times">
              <span>Start: {fmtTime(startSec)}</span>
              <span>Keep: {fmtTime(Math.max(0, endSec - startSec))}</span>
              <span>End: {fmtTime(endSec)}</span>
              {duration ? <span>Total: {fmtTime(duration)}</span> : <span>Loading duration…</span>}
            </div>
          </div>
          <div className="trim-footer">
            <label className="checkbox-row trim-checkbox">
              <input name="replaceOriginal" type="checkbox" defaultChecked disabled={busy} /> Replace original
              playlist in S3
            </label>
            {trimProgress ? <div className="upload-progress trim-progress">{trimProgress}</div> : null}
            <div className="form-action trim-form-action">
              <button className="primary-button" type="submit" disabled={busy || !playbackKey || !duration}>
                {busy ? 'Saving…' : 'Trim & Save'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="trim-footer wide-field">
          <label className="checkbox-row trim-checkbox">
            <input name="replaceOriginal" type="checkbox" defaultChecked disabled={busy} /> Replace original
            playlist in S3
          </label>
          {trimProgress ? <div className="upload-progress trim-progress">{trimProgress}</div> : null}
          <div className="form-action trim-form-action">
            <button className="primary-button" type="submit" disabled={busy || !playbackKey}>
              {busy ? 'Saving…' : 'Trim & Save'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
