const METRICS_KEY = 'sw_view_metrics_v2';

function getStats() {
  const defaults = {
    live: { watchingNow: 428, liveViews: 427, peakViewers: 438 },
    archives: {}
  };
  return JSON.parse(localStorage.getItem(METRICS_KEY) || JSON.stringify(defaults));
}

function saveStats(stats) {
  localStorage.setItem(METRICS_KEY, JSON.stringify(stats));
}

function fmt(value) {
  return Number(value || 0).toLocaleString();
}

function slug(value) {
  return String(value || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function addCss() {
  if (document.querySelector('link[href="/analytics.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/analytics.css';
  document.head.appendChild(link);
}

function row(items) {
  return '<div class="metrics-strip injected-metrics">' + items.map(function (item) {
    return '<div class="metric-card"><span class="metric-value">' + fmt(item.value) + '</span><span class="metric-label">' + item.label + '</span></div>';
  }).join('') + '</div>';
}

function liveMetrics() {
  const card = document.querySelector('.video-card');
  if (!card || card.querySelector('.injected-metrics')) return;
  const stats = getStats();
  if (!sessionStorage.getItem('live-counted')) {
    stats.live.liveViews += 1;
    stats.live.watchingNow += 1;
    stats.live.peakViewers = Math.max(stats.live.peakViewers, stats.live.watchingNow);
    sessionStorage.setItem('live-counted', '1');
    saveStats(stats);
  }
  const anchor = card.querySelector('.video-shell, .no-video');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', row([
    { value: stats.live.watchingNow, label: 'Watching Now' },
    { value: stats.live.liveViews, label: 'Live Views' },
    { value: stats.live.peakViewers, label: 'Peak Viewers' }
  ]));
}

function archiveMetrics() {
  const panel = document.querySelector('.archive-details-card');
  if (!panel || panel.querySelector('.injected-metrics')) return;
  const title = panel.querySelector('h2')?.textContent || 'Archive Video';
  const id = slug(title);
  const stats = getStats();
  stats.archives[id] = stats.archives[id] || { views: 0, comments: 0, uniqueViewers: 0 };
  if (!sessionStorage.getItem('archive-counted-' + id)) {
    stats.archives[id].views += 1;
    stats.archives[id].uniqueViewers += 1;
    sessionStorage.setItem('archive-counted-' + id, '1');
  }
  stats.archives[id].comments = document.querySelectorAll('#archive-comment-list .archive-comment').length;
  saveStats(stats);
  const anchor = panel.querySelector('.video-shell');
  if (anchor) anchor.insertAdjacentHTML('beforebegin', row([
    { value: stats.archives[id].views, label: 'Views' },
    { value: stats.archives[id].uniqueViewers, label: 'Unique Viewers' },
    { value: stats.archives[id].comments, label: 'Comments' }
  ]));
}

addCss();
new MutationObserver(function () {
  requestAnimationFrame(function () {
    liveMetrics();
    archiveMetrics();
  });
}).observe(document.body, { childList: true, subtree: true });
