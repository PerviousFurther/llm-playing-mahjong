import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

export function storagePaths(root, env = process.env) {
  const original = resolve(root, 'data');
  const data = resolve(root, env.MAHJONG_DATA_DIR || 'data');
  const temp = resolve(root, env.MAHJONG_TEMP_DIR || tmpdir());
  if (data !== original && existsSync(original) && (!existsSync(data) || readdirSync(data).length === 0)) {
    const inside = relative(original, data);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) throw new Error('自定义数据目录不能位于原 data 目录内部');
    cpSync(original, data, { recursive: true, force: false, errorOnExist: true });
  }
  mkdirSync(data, { recursive: true });
  return { data, temp };
}
