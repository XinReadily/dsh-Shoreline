// 本地状态：开关、调用日志、刷过的视频。零依赖，所有写入都限制在 dataDir 内。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = process.env.BILI_FEED_DATA
  || path.join(os.homedir(), '.dsh', 'bili-feed');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOG_FILE = path.join(DATA_DIR, 'calls.jsonl');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const DEFAULTS = {
  enabled: true,
  recordHistory: true,
  allowFrames: true,
  allowShare: true,
  maxFrames: 30,
  maxHistory: 300,
  maxLogLines: 500,
  enabledWorkspaces: [],
  // 默认不启用任何会话：在面板的「B站游客」里自己勾选要放行的会话/群。
  enabledSessions: [],
  frameMicro: 10,
  frameShort: 15,
  frameMedium: 20,
  frameLong: 20,
  frameXlong: 20,
  shareGroupId: '',
  shareTarget: 'private',
  // 媒体目录（抽帧、音频）。留空就用 <数据根>/media，面板里可以指到别的盘。
  mediaDir: '',
};

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getConfig() {
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setConfig(patch = {}) {
  ensureDir();
  const next = { ...getConfig(), ...patch };
  // 只接受已知键，避免面板把任意字段写进来。
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) clean[key] = next[key];
  clean.maxFrames = Math.min(Math.max(Number(clean.maxFrames) || 30, 1), 40);
  clean.maxHistory = Math.min(Math.max(Number(clean.maxHistory) || 300, 20), 2000);
  clean.maxLogLines = Math.min(Math.max(Number(clean.maxLogLines) || 500, 20), 5000);
  for (const key of ['enabled', 'recordHistory', 'allowFrames', 'allowShare']) clean[key] = Boolean(clean[key]);
  for (const key of ['frameMicro', 'frameShort', 'frameMedium', 'frameLong', 'frameXlong']) {
    clean[key] = Math.min(Math.max(Number(clean[key]) || DEFAULTS[key], 1), 40);
  }
  if (!Array.isArray(clean.enabledWorkspaces)) clean.enabledWorkspaces = [];
  clean.enabledWorkspaces = clean.enabledWorkspaces
    .map((x) => String(x || '').trim())
    .filter((x) => /^[a-f0-9-]{20,}$/i.test(x));
  if (!Array.isArray(clean.enabledSessions)) clean.enabledSessions = [];
  clean.enabledSessions = clean.enabledSessions
    .map((x) => String(x || '').trim())
    .filter((x) => /^(session-[a-z0-9-]+|(private|group):\d+)$/i.test(x));
  clean.shareGroupId = String(clean.shareGroupId || '').trim();
  clean.shareTarget = clean.shareTarget === 'group' ? 'group' : 'private';
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

function readJsonArray(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function recordCall(entry) {
  ensureDir();
  const rawError = entry.error ? String(entry.error) : '';
  const codeMatch = rawError.match(/(?:HTTP\s*|错误码\s*|code[=: ]*)(-?\d{2,})/i);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry,
    ...(entry.code === undefined && codeMatch ? { code: Number(codeMatch[1]) } : {}),
  });
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
    // 日志太大时保留末尾，避免无限增长。
    const cfg = getConfig();
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length > cfg.maxLogLines) {
      fs.writeFileSync(LOG_FILE, `${lines.slice(-cfg.maxLogLines).join('\n')}\n`, 'utf8');
    }
  } catch {
    // 日志失败不能影响工具本身。
  }
}

export function readLogs(limit = 50) {
  ensureDir();
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.min(Math.max(limit, 1), 500)).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    }).reverse();
  } catch {
    return [];
  }
}

export function readHistory(limit = 30) {
  ensureDir();
  return readJsonArray(HISTORY_FILE)
    .slice(-Math.min(Math.max(limit, 1), 200))
    .reverse();
}

export function recordView(info = {}) {
  const cfg = getConfig();
  if (!cfg.recordHistory || !info.bvid) return;
  ensureDir();
  const list = readJsonArray(HISTORY_FILE);
  const now = new Date().toISOString();
  const existing = list.find((x) => x.bvid === info.bvid);
  const entry = {
    bvid: info.bvid,
    title: info.title || existing?.title || info.bvid,
    author: info.author || existing?.author || '',
    cover: info.cover || existing?.cover || '',
    duration: info.duration ?? existing?.duration ?? 0,
    url: `https://www.bilibili.com/video/${info.bvid}`,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    seenCount: (existing?.seenCount || 0) + 1,
  };
  const next = list.filter((x) => x.bvid !== info.bvid);
  next.push(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(next.slice(-cfg.maxHistory), null, 2), 'utf8');
  return entry;
}

export function clearHistory() {
  ensureDir();
  fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');
}

export { DATA_DIR, CONFIG_FILE, LOG_FILE, HISTORY_FILE };
