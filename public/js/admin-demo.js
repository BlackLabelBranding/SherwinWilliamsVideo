function installAdminDemoStyles() {
  if (document.getElementById('admin-demo-styles')) return;
  const style = document.createElement('style');
  style.id = 'admin-demo-styles';
  style.textContent = `
    .demo-login-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-top: 18px;
      text-align: left;
    }

    .demo-login-card {
      display: grid;
      gap: 8px;
      padding: 12px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }

    .demo-login-title {
      color: #ffffff;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 11px;
    }

    .demo-login-credentials {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
    }

    .demo-login-credentials code {
      padding: 4px 7px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.28);
      color: #ffffff;
      font-weight: 800;
    }

    .demo-fill-button {
      width: 100%;
      padding: 10px 12px;
      border: 0;
      border-radius: 999px;
      background: #ec1c24;
      color: #ffffff;
      font-weight: 900;
      cursor: pointer;
    }

    .admin-mode-banner {
      width: min(1180px, calc(100% - 40px));
      margin: 18px auto 0;
      padding: 12px 16px;
      border-radius: 16px;
      background: rgba(236, 28, 36, 0.92);
      color: #ffffff;
      font-weight: 900;
      text-align: center;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
    }
  `;
  document.head.appendChild(style);
}

function addDemoLogins() {
  const loginCard = document.querySelector('.login-card');
  const form = document.getElementById('login-form');
  if (!loginCard || !form || document.querySelector('.demo-login-grid')) return;

  const oldDemoNote = loginCard.querySelector('.demo-note');
  if (oldDemoNote) oldDemoNote.style.display = 'none';

  const grid = document.createElement('div');
  grid.className = 'demo-login-grid';
  grid.innerHTML = `
    <div class="demo-login-card">
      <div class="demo-login-title">Driver Demo Login</div>
      <div class="demo-login-credentials">Username <code>driver1</code> Password <code>pass123</code></div>
      <button class="demo-fill-button" type="button" data-demo-user="driver1">Use Driver Demo</button>
    </div>
    <div class="demo-login-card">
      <div class="demo-login-title">Admin Demo Login</div>
      <div class="demo-login-credentials">Username <code>admin</code> Password <code>pass123</code></div>
      <button class="demo-fill-button" type="button" data-demo-user="admin">Use Admin Demo</button>
    </div>
  `;

  form.insertAdjacentElement('afterend', grid);

  grid.querySelectorAll('[data-demo-user]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('username').value = button.dataset.demoUser;
      document.getElementById('password').value = 'pass123';
      document.getElementById('password').focus();
    });
  });
}

function addAdminModeBanner() {
  const username = localStorage.getItem('sw_username');
  if (username !== 'admin') return;
  if (document.querySelector('.admin-mode-banner')) return;
  if (!document.querySelector('.nav')) return;

  const banner = document.createElement('div');
  banner.className = 'admin-mode-banner';
  banner.textContent = 'Admin Demo Mode - Analytics and management view coming next';
  document.querySelector('.nav').insertAdjacentElement('afterend', banner);
}

function refreshAdminDemo() {
  installAdminDemoStyles();
  addDemoLogins();
  addAdminModeBanner();
}

new MutationObserver(() => requestAnimationFrame(refreshAdminDemo)).observe(document.body, {
  childList: true,
  subtree: true
});

setTimeout(refreshAdminDemo, 50);
setTimeout(refreshAdminDemo, 300);
setTimeout(refreshAdminDemo, 900);
