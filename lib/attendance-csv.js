function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function central(value) {
  return value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' }) : '';
}
function attendanceCsv(rows) {
  const header = ['Driver', 'Username', 'Content', 'Type', 'Content ID', 'Broadcast started (Central)', 'Joined (Central)', 'Ended (Central)', 'Last heartbeat (Central)', 'Playback seconds (estimated)', 'Session ID'];
  return '\uFEFF' + [header, ...rows.map((row) => [
    row.user?.display_name, row.user?.username, row.content_title, row.content_type, row.content_id,
    central(row.broadcast_started_at), central(row.started_at), central(row.ended_at), central(row.last_heartbeat_at), row.watch_seconds, row.sessionId
  ])].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
module.exports = { attendanceCsv, csvCell };
