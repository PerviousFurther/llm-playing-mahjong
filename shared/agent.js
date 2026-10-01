import { readableTiles } from './tiles.js';

export const expressions = ['hello', 'laugh', 'unhappy'];
export const expressionAliases = { happy: 'laugh', surprised: 'hello', embarrassed: 'unhappy' };
export const taskExpressions = task => task.context.state.expressionOptions || expressions;
export function bubblePages(value) {
  const sentences = String(value || '').match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) || [];
  return sentences.flatMap(sentence => {
    const parts = [];
    for (let i = 0; i < sentence.length; i += 34) parts.push(sentence.slice(i, i + 34).trim());
    return parts.filter(Boolean);
  });
}
export const bubbleDuration = text => Math.min(30000, Math.max(6500, bubblePages(text).length * 3000));
export const replyTarget = task => task.role === 'coach' ? 'coach' : task.replyTo === undefined ? 'public' : `seat:${task.replyTo}`;

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export function shortReply(value) {
  if (typeof value !== 'string') return '';
  let emojiSeen = false;
  return [...segmenter.segment(readableTiles(value).trim().slice(0, 120))].map(({ segment }) => {
    if (!/\p{Extended_Pictographic}/u.test(segment)) return segment;
    if (emojiSeen) return '';
    emojiSeen = true;
    return segment;
  }).join('');
}
