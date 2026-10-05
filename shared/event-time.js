export function elapsedTime(at, startedAt) {
  if (!at || !startedAt) return null;
  const milliseconds = Date.parse(at) - Date.parse(startedAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

export const recordStart = record => record?.matchStartedAt || record?.state?.matchStartedAt || record?.events?.[0]?.at || null;
export const eventTime = (event, startedAt) => event?.elapsed ?? elapsedTime(event?.at, startedAt) ?? '—';
