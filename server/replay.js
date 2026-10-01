import Majiang from '@kobalab/majiang-core';
import { handTiles } from './room.js';

const winds = ['东', '南', '西', '北'];
const labels = { qipai: '发牌', zimo: '摸牌', gangzimo: '岭上摸牌', dapai: '打牌', fulou: '吃碰杠', gang: '杠', kaigang: '翻宝牌', hule: '和牌', pingju: '流局', false_win: '诈胡', jieju: '对局结束' };

// Reconstruct on demand from the engine's complete, concealed-tile record.
// This data is only served to the local owner, never to an agent.
export function replayRecord(room) {
  const paipu = room.game?._paipu;
  return { schema: 1, rules: room.rules, seats: room.seats, paipu,
    events: room.events, allPrivateEvents: room.allPrivateEvents(Infinity),
    myPrivateEvents: room.privateEvents[0], myCoachEvents: room.coachEvents,
    state: room.snapshot(0) };
}

export function replayFrames(record) {
  const p = record.paipu;
  if (!p?.log?.length) return [];
  const board = new Majiang.Board({ title: p.title, player: p.player, qijia: p.qijia });
  const frames = [];
  let result = null, eventCursor = 0, eventId = 0;
  const events = record.events || [];
  const capture = (phase, handIndex, data) => {
    const eventType = ({ qipai: 'hand_started', zimo: 'draw', gangzimo: 'draw', jieju: 'match_ended' })[phase] || phase;
    const next = phase === 'pingju' && data?.name === '诈胡中止' ? -1 : events.findIndex((e, i) => i >= eventCursor && e.type === eventType);
    if (next >= 0) { eventCursor = next + 1; eventId = events[next].id; }
    const state = { started: true, phase, round: board.zhuangfeng, handNumber: board.jushu,
      honba: board.changbang, sticks: board.lizhibang, remaining: board.shan?.paishu || 0,
      dora: board.shan?.baopai || [], matchHand: handIndex + 1, lastResult: result,
      activeSeat: board.lunban < 0 ? null : board.player_id[board.lunban],
      seats: (record.seats || p.player.map((name, id) => ({ name, id }))).map(s => {
        const l = board.player_id.indexOf(s.id), hand = board.shoupai[l];
        const tiles = handTiles(hand);
        return { ...s, name: p.player[s.id], wind: winds[l], score: board.defen[s.id],
          hand: tiles, handCount: tiles.length, drawn: hand?._zimo,
          melds: [...(hand?._fulou || [])], discards: [...(board.he[l]?._pai || [])],
          revealed: true, riichi: !!hand?.lizhi };
      }) };
    frames.push({ label: labels[phase] || phase, eventId, state: JSON.parse(JSON.stringify(state)) });
  };
  for (const [handIndex, log] of p.log.entries()) {
    result = null;
    for (const entry of log) {
      const [phase, data] = Object.entries(entry)[0];
      if (phase === 'false_win') {
        board.defen = board.defen.map((score, id) => score + data.delta[id]);
        result = data;
      } else {
        const method = phase === 'gangzimo' ? 'zimo' : phase;
        if (typeof board[method] !== 'function') continue;
        board[method](data);
        if (phase === 'hule') {
          // Board omits the borrowed ron tile; replay should show it too.
          board.shoupai[data.l] = Majiang.Shoupai.fromString(data.shoupai);
          result = { kind: 'win', ...data, winner: board.player_id[data.l] };
        }
        if (phase === 'pingju') result = { kind: 'draw', ...data };
      }
      capture(phase, handIndex, data);
    }
    if (handIndex < p.log.length - 1 || record.state?.matchOver && !record.state.aborted) board.last();
  }
  if (record.state?.matchOver && !record.state.aborted && p.defen) { board.jieju(p); capture('jieju', p.log.length - 1); }
  return frames;
}

export function playableReplay(record) {
  const actions = replayFrames(record);
  if (!actions.length) return { ...record, frames: [] };
  const messages = [...new Map([...(record.events || []), ...(record.allPrivateEvents || []), ...(record.myCoachEvents || [])]
    .filter(e => e.type === 'chat').map(e => [e.id, e])).values()].sort((a, b) => a.id - b.id);
  const frames = [];
  let cursor = 0, previous = actions[0];
  for (const action of actions) {
    while (cursor < messages.length && messages[cursor].id < action.eventId) {
      const message = messages[cursor++];
      frames.push({ ...previous, label: '聊天', eventId: message.id, at: message.at });
    }
    frames.push(action); previous = action;
  }
  for (const message of messages.slice(cursor)) frames.push({ ...previous, label: '聊天', eventId: message.id, at: message.at });
  return { ...record, frames };
}
