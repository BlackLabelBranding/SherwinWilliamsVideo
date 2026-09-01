'use client';

import { BRAND_LOGO } from '@/lib/client';

export default function AppShell({ user, active, onNavigate, onLogout, onChangePassword, children, hideNav = false }) {
  return (
    <>
      {!hideNav ? (
        <>
          <nav className="nav">
            <div className="nav-brand">
              <img src={BRAND_LOGO} alt="" className="nav-logo" />
              <span>Sherwin Safety</span>
            </div>
            <div className="nav-links">
              <button type="button" className={`nav-item ${active === 'live' ? 'active' : ''}`} onClick={() => onNavigate('live')}>
                Live
              </button>
              <button type="button" className={`nav-item ${active === 'archive' ? 'active' : ''}`} onClick={() => onNavigate('archive')}>
                Archive
              </button>
              {user?.role === 'admin' ? (
                <button type="button" className={`nav-item ${active === 'admin' ? 'active' : ''}`} onClick={() => onNavigate('admin')}>
                  Admin
                </button>
              ) : null}
            </div>
            <div className="nav-user">
              <span>{user?.display_name || user?.username}</span>
              <button type="button" className="nav-text-btn" onClick={onChangePassword}>
                Password
              </button>
              <button type="button" className="nav-text-btn" onClick={onLogout}>
                Log out
              </button>
            </div>
          </nav>
          <div className="nav-spacer" aria-hidden="true" />
        </>
      ) : null}
      <main className="app-shell">{children}</main>
    </>
  );
}
