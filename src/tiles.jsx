import React from 'react';
import { tileName } from '../shared/tiles.js';
export { tileName } from '../shared/tiles.js';

const honors = ['Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun'];
export function tileFile(code) {
  if (!code || code === '_') return 'Back';
  const [s, n] = code;
  if (s === 'z') return honors[Number(n) - 1];
  return `${{ m: 'Man', p: 'Pin', s: 'Sou' }[s]}${n === '0' ? '5-Dora' : n}`;
}
export function Tile({ code = '_', small = false, selected = false, sideways = false, drawn = false, onClick, onHover, disabled = false }) {
  const classes = `tile ${small ? 'small' : ''} ${selected ? 'selected' : ''} ${sideways ? 'sideways' : ''} ${drawn ? 'drawn' : ''}`;
  const pic = <><span className="tile-edge tile-edge-top" aria-hidden="true" /><span className="tile-edge tile-edge-right" aria-hidden="true" /><span className="tile-edge tile-edge-bottom" aria-hidden="true" /><span className="tile-edge tile-edge-left" aria-hidden="true" /><img src={`/tiles/Regular/${tileFile(code)}.svg`} alt={tileName(code)} draggable="false" /></>;
  return onClick ? <button className={classes} title={tileName(code)} onClick={onClick} onMouseEnter={() => onHover?.(code)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(code)} onBlur={() => onHover?.(null)} disabled={disabled} aria-pressed={selected}>{pic}</button>
    : <span className={classes} title={tileName(code)}>{pic}</span>;
}
export function parseHand(value = '') {
  return (value.split(',')[0].match(/[mpsz]\d+/g) || []).flatMap(group => [...group.slice(1)].map(n => group[0] + n));
}
export function Melds({ values = [] }) {
  return <div className="melds">{values.map((m, index) => <div className="meld" key={index}>
    {(m.slice(1).match(/\d[+=-]?/g) || []).map((p, i) => <Tile key={i} code={m[0] + p[0]} small sideways={p.length > 1} />)}
  </div>)}</div>;
}
