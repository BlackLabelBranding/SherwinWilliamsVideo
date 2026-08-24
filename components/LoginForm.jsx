'use client';

import { useState } from 'react';
import { BRAND_LOGO, api } from '@/lib/client';

export default function LoginForm({ message = '', onSuccess }) {
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api('/api/auth', {
        method: 'POST',
        body: JSON.stringify({
          action: 'login',
          username: String(form.get('username') || '').trim(),
          password: String(form.get('password') || '')
        })
      });
      onSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <img src={BRAND_LOGO} alt="Sherwin-Williams" className="login-logo" />
          <div>
            <p className="eyebrow">Driver Portal</p>
            <h1>Sign in</h1>
          </div>
        </div>
        <p className="login-hint">Use your assigned account to watch live streams and archive recordings.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Username
            <input name="username" type="text" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Signing in…' : 'Log In'}
          </button>
        </form>
        {error ? <div className="error-message">{error}</div> : null}
      </section>
    </main>
  );
}
