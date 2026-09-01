'use client';

import { useEffect, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import { friendlyError, useModal } from '@/components/ModalProvider';
import { api, fmtDate, withCacheBust } from '@/lib/client';

export default function ArchiveView({ token, media, mediaVersions = {}, onPlaying, isAdmin = false, onMediaChange }) {
  const { notify, confirm } = useModal();
  const [selected, setSelected] = useState(media[0] || null);
  const [comments, setComments] = useState([]);
  const [commentBody, setCommentBody] = useState('');
  const [deleting, setDeleting] = useState(false);

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

  const selectedUrl = selected
    ? withCacheBust(selected.url, mediaVersions[selected.playback_key])
    : '';

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
      notify({ message: friendlyError(error), tone: 'error' });
    }
  }

  async function deleteRecording() {
    if (!selected?.storage_path || deleting) return;
    const approved = await confirm({
      title: 'Delete recording?',
      message: `Permanently remove "${selected.title}" from the archive? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
      tone: 'info'
    });
    if (!approved) return;

    setDeleting(true);
    try {
      await api(
        '/api/admin',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'delete-media',
            storagePath: selected.storage_path,
            mediaId: selected.id
          })
        },
        token
      );
      notify({
        title: 'Recording deleted',
        message: 'The video was removed from S3.',
        tone: 'success'
      });
      await onMediaChange?.();
    } catch (error) {
      notify({ message: friendlyError(error), tone: 'error' });
    } finally {
      setDeleting(false);
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
              <div className="archive-title-block">
                <div className="archive-eyebrow-row">
                  <p className="eyebrow">
                    {selected.media_type === 'audio' ? 'Audio Recording' : 'Archive Video'}
                  </p>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="archive-delete-button"
                      aria-label={`Delete ${selected.title}`}
                      title="Delete recording"
                      disabled={deleting}
                      onClick={deleteRecording}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
                <h2>{selected.title}</h2>
                <p>{new Date(selected.recorded_at).toLocaleDateString()}</p>
              </div>
            </div>
            {selected.description ? <p className="media-description">{selected.description}</p> : null}
            {selected.media_type === 'audio' ? (
              <audio
                key={`audio-${selected.id}-${mediaVersions[selected.playback_key] || 'initial'}`}
                className="audio-player"
                controls
                preload="metadata"
                muted
                src={selectedUrl}
                onPlaying={() => onPlaying?.('media', selected.id)}
              />
            ) : (
              <VideoPlayer
                key={`video-${selected.id}-${mediaVersions[selected.playback_key] || 'initial'}`}
                url={selectedUrl}
                contentType="media"
                contentId={selected.id}
                muted
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
