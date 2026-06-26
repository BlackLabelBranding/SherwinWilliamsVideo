function installDriverLayoutStyles() {
  if (document.getElementById('driver-layout-styles')) return;
  const style = document.createElement('style');
  style.id = 'driver-layout-styles';
  style.textContent = `
    .video-card .metrics-strip,
    .video-card .injected-metrics {
      max-width: 260px !important;
      margin: 12px 0 0 !important;
    }

    .video-card .metric-card:nth-child(n+2) {
      display: none !important;
    }

    .mobile-archive-selector {
      display: none;
      padding: 18px;
      border-radius: 18px;
      background: rgba(0, 42, 92, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.18);
    }

    .mobile-archive-selector label {
      display: block;
      margin-bottom: 8px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .mobile-archive-selector select {
      width: 100%;
      padding: 14px 16px;
      color: #111827;
      background: #ffffff;
      border: 0;
      border-radius: 14px;
      font-weight: 800;
    }

    @media (max-width: 900px) {
      .archive-layout {
        display: flex !important;
        flex-direction: column !important;
      }

      .mobile-archive-selector {
        display: block !important;
        order: 1 !important;
      }

      .archive-details-card {
        order: 2 !important;
      }

      .archive-list-card {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function moveLiveMetricsBelowVideo() {
  const liveCard = document.querySelector('.video-card');
  if (!liveCard) return;

  const metrics = liveCard.querySelector('.metrics-strip, .injected-metrics');
  const video = liveCard.querySelector('.video-shell, .no-video');
  if (!metrics || !video) return;

  if (metrics.previousElementSibling !== video) {
    video.insertAdjacentElement('afterend', metrics);
  }
}

function buildMobileArchiveSelector() {
  const layout = document.querySelector('.archive-layout');
  const listCard = document.querySelector('.archive-list-card');
  const archiveList = document.querySelector('#archive-list');
  if (!layout || !listCard || !archiveList) return;

  let selectorBlock = document.querySelector('.mobile-archive-selector');
  if (!selectorBlock) {
    selectorBlock = document.createElement('div');
    selectorBlock.className = 'mobile-archive-selector';
    selectorBlock.innerHTML = '<label for="mobile-archive-select">Select Recording</label><select id="mobile-archive-select"></select>';
    layout.insertBefore(selectorBlock, layout.firstChild);
  }

  const select = selectorBlock.querySelector('select');
  const archiveButtons = Array.from(archiveList.querySelectorAll('.archive-item'));
  if (!archiveButtons.length) return;

  const currentCount = select.options.length;
  if (currentCount !== archiveButtons.length) {
    select.innerHTML = '';
    archiveButtons.forEach((button, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      const title = button.querySelector('strong')?.textContent || button.textContent.trim() || 'Recording';
      option.textContent = title;
      select.appendChild(option);
    });
  }

  if (!select.dataset.wired) {
    select.dataset.wired = 'true';
    select.addEventListener('change', () => {
      const index = Number(select.value || 0);
      archiveButtons[index]?.click();
      setTimeout(() => {
        document.querySelector('.archive-details-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
  }
}

function driverLayoutRefresh() {
  installDriverLayoutStyles();
  moveLiveMetricsBelowVideo();
  buildMobileArchiveSelector();
}

new MutationObserver(() => requestAnimationFrame(driverLayoutRefresh)).observe(document.body, {
  childList: true,
  subtree: true
});

window.addEventListener('resize', driverLayoutRefresh);
setTimeout(driverLayoutRefresh, 50);
setTimeout(driverLayoutRefresh, 300);
setTimeout(driverLayoutRefresh, 900);
