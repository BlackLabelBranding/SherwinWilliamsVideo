'use client';

import { useState } from 'react';
import { BRAND_LOGO, api } from '@/lib/client';

export default function LoginForm({ message = '', onSuccess }) {
  const [error, setError] = useState(message);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
          username: String(form.get('username') || '').trim().toLowerCase(),
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
            <p className="eyebrow">Safety Video Portal</p>
            <h1>Sherwin Safety</h1>
          </div>
        </div>
        <p className="login-hint">Sign in with your assigned account to continue.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Username
            <input name="username" type="text" autoComplete="username" required />
          </label>
          <label>
            Password
            <div className="password-field">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.57l2.17 2.17C11.74 7.14 11.87 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 11.5 2.73 15.89 7 19 12 19c1.52 0 2.98-.29 4.32-.82l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                    />
                  </svg>
                )}
              </button>
            </div>
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
