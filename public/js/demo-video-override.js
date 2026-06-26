const DEMO_VIDEO_PARTS = [
  'https://kilmhwlsqgjxjhvsweqb.supabase.co/storage/v1/object/sign/',
  'sherwin%20williams%20test/swdemovideo.mp4',
  '?token=',
  'eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iZjdlOGY4OS00MDI1LTQxMDItYTY4OS0zNGU4YzIzOGUxODYiLCJhbGciOiJIUzI1NiJ9.',
  'eyJ1cmwiOiJzaGVyd2luIHdpbGxpYW1zIHRlc3Qvc3dkZW1vdmlkZW8ubXA0Iiwic2NvcGUiOiJkb3dubG9hZCIsImlhdCI6MTc4MjQ0NTE1NSwiZXhwIjoxODEzOTgxMTU1fQ.',
  'AsYltii9U8X4ifKNvVSya-TikD3ut7ZrfX2DafLPAts'
];

const DEMO_VIDEO_URL = DEMO_VIDEO_PARTS.join('');

function replaceDemoArchiveVideo() {
  document.querySelectorAll('.archive-item').forEach((item) => {
    if (item.textContent.includes('Supabase Test Video')) {
      item.querySelector('strong').textContent = 'Sherwin-Williams Demo Video';
      const spans = item.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = 'Demo Recording';
    }
  });

  const archiveDetails = document.querySelector('.archive-details-card');
  if (!archiveDetails) return;

  const title = archiveDetails.querySelector('h2');
  if (title && title.textContent.includes('Supabase Test Video')) {
    title.textContent = 'Sherwin-Williams Demo Video';
  }

  archiveDetails.querySelectorAll('p').forEach((p) => {
    if (p.textContent.includes('Test Recording')) p.textContent = 'Demo Recording';
  });

  const video = archiveDetails.querySelector('video');
  if (video && video.src !== DEMO_VIDEO_URL) {
    video.pause();
    video.src = DEMO_VIDEO_URL;
    video.type = 'video/mp4';
    video.load();
  }
}

new MutationObserver(() => requestAnimationFrame(replaceDemoArchiveVideo)).observe(document.body, {
  childList: true,
  subtree: true
});

setTimeout(replaceDemoArchiveVideo, 100);
setTimeout(replaceDemoArchiveVideo, 500);
setTimeout(replaceDemoArchiveVideo, 1000);
