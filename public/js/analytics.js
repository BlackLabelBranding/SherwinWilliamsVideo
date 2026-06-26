const SW_METRICS_KEY = 'sw_view_metrics';

function swGetMetrics() {
  const defaults = {
    live: { totalViews: 427, currentViewers: 428, peakViewers: 438 },
    archives: {}
  };
  return JSON.parse(localStorage.getItem(SW_METRICS_KEY) || JSON.stringify(defaults));
}

function swSaveMetrics(metrics) {
  localStorage.setItem(SW_METRICS_KEY, JSON.stringify(metrics));
}

function swFormat(value) {
  return Number(value || 0).toLocaleString();
}

function swSlug(value) {
  return String(value || 'archive-video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function swMetricRow(items) {
  return '<div class="metrics-strip injected-metrics">' + items.map(function (item) {
    return '<div class="metric-card"><span class="metric-value">' + swFormat(item.value) + '</span><span class="metric-label">' + item.label + '</span></div>';
  }).join('') + '</div>';
}

function swTrackLive() {
  const card = document.querySelector('.video-card');
  const pill = document.querySelector('.live-pill.on');
  if (!card || !pill || card.querySelector('.injected-metrics')) return;

  const metrics = swGetMetrics();
  if (!sessionStorage.getItem('sw_live_view_recorded')) {
    metrics.live.totalViews += 1;
    metrics.live.currentViewers += 1;
    metrics.live.peakViewers = Math.max(metrics.live.peakViewers, metrics.live.currentViewers);
    sessionStorage.setItem('sw_live_view_recorded', 'true');
    swSaveMetrics(metrics);
  }

  const anchor = card.querySelector('.video-shell, .no-video');
  if (anchor) {
    anchor.insertAdjacentHTML('beforebegin', swMetricRow([
      { value: metrics.live.currentViewers, label: 'Watching Now' },
      { value: metrics.live.totalViews, label: 'Live Views' },
      { value: metrics.live.peakViewers, label: 'Peak Viewers' }
    ]));
  }
}

function swTrackArchive() {
  const details = document.querySelector('.archive-details-card');
  if (!details || details.querySelector('.injected-metrics')) return;

  const title = details.querySelector('h2')?.textContent || 'Archive Video';
  const id = swSlug(title);
  const metrics = swGetMetrics();
  metrics.archives[id] = metrics.archives[id] || { views: 0, uniqueViewers: 0, comments: 0 };

  if (!sessionStorage.getItem('sw_archive_view_' + id)) {
    metrics.archives[id].views += 1;
    metrics.archives[id].uniqueViewers += 1;
    sessionStorage.setItem('sw_archive_view_' + id, 'true');
  }

  metrics.archives[id].comments = document.querySelectorAll('#archive-comment-list .archive-comment').length;
  swSaveMetrics(metrics);

  const anchor = details.querySelector('.video-shell');
  if (anchor) {
    anchor.insertAdjacentHTML('beforebegin', swMetricRow([
      { value: metrics.archives[id].views, label: 'Views' },
      { value: metrics.archives[id].uniqueViewers, label: 'Unique Viewers' },
      { value: metrics.archives[id].comments, label: 'Comments' }
    ]));
  }
}

function swRefreshMetrics() {
  swTrackLive();
  swTrackArchive();
}

new MutationObserver(function () {
  requestAnimationFrame(swRefreshMetrics);
}).observe(document.body, { childList: true, subtree: true });

swRefreshMetrics();
setTimeout(swRefreshMetrics, 100);
setTimeout(swRefreshMetrics, 500);
setTimeout(swRefreshMetrics, 1000);
