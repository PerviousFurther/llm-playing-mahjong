import M from '@kobalab/majiang-core';
import { coreRules } from '../shared/rules.js';

const tileKey = p => p.slice(0, 2).replace('0', '5');
function ownHand(state) {
  const seat = state.seats[state.viewer];
  return M.Shoupai.fromString(seat.handString || '');
}
function visibleCounts(state) {
  const counts = {};
  const add = p => { const key = tileKey(p); counts[key] = (counts[key] || 0) + 1; };
  state.seats[state.viewer].hand.forEach(add);
  for (const seat of state.seats) {
    seat.discards.filter(p => !/[+=-]/.test(p)).forEach(add);
    for (const meld of seat.melds) for (const n of meld.match(/\d/g) || []) add(meld[0] + n);
  }
  state.dora.forEach(add);
  return counts;
}
function yakuInfo(hand, state) {
  const closed = hand.menqian;
  const winds = ['东', '南', '西', '北'];
  const valueHonors = [...new Set([state.round + 1, winds.indexOf(state.seats[state.viewer].wind) + 1, 5, 6, 7])];
  const yakuhai = valueHonors.filter(n => hand._bingpai.z[n] >= 3 || hand._fulou.some(m => m[0] === 'z' && (m.match(/\d/g) || []).filter(d => +d === n).length >= 3)).map(n => 'z' + n);
  return { closed, yakuhai, note: closed ? '门前可考虑立直；仍须满足立直条件。' : yakuhai.length ? '已有役牌刻子；成和还需合法牌形。' : '未确认役牌。副露后不能立直或门前清自摸；须另做役，宝牌不算役。其他役未穷举。' };
}
function evaluate(hand, state, seen) {
  const shanten = M.Util.xiangting(hand);
  const effectiveTiles = hand._zimo ? [] : M.Util.tingpai(hand).map(tile => ({ tile, unseen: Math.max(0, 4 - (seen[tileKey(tile)] || 0)) }));
  return { shanten, effectiveTiles, unseenTotal: effectiveTiles.reduce((n, p) => n + p.unseen, 0), yaku: yakuInfo(hand, state) };
}
export function handInfo(state) {
  const seat = state.seats[state.viewer];
  return { hand: seat.hand, drawn: seat.drawn, melds: seat.melds, ...evaluate(ownHand(state), state, visibleCounts(state)), canWin: state.canWin, note: '进张按牌形计算，不保证有役或可荣和；摸牌后请用 analyze_actions 比较弃牌。' };
}
export function analyzeActions(state, action, value = '', limit = 5) {
  const hand = ownHand(state), seen = visibleCounts(state), rule = M.rule(coreRules(state.rules));
  const choices = state.legalActions.filter(a => a.action === action && (!value || a.value === value));
  if (!choices.length) throw new Error('没有匹配的合法动作，请使用当前上下文中的 legalActions。');
  const results = choices.map(a => {
    const h = hand.clone();
    if (['discard', 'riichi'].includes(action)) h.dapai(a.value);
    else if (['chi', 'pon'].includes(action) || action === 'kan' && state.phase === 'dapai') h.fulou(a.value);
    else if (action === 'kan') h.gang(a.value);
    let nextDiscards;
    if (['chi', 'pon'].includes(action)) nextDiscards = M.Game.get_dapai(rule, h).map(tile => ({ tile, ...evaluate(h.clone().dapai(tile), state, seen) })).sort((a, b) => a.shanten - b.shanten || b.unseenTotal - a.unseenTotal).slice(0, 3);
    const analysis = evaluate(h, state, seen);
    return { action, value: a.value, ...analysis, ...(nextDiscards ? { nextDiscards } : {}), ...(action === 'kan' ? { note: '补牌前分析；不预测岭上牌与新增宝牌。' } : {}) };
  }).sort((a, b) => (a.nextDiscards?.[0]?.shanten ?? a.shanten) - (b.nextDiscards?.[0]?.shanten ?? b.shanten) || b.unseenTotal - a.unseenTotal);
  return { version: state.version, total: results.length, candidates: results.slice(0, limit), note: '按向听数和可见信息排序，不是胜率或防守评分。unseen 是未见枚数，包含他人暗牌和死牌墙，不代表山中剩余。仅使用自己的手牌与公开信息。' };
}
