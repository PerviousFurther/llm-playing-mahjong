export function memoryEvents(record) {
  return [...new Map([
    ...(record?.allPrivateEvents || []), ...(record?.myPrivateEvents || []),
    ...(record?.myCoachEvents || []), ...(record?.events || [])
  ].filter(e => e.type === 'memory').map(e => [e.id, e])).values()].sort((a, b) => a.id - b.id);
}

export function memoryAt(events, key, eventId) {
  return events.filter(e => `${e.data.role || 'player'}:${e.data.seat}` === key && e.id <= eventId);
}
