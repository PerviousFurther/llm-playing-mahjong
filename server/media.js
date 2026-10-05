import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expressionAliases } from '../shared/agent.js';

export function characterImages(images, catalog, root) {
  images = { ...images };
  const group = Object.values(images).find(path => path?.startsWith('/asset/'))?.match(/^\/asset\/([^/]+)\//)?.[1];
  for (const [old, name] of Object.entries(expressionAliases)) {
    if (images[old]) { images[name] ||= images[old]; delete images[old]; }
  }
  for (const [expression, path] of Object.entries(images)) {
    const group = path.match(/^\/asset\/([^/]+)\//)?.[1];
    if (group && !existsSync(resolve(root, '.' + decodeURIComponent(path)))) {
      const asset = catalog[decodeURIComponent(group)];
      const replacement = expression === 'avatar' ? asset?.avatar : asset?.images[expression] || asset?.images.idle;
      if (replacement) images[expression] = replacement;
      else delete images[expression];
    }
  }
  return { ...(group && catalog[decodeURIComponent(group)]?.images), ...images };
}

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
      const fallback = images.hello || images.laugh || Object.values(images)[0];
      if (fallback) images.idle ||= fallback;
      const avatarPath = typeof avatar === 'string' ? (avatar.startsWith('/asset/') ? avatar : prefix + avatar.replace(/^\.\//, '')) : '';
      catalog[directory.name] = { ...metadata, images, avatar: avatarPath && existsSync(resolve(root, '.' + decodeURIComponent(avatarPath))) ? avatarPath : '' };
    } catch { /* Assets without metadata still render with their original direction. */ }
  }
  return catalog;
}
