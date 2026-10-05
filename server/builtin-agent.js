import Majiang from '@kobalab/majiang-core';
import { analyzeActions } from './agent-analysis.js';

function choose(context) {
  const s = context.state, actions = s.legalActions;
  if (s.canWin) return { action: 'declare_win', expression: 'laugh' };
  const other = actions.find(x => x.action === 'riichi') || actions.find(x => x.action === 'continue');
  if (other) return other;
  if (actions.some(a => a.action === 'discard')) {
    const best = analyzeActions(s, 'discard', '', 1).candidates[0];
    return { action: best.action, value: best.value };
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
