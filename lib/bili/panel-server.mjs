// 本地面板：http://127.0.0.1:8788
// 只监听回环地址；不登录 B 站，不接收任何 cookie。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, setConfig, readLogs, readHistory, clearHistory, recordCall, recordView } from './store.mjs';
import { frames, shareToTarget, videoInfo } from './bili-extra.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 搬进 Shoreline 之后，客户端页面在包根的 public/ 下。
const PUBLIC = path.join(__dirname, '..', '..', 'public');
const PORT = Number(process.env.BILI_FEED_PANEL_PORT || 8788);
const DATA_DIR = process.env.BILI_FEED_DATA
  || path.join(os.homedir(), '.dsh', 'bili-feed');
// 帧目录跟随面板里的 mediaDir；不填就是 <数据根>/media/frames。
function framesRoot() {
  let custom = '';
  try {
    custom = String(getConfig()?.mediaDir ?? '').trim();
  } catch {}
  return path.join(custom || path.join(DATA_DIR, 'media'), 'frames');
}
const FRAMES_DIR = framesRoot();
const SESSIONS_FILE = process.env.QQ_SESSIONS_FILE
  || path.join(os.homedir(), '.dsh', 'qq-bridge-own', 'state', 'sessions.json');
const SESSIONS_FALLBACKS = [
  path.join(os.homedir(), '.dsh', 'plugins', 'shoreline', 'bridge', 'state', 'sessions.json'),
  'D:/surfcore/state/sessions.json',
];
const WORKSPACES_FILE = process.env.DSH_WORKSPACES_FILE
  || path.join(os.homedir(), '.dsh', 'storages', 'workspace.json');
// 只列这个工作区（桥接把 QQ 会话都建在这里）；环境变量可覆盖。
const QQ_WORKSPACE = (process.env.QQ_CHAT_WORKSPACE
  || path.join(os.homedir(), '.dsh', 'qq-chat-work')).replace(/[\\/]+$/, '').toLowerCase();

function archivedSessionIds() {
  try {
    const raw = JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf8'));
    return new Set(raw?.global?.archivedSessionIds || []);
  } catch {
    return new Set();
  }
}

function readSessionMap() {
  const archived = archivedSessionIds();
  const files = [SESSIONS_FILE, ...SESSIONS_FALLBACKS];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Object.entries(raw.sessions || {})
        .filter(([, sessionId]) => !archived.has(sessionId))
        .map(([key, sessionId]) => ({ key, sessionId }));
    } catch {}
  }
  return [];
}

/** key -> 人能看的名字：私聊 <QQ号> / 群 <群号>。 */
function sessionLabel(key, sessionId) {
  if (key.startsWith('group:')) return `群 ${key.slice(6)}`;
  if (key.startsWith('private:')) return `私聊 ${key.slice(8)}`;
  return key || String(sessionId).replace(/^session-/, '').slice(0, 8);
}

function knownSessions() {
  return readSessionMap();
}

function knownWorkspaces() {
  const map = new Map(readSessionMap().map((s) => [s.sessionId, s.key]));
  try {
    const raw = JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf8'));
    const archived = new Set(raw?.global?.archivedSessionIds || []);
    return Object.entries(raw?.tables?.workspaces || {})
      .map(([id, w]) => ({
        id,
        title: w.title || id.slice(0, 8),
        path: w.path || '',
        sessions: (w.sessionIds || [])
          .filter((sessionId) => !archived.has(sessionId))
          .map((sessionId) => {
            const key = map.get(sessionId) || '';
            return { id: sessionId, key, label: sessionLabel(key, sessionId) };
          }),
      }))
      .filter((w) => w.sessions.length > 0)
      // 只留 QQ 聊天工作区：路径对得上，或者里面装着桥接映射过的 QQ 会话。
      .filter((w) => {
        const p = String(w.path || '').replace(/[\\/]+$/, '').toLowerCase();
        return (p && p === QQ_WORKSPACE) || w.sessions.some((s) => s.key);
      });
  } catch {
    return [];
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file, type = 'text/html; charset=utf-8') {
  try {
    const buf = fs.readFileSync(file);
    res.writeHead(200, { ...CORS, 'content-type': type, 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, CORS); res.end('not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/panel.html')) {
      return serveFile(res, path.join(PUBLIC, 'panel.html'));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, {
        config: getConfig(),
        logs: readLogs(60),
        history: readHistory(60),
        sessions: knownSessions(),
        workspaces: knownWorkspaces(),
        now: new Date().toISOString(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readBody(req);
      return json(res, 200, { ok: true, config: setConfig(body) });
    }
    if (req.method === 'POST' && url.pathname === '/api/history/clear') {
      clearHistory();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/share') {
      const { bvid, target, groupId } = await readBody(req);
      const started = Date.now();
      try {
        if (!bvid) throw new Error('bvid 不能为空');
        const r = await shareToTarget(String(bvid), target === 'group' ? 'group' : 'private', groupId);
        recordView(r.info);
        recordCall({ tool: 'panel_share', args: { bvid, target, groupId }, ms: Date.now() - started, ok: true });
        return json(res, 200, { ok: true, title: r.info.title, text: r.text, target: r.target });
      } catch (e) {
        recordCall({ tool: 'panel_share', args: { bvid }, ms: Date.now() - started, ok: false, error: String(e.message).slice(0, 300) });
        return json(res, 500, { ok: false, error: String(e.message) });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/frames') {
      const { bvid, count } = await readBody(req);
      const started = Date.now();
      try {
        if (!bvid) throw new Error('bvid 不能为空');
        const r = await frames(String(bvid), Number(count) || undefined);
        recordView(r.info);
        recordCall({ tool: 'panel_frames', args: { bvid, count }, ms: Date.now() - started, ok: true });
        const base = path.basename(r.dir);
        return json(res, 200, {
          ok: true,
          title: r.info.title,
          actualDuration: r.actualDuration,
          files: r.files.map((f) => ({ ...f, url: `/frames/${base}/${path.basename(f.path)}` })),
        });
      } catch (e) {
        recordCall({ tool: 'panel_frames', args: { bvid, count }, ms: Date.now() - started, ok: false, error: String(e.message).slice(0, 300) });
        return json(res, 500, { ok: false, error: String(e.message) });
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/frames/')) {
      // 只允许 state/bili-feed/frames 下的 jpg，防目录穿越。
      const rel = decodeURIComponent(url.pathname.slice('/frames/'.length));
      const file = path.resolve(FRAMES_DIR, rel);
      if (!file.startsWith(path.resolve(FRAMES_DIR) + path.sep) || !/\.(jpe?g|png)$/i.test(file)) {
        res.writeHead(403); return res.end('forbidden');
      }
      return serveFile(res, file, /\.png$/i.test(file) ? 'image/png' : 'image/jpeg');
    }
    if (req.method === 'GET' && url.pathname === '/api/video') {
      const bvid = String(url.searchParams.get('bvid') || '');
      const info = await videoInfo(bvid);
      return json(res, 200, info);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bili-feed panel] http://127.0.0.1:${PORT}`);
});
