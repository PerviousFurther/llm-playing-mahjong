// Coordinates on the felt: x runs left/right, z runs toward the local player.
export const tileSize = { width: .34, length: .48, depth: .2, gap: .365 };
const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export function handAction(state, index, riichiMode = false) {
  const seat = state.seats[0];
  if (state.replay || state.paused || seat.type !== 'human') return null;
  const code = seat.hand[index];
  const value = code + (index === seat.hand.length - 1 && seat.drawn?.length === 2 ? '_' : '');
  const action = riichiMode ? 'riichi' : 'discard';
  return state.legalActions.find(a => a.action === action && a.value === value)
    || state.legalActions.find(a => a.action === action && a.value === code) || null;
}

export function tableTiles(state, riichiMode = false) {
  const tiles = [];
  const add = (seat, key, code, x, z, extra = {}) => {
    const angle = angles[seat], scale = extra.scale || 1;
    tiles.push({ key: `${state.matchHand}:${seat}:${key}`, code, x: x * Math.cos(angle) + z * Math.sin(angle),
      z: -x * Math.sin(angle) + z * Math.cos(angle), angle: angle + (extra.sideways ? Math.PI / 2 : 0), scale, ...extra });
  };
  for (const seat of state.seats) {
    const local = seat.id === 0;
    const hand = !state.started ? Array(13).fill('_') : local || seat.revealed ? seat.hand : Array(seat.handCount || 0).fill('_');
    const scale = local ? 1.2 : 1;
    const gap = tileSize.gap * scale;
    const z = seat.id % 2 ? 5.25 : 3.45;
    const melds = seat.melds.map(meld => {
      const parts = meld.slice(1).match(/\d[+=-]?/g) || [];
      const called = parts.findIndex(p => p.length > 1);
      return { meld, parts, called, added: parts.length === 4 && called >= 0 && called < 3 };
    });
    const meldWidth = melds.reduce((sum, { parts, added }) => sum + parts.reduce((width, part, index) =>
      width + (added && index === 3 ? 0 : (part.length > 1 ? tileSize.length : tileSize.width) + .025), 0) + .16, 0);
    const start = -((hand.length - 1) * gap + meldWidth) / 2;
    const occurrences = {};
    hand.forEach((code, index) => {
      const drawn = index === hand.length - 1 && seat.drawn?.length === 2;
      const key = `hand:${code}:${drawn ? 'drawn' : occurrences[code] = (occurrences[code] || 0) + 1}`;
      add(seat.id, key, code, start + index * gap + (drawn ? .12 : 0), z,
        { scale, handIndex: local ? index : undefined, action: local ? handAction(state, index, riichiMode) : null, kind: 'hand' });
    });
    let cursor = start + hand.length * gap + .12;
    melds.forEach(({ meld, parts, called, added }, meldIndex) => {
      let calledX = cursor;
      parts.forEach((part, index) => {
        const stacked = added && index === 3;
        const sideways = part.length > 1 || stacked;
        const concealed = called < 0 && parts.length === 4 && (index === 0 || index === 3);
        const width = sideways ? tileSize.length : tileSize.width;
        const x = stacked ? calledX : cursor + width / 2;
        if (index === called) calledX = x;
        add(seat.id, `meld:${meldIndex}:${index}`, concealed ? '_' : meld[0] + part[0], x, z,
          { sideways, y: stacked ? tileSize.depth + .015 : 0, kind: 'meld' });
        if (!stacked) cursor += width + .025;
      });
      cursor += .16;
    });
    const columns = seat.id % 2 ? 6 : 10;
    let row = 0, column = 0, cursorX = -columns * tileSize.gap / 2;
    seat.discards.forEach((code, index) => {
      const sideways = code.includes('*');
      const width = sideways ? tileSize.length : tileSize.width;
      add(seat.id, `discard:${index}`, code.slice(0, 2), cursorX + width / 2, 1.6 + row * .53,
        { sideways, kind: 'discard' });
      cursorX += width + .025;
      if (++column === columns) { row++; column = 0; cursorX = -columns * tileSize.gap / 2; }
    });
  }
  (state.dora.length ? state.dora : ['_']).forEach((code, index) => tiles.push({
    key: `dora:${index}`, code, x: 3.5 + index * .37, z: -2.95, angle: 0, scale: 1, kind: 'dora', action: null,
  }));
  return tiles;
}
