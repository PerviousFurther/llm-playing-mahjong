// Public facts only: a review must not leak hidden tiles from the engine record.
export function handReview(room, type) {
  if (room.aborted || !['hule', 'pingju', 'qipai', 'jieju'].includes(type) || type === 'hule' && room.game._hule.length) return null;
  const logs = room.game?._paipu.log || [];
  const index = logs.length - (type === 'qipai' ? 2 : 1);
  const log = logs[index];
  if (!log?.some(e => e.hule || e.pingju)) return null;
  const names = room.seats.map(s => s.name);
  const deal = log.find(e => e.qipai)?.qipai;
  if (!deal) return null;
  const firstDealer = room.game._paipu.qijia;
  const name = wind => names[(firstDealer + deal.jushu + wind) % 4];
  const results = log.flatMap(e => e.hule ? [{ winner: name(e.hule.l), from: e.hule.baojia == null ? '自摸' : name(e.hule.baojia), points: e.hule.defen, yaku: e.hule.hupai?.map(y => y.name) }]
    : e.pingju ? [{ draw: e.pingju.name }] : []);
  const play = [0, 1, 2, 3].map(l => ({ name: name(l),
    discards: log.filter(e => e.dapai?.l === l).length,
    riichi: log.some(e => e.dapai?.l === l && e.dapai.p.includes('*')),
    melds: log.filter(e => e.fulou?.l === l).length,
    kans: log.filter(e => e.gang?.l === l).length }));
  const pendingSettlement = ['hule', 'pingju'].includes(type) ? room.game._fenpei : null;
  return { index, facts: { hand: index + 1, results, play, scores: room.seats.map(s => ({ name: s.name,
    points: room.game.model.defen[s.id] + (pendingSettlement?.[room.game.model.player_id.indexOf(s.id)] || 0) })) } };
}
