function installAdminDemoStyles() {
  if (document.getElementById('admin-demo-styles')) return;
  const style = document.createElement('style');
  style.id = 'admin-demo-styles';
  style.textContent = `
    .demo-login-grid,
    .demo-login-card,
    .demo-fill-button,
    .admin-mode-banner {
      display: none !important;
    }

    .demo-note {
      display: block !important;
      margin-top: 16px !important;
      color: rgba(255, 255, 255, 0.78) !important;
      font-size: 12px !important;
      line-height: 1.45 !important;
      text-align: center !important;
    }

    .demo-note strong {
      color: #ffffff !important;
      font-weight: 800 !important;
    }
  `;
  document.head.appendChild(style);
}

function restoreSimpleDemoText() {
  const loginCard = document.querySelector('.login-card');
  if (!loginCard) return;

  const oldCards = loginCard.querySelector('.demo-login-grid');
  if (oldCards) oldCards.remove();

  const note = loginCard.querySelector('.demo-note');
  if (!note) return;

  note.style.display = 'block';
  note.innerHTML = 'Demo logins: <strong>driver1</strong> / <strong>pass123</strong> &nbsp; | &nbsp; <strong>admin</strong> / <strong>pass123</strong>';
}

function refreshAdminDemo() {
  installAdminDemoStyles();
  restoreSimpleDemoText();
}

new MutationObserver(() => requestAnimationFrame(refreshAdminDemo)).observe(document.body, {
  childList: true,
  subtree: true
});

setTimeout(refreshAdminDemo, 50);
setTimeout(refreshAdminDemo, 300);
setTimeout(refreshAdminDemo, 900);
