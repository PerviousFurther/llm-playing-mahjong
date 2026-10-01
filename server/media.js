import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expressionAliases } from '../shared/agent.js';

export function assetCatalog(root) {
  const catalog = {};
  for (const directory of readdirSync(resolve(root, 'asset'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    try {
      const metadata = JSON.parse(readFileSync(resolve(root, 'asset', directory.name, 'metadata.json'), 'utf8'));
      const prefix = `/asset/${encodeURIComponent(directory.name)}/`;
      const avatar = metadata.avatar || metadata['avatar-path'];
      const files = readdirSync(resolve(root, 'asset', directory.name));
      const images = Object.fromEntries(files.filter(file => file.endsWith('.png') && file !== avatar && !/avatar|background/.test(file)).flatMap(file => {
        const name = file.slice(0, -4).replace(/^gpt-/, '');
        return /^[a-z][a-z0-9_-]*$/.test(name) ? [[expressionAliases[name] || name, prefix + encodeURIComponent(file)]] : [];
      }));
      catalog[directory.name] = { ...metadata, images, avatar: typeof avatar === 'string' ? (avatar.startsWith('/asset/') ? avatar : prefix + avatar.replace(/^\.\//, '')) : '' };
    } catch { /* Assets without metadata still render with their original direction. */ }
  }
  return catalog;
}

export function mediaView(media, catalog) {
  return { ...media, assetMetadata: catalog };
}
