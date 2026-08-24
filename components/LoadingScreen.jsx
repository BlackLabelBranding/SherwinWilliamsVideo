'use client';

export default function LoadingScreen() {
  return (
    <div className="loading-page" role="status" aria-live="polite" aria-busy="true">
      <p className="loading-text">Loading…</p>
    </div>
  );
}
