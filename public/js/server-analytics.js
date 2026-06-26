function swServerUser() {
  return localStorage.getItem('sw_username') || 'driver';
}

function swServerSlug(value) {
  return String(value || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function swServerAnalytics(action, data) {
  try {
    await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    });
  } catch (error) {
    console.warn('Analytics save skipped.', error);
  }
}

function swCurrentContent() {
  const liveCard = document.querySelector('.video-card');
  const archivePanel = document.querySelector('.archive-details-card');

  if (liveCard && document.querySelector('.live-pill.on')) {
    const title = liveCard.querySelector('h2')?.textContent || 'Live Broadcast';
    return { type: 'live', id: 'current-live-event', title: title };
  }

  if (archivePanel) {
    const title = archivePanel.querySelector('h2')?.textContent || 'Archive Video';
    return { type: 'archive', id: swServerSlug(title), title: title };
  }

  return null;
}

let swSavedCurrentKey = '';

function swSaveViewIfNeeded() {
  const content = swCurrentContent();
  if (!content) return;
  const key = content.type + ':' + content.id;
  if (key === swSavedCurrentKey) return;
  swSavedCurrentKey = key;

  swServerAnalytics('start', {
    contentType: content.type,
    contentId: content.id,
    contentTitle: content.title,
    userId: swServerUser(),
    driverName: swServerUser()
  });
}

function swWireCommentSaves() {
  if (window.swServerCommentWired) return;
  window.swServerCommentWired = true;

  document.addEventListener('submit', function (event) {
    const textarea = event.target.querySelector('textarea');
    if (!textarea || !textarea.value.trim()) return;

    const content = swCurrentContent();
    if (!content) return;

    swServerAnalytics('comment', {
      contentType: content.type,
      contentId: content.id,
      contentTitle: content.title,
      userId: swServerUser(),
      driverName: swServerUser(),
      body: textarea.value.trim()
    });
  }, true);
}

swWireCommentSaves();

new MutationObserver(function () {
  requestAnimationFrame(swSaveViewIfNeeded);
}).observe(document.body, { childList: true, subtree: true });
