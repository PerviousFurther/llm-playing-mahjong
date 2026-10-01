import Majiang from '@kobalab/majiang-core';

function choose(context) {
  const s = context.state, actions = s.legalActions;
  if (s.canWin) return { action: 'declare_win', expression: 'laugh' };
  const other = actions.find(x => x.action === 'riichi') || actions.find(x => x.action === 'continue');
  if (other) return other;
  const hand = Majiang.Shoupai.fromString(s.seats[s.viewer].handString || '');
  const discards = actions.filter(x => x.action === 'discard');
  if (discards.length) {
    const scored = discards.map(a => {
      const h = hand.clone().dapai(a.value);
      const shanten = Majiang.Util.xiangting(h);
      let effective = 0;
      for (const p of Majiang.Util.tingpai(h)) {
        let seen = h._bingpai[p[0]][+p[1] || 5];
        for (const seat of s.seats) {
          seen += seat.discards.filter(x => x.slice(0,2).replace('0','5') === p).length;
          for (const meld of seat.melds) if (meld[0] === p[0]) seen += (meld.slice(1).replace(/0/g,'5').match(new RegExp(p[1], 'g')) || []).length;
        }
        effective += Math.max(0, 4 - seen);
      }
      return { a, score: shanten * 100 - effective };
    });
    scored.sort((a, b) => a.score - b.score); return scored[0].a;
  }
  return actions.find(x => x.action === 'pass') || actions[0];
}

export function builtinTask(task) {
  if (task.mode === 'check') return { text: '连接正常' };
  if (task.mode === 'decision') return choose(task.context);
  if (task.role !== 'coach') return { text: '我在看牌。今天也一起慢慢打吧。接入模型 API 后，我可以自由聊天。' };
  const choice = choose(task.context);
  const hand = Majiang.Shoupai.fromString(task.context.state.seats[task.seat].handString || '');
  return { text: choice?.action === 'declare_win' ? '当前可以和牌。' : choice?.action === 'discard' || choice?.action === 'riichi'
    ? `建议${choice.action === 'riichi' ? '立直并' : ''}打出 ${choice.value}。当前向听数为 ${Majiang.Util.xiangting(hand)}；这个建议按向听数与有效进张选择。`
    : '当前没有需要选择的弃牌。可以等待下一次摸牌。' };
}
