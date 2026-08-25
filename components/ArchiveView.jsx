'use client';

import { useEffect, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import { api, fmtDate } from '@/lib/client';

export default function ArchiveView({ token, media, onPlaying }) {
  const [selected, setSelected] = useState(media[0] || null);
  const [comments, setComments] = useState([]);
  const [commentBody, setCommentBody] = useState('');

  useEffect(() => {
    if (!media.length) {
      setSelected(null);
      return;
    }
    setSelected((prev) => media.find((m) => m.id === prev?.id) || media[0]);
  }, [media]);

  useEffect(() => {
    if (!selected?.id || !token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const result = await api(
          '/api/content',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'comments', contentType: 'media', contentId: selected.id })
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
  }, [selected?.id, token]);

  async function sendComment(event) {
    event.preventDefault();
    if (!commentBody.trim() || !selected?.id) return;
    const value = commentBody.trim();
    setCommentBody('');
    try {
      await api(
        '/api/content',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'comment',
            contentType: 'media',
            contentId: selected.id,
            body: value
          })
        },
        token
      );
      const result = await api(
        '/api/content',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'comments', contentType: 'media', contentId: selected.id })
        },
        token
      );
      setComments(result.comments || []);
    } catch (error) {
      setCommentBody(value);
      alert(error.message);
    }
  }

  return (
    <section className="archive-layout">
      <div className="archive-list-card">
        <p className="eyebrow">Past Broadcasts</p>
        <h2>Archive</h2>
        <div className="archive-list">
          {!media.length ? (
            <p className="empty-comments">No published recordings yet.</p>
          ) : (
            media.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`archive-item ${selected?.id === item.id ? 'active' : ''}`}
                onClick={() => setSelected(item)}
              >
                <strong>{item.title}</strong>
                <span>
                  {item.media_type === 'audio' ? 'Audio' : 'Video'} ·{' '}
                  {new Date(item.recorded_at).toLocaleDateString()}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="archive-details-card">
        {!selected ? (
          <div className="no-video">Select a recording.</div>
        ) : (
          <>
            <div className="section-title-row">
              <div>
                <p className="eyebrow">{selected.media_type === 'audio' ? 'Audio Recording' : 'Archive Video'}</p>
                <h2>{selected.title}</h2>
                <p>{new Date(selected.recorded_at).toLocaleDateString()}</p>
              </div>
            </div>
            {selected.description ? <p className="media-description">{selected.description}</p> : null}
            {selected.media_type === 'audio' ? (
              <audio
                className="audio-player"
                controls
                preload="metadata"
                src={selected.url}
                onPlaying={() => onPlaying?.('media', selected.id)}
              />
            ) : (
              <VideoPlayer
                url={selected.url}
                contentType="media"
                contentId={selected.id}
                onPlaying={onPlaying}
              />
            )}
            <div className="archive-comments-block">
              <h3>Comments</h3>
              <form className="comment-form archive-style" onSubmit={sendComment}>
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add a comment..."
                  rows={3}
                  required
                />
                <button type="submit" className="primary-button">
                  Post Comment
                </button>
              </form>
              <ul className="archive-comment-list">
                {comments.length ? (
                  comments.map((comment) => (
                    <li key={comment.id} className="archive-comment">
                      <div className="comment-meta">
                        <strong>{comment.display_name}</strong> · {fmtDate(comment.created_at)}
                      </div>
                      <p>{comment.body}</p>
                    </li>
                  ))
                ) : (
                  <li className="empty-comments">No comments yet.</li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
