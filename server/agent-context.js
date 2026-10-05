import { matchLabel, matchLength } from '../shared/rules.js';

// Model input only. Full rules and history remain available to the UI and archives.
export function compactRules(r) {
  return `Riichi Mahjong: ${matchLabel(r)}${matchLength(r) ? ' (wins, draws, and dealer repeats count towards hand limits)' : ''}. ${r.redFives ? 'Red 5s enabled' : 'No red 5s'}; ${r.openTanyao ? 'Open Tanyao allowed' : 'Closed Tanyao only'}; max ${r.multipleRon} Ron winner(s).
Rules: Valid Yaku required to win (Dora is not Yaku). Furiten blocks Ron. Chii from kamicha (left player) only; Pon/Kan from any player. Melding opens hand. Riichi requires closed Tenpai and enforces auto-discards. Kuikae (swap calling) is forbidden.
Engine: Choose only from legalActions; win requires canWin=true. Untimed turns.`;
}

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const eventInput = event => ({ id: event.id, at: event.at, type: event.type, data: event.type === 'hule'
  ? pick(event.data, ['l', 'baojia', 'defen', 'fanshu', 'fu']) : event.data });

export function turnInfo(context) {
  const s = context.state;
  return { ...pick(s, ['version', 'matchHand', 'round', 'handNumber', 'honba', 'phase', 'viewer', 'turn', 'remaining', 'dora', 'canWin', 'paused', 'matchOver']),
    legalActions: s.legalActions.map(a => pick(a, ['action', 'value'])),
    lastEvent: context.publicContext.filter(e => !['rules', 'chat'].includes(e.type)).slice(-1).map(eventInput)[0] };
}

export function messageInfo(context, after = 0, limit = 8) {
  const available = [...context.publicContext, ...context.privateContext].filter(e => e.type === 'chat');
  const events = [...new Map(available.map(e => [e.id, e])).values()].filter(e => e.id > after).sort((a, b) => a.id - b.id);
  const page = after ? events.slice(0, limit) : events.slice(-limit);
  return { messages: page.map(eventInput), nextAfter: page.at(-1)?.id ?? after, hasMore: page.length > 0 && events.at(-1).id > page.at(-1).id, note: '仅返回当前可见的近期聊天，非完整聊天档案。' };
}

export function initialContext(context, mode) {
  const s = context.state;
  const state = turnInfo(context);
  state.seats = s.seats.map(seat => pick(seat, ['id', 'name', 'wind', 'score', 'riichi']));
  if (['decision', 'advice'].includes(mode)) state.self = pick(s.seats[s.viewer], ['hand', 'drawn', 'melds']);
  return { state, memory: context.memory || null, ...messageInfo(context, 0, 4) };
}
