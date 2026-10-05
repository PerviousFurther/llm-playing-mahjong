import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Room } from './room.js';
import { Agents } from './agents.js';
import { assetCatalog, characterImages } from './media.js';
import { storagePaths } from './storage.js';
import { expressions } from '../shared/agent.js';
import { replayRecord, playableReplay } from './replay.js';
import { validateRules } from '../shared/rules.js';

const root = resolve(import.meta.dirname, '..');
const dataDir = storagePaths(root).data; mkdirSync(resolve(dataDir, 'uploads'), { recursive: true });
const replayDir = resolve(dataDir, 'replays'); mkdirSync(replayDir, { recursive: true });
const readJson = (name, fallback) => { try { return JSON.parse(readFileSync(resolve(dataDir, name), 'utf8')); } catch { return fallback; } };
function saveJson(name, value) { const p = resolve(dataDir, name); writeFileSync(p + '.tmp', JSON.stringify(value)); renameSync(p + '.tmp', p); }
function archiveCompletedMatch(room) {
  if (!room.matchOver || room.aborted || !room.game?._paipu?.defen) return;
  room.replayId ||= randomUUID();
  room.completedAt ||= new Date().toISOString();
  saveJson(`replays/${room.replayId}.json`, { ...replayRecord(room), savedAt: room.completedAt });
}
const app = express(), server = createServer(app), wss = new WebSocketServer({ noServer: true });
const session = randomBytes(32).toString('hex');
const port = Number(process.env.PORT || 3000);
let agents, saveTimer;
const catalog = assetCatalog(root);
const expressionOptions = [...new Set([...expressions, ...Object.values(catalog).flatMap(asset => Object.keys(asset.images))])].filter(name => !['idle', 'thinking'].includes(name));
let media = readJson('media.json', { background: '', characters: { 1: { ...catalog.gpt?.images }, 2: { ...catalog['gpt-mint']?.images } }, coach: catalog.gpt?.images.idle || '' });
media.characters[2] ||= { ...catalog['gpt-mint']?.images };
for (const [seat, images] of Object.entries(media.characters)) media.characters[seat] = characterImages(images, catalog, root);
if (media.coach === '/asset/gpt/gpt-idle.png') media.coach = catalog.gpt?.images.idle || '';
function requireLobby() { if (room.game && !room.matchOver) throw new Error('请在对局结束后更改玩家和房规'); }
const room = new Room({ expressionOptions, onChange: () => broadcast(), onDecision: (id, context) => agents?.decision(id, context),
  onPhase: type => agents?.notifyPhase(type),
  onCoach: context => agents?.proactiveCoach(context), persist: current => {
  if (!current.replayId) archiveCompletedMatch(current);
  clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    archiveCompletedMatch(current); saveJson('game.json', current.serialize());
  }, 120);
} });
const saved = readJson('game.json', null);
if (saved) { try { room.restore(saved); } catch (error) { console.error('存档恢复失败:', error.message); } }
archiveCompletedMatch(room);
if (room.replayId) saveJson('game.json', room.serialize());
agents = new Agents(room, readJson('profiles.json', {}));
const safeEqual = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function isOwner(req) { return safeEqual((req.headers.cookie || '').split('; ').find(c => c.startsWith('mahjong_session='))?.split('=')[1] || '', session); }
function originAllowed(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false;
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
}
app.use(express.json({ limit: '14mb' }));
app.get('/api/session', (req, res) => {
  if (!originAllowed(req)) return res.status(403).json({ error: '仅允许本机同源访问' });
  res.cookie('mahjong_session', session, { httpOnly: true, sameSite: 'strict' }); res.json({ ready: true });
});
app.use('/api', (req, res, next) => {
  if (!isOwner(req) || !originAllowed(req)) return res.status(403).json({ error: '需要本机管理员会话' });
  next();
});
function ownerView() { return { ...room.snapshot(0), replayId: room.replayId, observerPrivateEvents: room.allPrivateEvents(), agentStatus: agents.status, modelServices: agents.publicModelServices(), profiles: agents.publicProfiles(), media: { ...media, assetMetadata: catalog } }; }
function broadcast() {
  if (!agents) return;
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: ownerView() }));
}
app.get('/api/state', (req, res) => res.json(ownerView()));
app.post('/api/start', (req, res) => {
  requireLobby();
  // Validate before replacing the current room.
  const rules = validateRules(req.body.rules);
  archiveCompletedMatch(room);
  agents.close(); room.start(rules); res.json(ownerView());
});
app.post('/api/terminate', (req, res) => { if (!room.game || room.matchOver) throw new Error('当前没有进行中的对局'); agents.close(); room.terminate(); res.json(ownerView()); });
app.post('/api/action', (req, res) => res.json(room.action(0, req.body)));
app.post('/api/pause', (req, res) => { if (req.body.paused) agents.syncVersion(true); room.setPaused(req.body.paused); res.json({ paused: room.paused }); });
app.post('/api/seats', (req, res) => {
  requireLobby();
  const { seat, type } = req.body;
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !['human', 'bot', 'llm'].includes(type)) throw new Error('座位类型无效');
  if (seat !== 0 && type === 'human') throw new Error('当前人类界面只控制座位 0');
  agents.reset(`player:${seat}`); if (seat === 0) agents.reset('coach:0'); room.seats[seat].type = type; room.changed(); room.dispatch(); res.json({ accepted: true });
});
app.post('/api/profile', (req, res) => { agents.configure(req.body.seat, req.body.role, req.body.config); saveJson('profiles.json', agents.profiles); res.json(agents.publicProfiles()); });
app.post('/api/retry', (req, res) => { agents.retry(req.body.seat, req.body.role); res.json({ accepted: true }); });
app.post('/api/profile/check', (req, res) => { agents.check(req.body.seat, req.body.role); res.json({ accepted: true }); });
app.post('/api/model-service/stop', async (req, res) => { await agents.stopModelService(req.body.seat, req.body.role); res.json({ accepted: true }); });
app.post('/api/chat', (req, res) => {
  const { text, target = 'public', recipient } = req.body;
  if (target === 'coach' && room.seats[0].type !== 'human') throw new Error('由我游玩时才能使用教练');
  const id = target.startsWith('seat:') ? Number(target.slice(-1)) : recipient;
  if (target !== 'coach' && !(target === 'public' && recipient === undefined) && (!Number.isInteger(id) || id < 0 || id > 3)) throw new Error('聊天对象无效');
  room.chat(0, text, target);
  if (target === 'coach') agents.task(0, 'coach', 'chat', room.context(0, 'coach'), text);
  else {
    const recipients = target === 'public' && recipient === undefined ? room.seats.filter(s => s.id !== 0).map(s => s.id) : [id];
    for (const seat of recipients) {
      if (room.seats[seat].type !== 'human') agents.task(seat, 'player', 'chat', room.context(seat), text, target === 'public' ? undefined : 0);
    }
  }
  res.json({ accepted: true });
});
app.get('/api/replay', (req, res) => {
  if (!room.replayId) return res.status(400).json({ error: '对战结束后才能导出历史回放' });
  archiveCompletedMatch(room);
  res.json(playableReplay(readJson(`replays/${room.replayId}.json`, null)));
});
app.get('/api/replays', (req, res) => {
  const records = readdirSync(replayDir).filter(name => /^[\da-f-]+\.json$/.test(name)).flatMap(name => {
    const record = readJson(`replays/${name}`, null);
    return record ? [{ id: name.slice(0, -5), savedAt: record.savedAt, players: record.paipu?.player || [], hands: record.paipu?.log?.length || 0 }] : [];
  });
  res.json(records.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '')));
});
app.get('/api/replays/:id', (req, res) => {
  if (!/^[\da-f-]{36}$/.test(req.params.id)) return res.status(400).json({ error: '回放编号无效' });
  if (req.params.id === room.replayId) archiveCompletedMatch(room);
  const record = readJson(`replays/${req.params.id}.json`, null);
  if (!record) return res.status(404).json({ error: '回放不存在' });
  res.json(playableReplay(record));
});
app.post('/api/media/select', (req, res) => {
  const { seat, asset } = req.body;
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || !Object.hasOwn(catalog, asset) || !catalog[asset].images.idle) throw new Error('角色素材无效');
  media.characters[seat] = { ...catalog[asset].images };
  saveJson('media.json', media); broadcast(); res.json(media);
});
app.post('/api/media', (req, res) => {
  const { kind, seat = 0, expression = 'idle', base64 } = req.body;
  if (!['background', 'character', 'coach'].includes(kind) || !Number.isInteger(seat) || seat < 0 || seat > 3 || !['idle', 'thinking', ...expressionOptions].includes(expression)) throw new Error('素材目标无效');
  if (typeof base64 !== 'string') throw new Error('需要 PNG 文件');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('需要小于 10 MB 的 PNG 文件');
  const name = randomUUID() + '.png'; writeFileSync(resolve(dataDir, 'uploads', name), bytes);
  const url = '/uploads/' + name;
  if (kind === 'background') media.background = url;
  else if (kind === 'coach') media.coach = url;
  else { media.characters[seat] ||= {}; media.characters[seat][expression] = url; }
  saveJson('media.json', media); broadcast(); res.json(media);
});
app.post('/api/media/reset', (req, res) => { media.background = ''; saveJson('media.json', media); broadcast(); res.json(media); });
app.use('/asset', express.static(resolve(root, 'asset')));
app.use('/uploads', express.static(resolve(dataDir, 'uploads')));
app.use(express.static(resolve(root, 'public')));
if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve(root, 'dist/index.html')));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root, server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/data/**'] } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error, req, res, next) => { if (!res.headersSent) res.status(400).json({ error: error.message }); else next(error); });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/live') return; // Vite owns its HMR upgrade route.
  if (!originAllowed(req) || !isOwner(req)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.send(JSON.stringify({ type: 'state', state: ownerView() }));
  });
});
server.listen(port, '127.0.0.1', () => console.log(`雀伴已启动：http://localhost:${port}${saved ? '（存档已加载，点击继续）' : ''}`));
async function shutdown() { clearTimeout(saveTimer); archiveCompletedMatch(room); saveJson('game.json', room.serialize()); await agents.close({ models: true }); server.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
