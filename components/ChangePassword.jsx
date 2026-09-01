'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/client';

export default function ChangePassword({ token, user, required = false, onDone, onLogout, onNavigate }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') || '');
    const newPassword = String(form.get('newPassword') || '');
    const confirm = String(form.get('confirmPassword') || '');
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api(
        '/api/auth',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'change-password', currentPassword, newPassword })
        },
        token
      );
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={user}
      active="password"
      hideNav={required}
      onNavigate={onNavigate || (() => {})}
      onLogout={onLogout}
      onChangePassword={() => {}}
    >
      <section className="portal-card narrow-card">
        <p className="eyebrow">Account Security</p>
        <h2>{required ? 'Create a New Password' : 'Change Password'}</h2>
        <p>
          {required
            ? 'Your temporary password must be changed before continuing.'
            : 'Choose a password with at least 10 characters.'}
        </p>
        <form className="portal-form" onSubmit={onSubmit}>
          <label>
            Current Password
            <input name="currentPassword" type="password" required />
          </label>
          <label>
            New Password
            <input name="newPassword" type="password" minLength={10} required />
          </label>
          <label>
            Confirm New Password
            <input name="confirmPassword" type="password" minLength={10} required />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            Save Password
          </button>
          {error ? <div className="error-message">{error}</div> : null}
        </form>
      </section>
    </AppShell>
  );
}
