import React from 'react';
import { tileName, tileFile } from '../shared/tiles.js';
export { tileName } from '../shared/tiles.js';

// Flat tile illustrations remain useful in the rulebook and result panels.
export function Tile({ code = '_', small = false }) {
  return <span className={`tile ${small ? 'small' : ''}`} title={tileName(code)}><img src={`/tiles/Regular/${tileFile(code)}.svg`} alt={tileName(code)} draggable="false" /></span>;
}
export function parseHand(value = '') {
  return (value.split(',')[0].match(/[mpsz]\d+/g) || []).flatMap(group => [...group.slice(1)].map(n => group[0] + n));
}
