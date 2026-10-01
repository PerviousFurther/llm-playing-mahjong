export function tileName(code) {
  if (!code || code === '_') return '暗牌';
  const [s, n] = code;
  return s === 'z' ? ['东', '南', '西', '北', '白', '发', '中'][Number(n) - 1]
    : `${n === '0' ? '赤五' : '一二三四五六七八九'[Number(n) - 1]}${{ m: '万', p: '筒', s: '索' }[s]}`;
}

export function readableTiles(text) {
  return text.replace(/(?<![a-zA-Z0-9])(?:[mps][0-9]|z[1-7])[_*]?(?![a-zA-Z0-9])/g, tileName);
}
