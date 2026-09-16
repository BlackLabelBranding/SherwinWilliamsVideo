'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_LOGO } from '@/lib/client';

function userInitials(user) {
  const name = String(user?.display_name || user?.username || '').trim();
  if (!name) return 'U';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatRole(role) {
  const value = String(role || 'driver');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function AppShell({ user, active, onNavigate, onLogout, onChangePassword, children, hideNav = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const initials = useMemo(() => userInitials(user), [user]);
  const displayName = user?.display_name || user?.username || 'User';

  useEffect(() => {
    if (!menuOpen) return undefined;

    function onPointerDown(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <>
      {!hideNav ? (
        <>
          <nav className="nav">
            <button type="button" className="nav-brand" onClick={() => onNavigate('live')} aria-label="Go to Live">
              <img src={BRAND_LOGO} alt="" className="nav-logo" />
              <span>Sherwin Safety</span>
            </button>
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
            <div className="nav-user" ref={menuRef}>
              <button
                type="button"
                className={`nav-avatar${menuOpen ? ' is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Account menu for ${displayName}`}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span aria-hidden="true">{initials}</span>
              </button>
              {menuOpen ? (
                <div className="nav-user-menu" role="menu">
                  <div className="nav-user-menu-header">
                    <strong>{displayName}</strong>
                    <span className="nav-user-role">{formatRole(user?.role)}</span>
                  </div>
                  {user?.role === 'admin' ? (
                    <button
                      type="button"
                      className="nav-user-menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onChangePassword?.();
                      }}
                    >
                      Password
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="nav-user-menu-item nav-user-menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout?.();
                    }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </nav>
          <div className="nav-spacer" aria-hidden="true" />
        </>
      ) : null}
      <main className="app-shell">{children}</main>
    </>
  );
}
