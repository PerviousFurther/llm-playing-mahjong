import { matchLabel, matchLength } from '../shared/rules.js';

// Model input only. Full rules and history remain available to the UI and archives.
export function compactRules(r) {
  return `日麻，25000 点起始，${matchLabel(r)}${matchLength(r) ? '，和牌、流局均计一局，连庄也计数' : ''}。${r.redFives ? '各色一张赤五' : '无赤五'}；${r.openTanyao ? '允许食断' : '禁止食断'}；最多 ${r.multipleRon} 人同时荣和。
和牌须有役，宝牌不是役；振听不可荣和。吃仅限上家，碰杠可响应其他家。副露会破坏门前；立直须门前听牌并支付 1000 点，之后通常摸切。禁止食替。
引擎负责动作合法性与计分：只选 legalActions 中的参数；canWin=true 才能有效和牌。无效和牌请求会被拒绝。无回合时限。`;
}

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const eventInput = event => ({ type: event.type, data: event.type === 'hule'
  ? pick(event.data, ['l', 'baojia', 'defen', 'fanshu', 'fu']) : event.data });

export function agentContext(context) {
  const source = context.state;
  const events = context.publicContext.filter(e => e.type !== 'rules');
  const handStart = events.findLastIndex(e => e.type === 'hand_started');
  const handEvents = events.slice(Math.max(0, handStart));
  // One table circuit: the current/most recent draw and the three preceding draws.
  const draws = handEvents.filter(e => e.type === 'draw');
  const cutoff = draws.at(-4)?.id ?? handEvents[0]?.id ?? 0;
  const recent = list => list.filter(e => e.id >= cutoff).slice(-32).map(eventInput);
  const state = pick(source, ['version', 'started', 'paused', 'matchOver', 'matchHand', 'handLimit', 'phase', 'viewer', 'round', 'handNumber', 'honba', 'sticks', 'remaining', 'dora', 'activeSeat', 'turn', 'canWin', 'waiting', 'expressionOptions', 'aborted']);
  state.seats = source.seats.map(seat => pick(seat, ['id', 'name', 'type', 'wind', 'score', 'hand', 'handCount', 'drawn', 'melds', 'discards', 'riichi', 'revealed']));
  state.legalActions = source.legalActions.map(action => pick(action, ['action', 'value']));
  if (source.lastResult) state.lastResult = pick(source.lastResult, ['kind', 'winner', 'seat', 'name', 'reason', 'baojia', 'defen', 'fanshu', 'fu']);
  return { state, publicContext: recent(handEvents), privateContext: recent(context.privateContext) };
}
