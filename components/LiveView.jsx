'use client';

import { useEffect, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import { friendlyError, useModal } from '@/components/ModalProvider';
import { api, fmtDate } from '@/lib/client';

function StreamList({ streams, activeId, emptyText, onSelect }) {
  if (!streams.length) {
    return <p className="empty-comments">{emptyText || 'No video playing.'}</p>;
  }
  return (
    <div className="live-stream-list">
      {streams.map((stream) => {
        const active = stream.id === activeId;
        const started = stream.started_at ? fmtDate(stream.started_at) : '';
        return (
          <button
            key={stream.id}
            type="button"
            className={`live-stream-item ${active ? 'active' : ''}`}
            onClick={() => onSelect(stream.id)}
          >
            <span className="live-stream-dot" />
            <span className="live-stream-copy">
              <strong>{stream.title}</strong>
              <span>
                {started ? `Started ${started}` : 'Live now'}
                {stream.viewer_count != null ? ` · ${stream.viewer_count} viewers` : ''}
              </span>
            </span>
            <span className="live-stream-badge">{active ? 'Watching' : 'Live'}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function LiveView({
  token,
  live,
  liveStreams,
  selectedLiveId,
  onSelectStream,
  onPlaying
}) {
  const { notify } = useModal();
  const [comments, setComments] = useState([]);
  const [commentBody, setCommentBody] = useState('');
  const streams = liveStreams || [];
  const active =
    streams.find((s) => s.id === selectedLiveId) ||
    (live?.status === 'live' && live?.playback_url ? live : null) ||
    streams[0] ||
    live;
  const isLive = active?.status === 'live' && Boolean(active?.playback_url);

  useEffect(() => {
    if (!active?.id || !token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const result = await api(
          '/api/content',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'comments', contentType: 'live', contentId: active.id })
          },
          token
        );
        if (!cancelled) setComments(result.comments || []);
      } catch {
        if (!cancelled) setComments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id, token]);

  async function sendComment(event) {
    event.preventDefault();
    if (!commentBody.trim() || !active?.id) return;
    const value = commentBody.trim();
    setCommentBody('');
    try {
      await api(
        '/api/content',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'comment',
            contentType: 'live',
            contentId: active.id,
            body: value
          })
        },
        token
      );
      const result = await api(
        '/api/content',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'comments', contentType: 'live', contentId: active.id })
        },
        token
      );
      setComments(result.comments || []);
    } catch (error) {
      setCommentBody(value);
      notify({ message: friendlyError(error), tone: 'error' });
    }
  }

  return (
    <section className="content-grid live-grid">
      <div className="video-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{isLive ? 'Live Now' : 'Live Stream'}</p>
            <h2>{isLive ? active?.title || 'Sherwin-Williams Safety Broadcast' : 'Live Stream'}</h2>
            {isLive && active?.subtitle ? <p>{active.subtitle}</p> : null}
          </div>
          <span className={`live-pill ${isLive ? 'on' : 'off'}`}>{isLive ? 'LIVE' : 'OFF AIR'}</span>
        </div>
        {streams.length > 1 ? (
          <StreamList streams={streams} activeId={active?.id} onSelect={onSelectStream} />
        ) : null}
        {isLive ? (
          <VideoPlayer
            url={active.playback_url}
            contentType="live"
            contentId={active.id}
            muted
            onPlaying={onPlaying}
          />
        ) : (
          <div className="no-video">No video playing.</div>
        )}
      </div>
      <aside className="chat-card">
        <div className="section-title-row compact">
          <div>
            <p className="eyebrow">Live Comments</p>
            <h2>Driver Chat</h2>
          </div>
        </div>
        <ul className="live-comment-list">
          {comments.length ? (
            comments.map((comment) => (
              <li key={comment.id} className="live-comment">
                <div className="comment-bubble">
                  <span className="comment-user">{comment.display_name}</span>
                  <span className="comment-time">{fmtDate(comment.created_at)}</span>
                  <p>{comment.body}</p>
                </div>
              </li>
            ))
          ) : (
            <li className="empty-comments">No comments yet.</li>
          )}
        </ul>
        {active ? (
          <form className="comment-form" onSubmit={sendComment}>
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add a live comment..."
              rows={3}
              required
            />
            <button type="submit" className="primary-button">
              Send
            </button>
          </form>
        ) : null}
      </aside>
    </section>
  );
}

export { StreamList };
