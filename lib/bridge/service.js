// QQ 桥接的接管层（二期）。
//
// 桥接本体是 D:\surfcore\src\bridge.js，一个独立 node 进程，监听 127.0.0.1:3100，
// 用 x-console-token 认证。它不依赖 DSH 插件活着，所以「接管」其实是三件事：
//   1. 读它的状态（GET /api/status）和日志尾巴，摊到面板上；
//   2. 用和 SurfCore 同样的方式把它拉起来 / 停掉；
//   3. 把它跟 DSH 会话的映射关系（state/sessions.json）显示出来。
//
// 刻意没有重写桥接：bridge.js 里是 QQ 协议、二代仿真、目标系统那一整套，重写一遍
// 只会得到一份更差的副本。这里只做「看得见、点得动」的那层。
//
// 一个必须知道的坑：SurfCore 自己也会 autoStart 桥接（platforms.start.qq = true）。
// 两边同时想拉起时，bridge.lock 保证只有一个真的活下来，另一个会自己退出 —— 不会
// 双开，但会有一次无意义的启动失败。彻底解决要在 SurfCore 侧关掉 autoStart，见 README。

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULT_ROOT = path.join(os.homedir(), 'qq-bridge-own');
const DEFAULT_PORT = 3100;
const DEFAULT_SNOWLUMA_HTTP = 'http://127.0.0.1:3000';
const DEFAULT_SNOWLUMA_WS = 'ws://127.0.0.1:3001';
// SnowLuma 的启动脚本按需配置；没配时面板会提示去设置里填路径。
const DEFAULT_LAUNCHER = '';
const LOG_FILES = {
  bridge: 'bridge.log',
  activity: 'qq-activity.log',
  supervisor: 'bridge-supervisor.log',
};

// —— 面板可改字段（和桥接 normalizePurposeConfig / normalizeQqFishGuard 的边界对齐）——

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;

const PANEL_SPEC = {
  purpose: {
    enabled: { kind: 'bool' },
    ownerUin: { kind: 'digits', max: 12 },
    gapMinMs: { kind: 'int', min: 5 * MIN_MS, max: 24 * HOUR_MS },
    gapMaxMs: { kind: 'int', min: 5 * MIN_MS, max: 24 * HOUR_MS },
    initialDelayMinMs: { kind: 'int', min: MIN_MS, max: 12 * HOUR_MS },
    dailyMax: { kind: 'int', min: 0, max: 24 },
    activity: { kind: 'int', min: 0, max: 100 },
    quietStart: { kind: 'clock' },
    quietEnd: { kind: 'clock' },
    idleThresholdMs: { kind: 'int', min: 0, max: 12 * HOUR_MS },
    materialWindowHours: { kind: 'int', min: 1, max: 336 },
    maxMaterials: { kind: 'int', min: 6, max: 80 },
    minMaterials: { kind: 'int', min: 0, max: 20 },
    maxCandidates: { kind: 'int', min: 3, max: 10 },
    retryMs: { kind: 'int', min: MIN_MS, max: 6 * HOUR_MS },
    maxAttempts: { kind: 'int', min: 1, max: 10 },
    promptMaxChars: { kind: 'int', min: 4000, max: 30000 },
  },
  fishGuard: {
    enabled: { kind: 'bool' },
    windowMs: { kind: 'int', min: MIN_MS, max: 24 * HOUR_MS },
    cooldownMs: { kind: 'int', min: MIN_MS, max: 24 * HOUR_MS },
    maxFish: { kind: 'int', min: 2, max: 20 },
    maxConsecutiveFish: { kind: 'int', min: 2, max: 30 },
    singleFishMaxConsecutive: { kind: 'int', min: 2, max: 50 },
    maxFishMessages: { kind: 'int', min: 2, max: 100 },
    maxFishRatio: { kind: 'float', min: 0, max: 1 },
    minSample: { kind: 'int', min: 2, max: 200 },
    minFishSendersForRatio: { kind: 'int', min: 1, max: 20 },
    groupNestMaxFish: { kind: 'int', min: 2, max: 20 },
    groupNestIds: { kind: 'ids' },
    namePrefixes: { kind: 'list' },
    nameContains: { kind: 'list' },
    nameSuffixes: { kind: 'list' },
    groupNameSuffixes: { kind: 'list' },
    exemptNames: { kind: 'list' },
    exemptIds: { kind: 'ids' },
    fishIds: { kind: 'ids' },
    bypassDirectAddress: { kind: 'bool' },
    blockSends: { kind: 'bool' },
  },
};

const PANEL_DEFAULTS = {
  purpose: {
    enabled: true,
    ownerUin: '',
    gapMinMs: 150 * MIN_MS,
    gapMaxMs: 300 * MIN_MS,
    initialDelayMinMs: 30 * MIN_MS,
    dailyMax: 4,
    activity: 50,
    quietStart: '23:30',
    quietEnd: '08:30',
    idleThresholdMs: 30 * MIN_MS,
    materialWindowHours: 72,
    maxMaterials: 36,
    minMaterials: 2,
    maxCandidates: 6,
    retryMs: 15 * MIN_MS,
    maxAttempts: 3,
    promptMaxChars: 16000,
  },
  fishGuard: {
    enabled: true,
    windowMs: 10 * MIN_MS,
    cooldownMs: 10 * MIN_MS,
    maxFish: 5,
    maxConsecutiveFish: 5,
    singleFishMaxConsecutive: 5,
    maxFishMessages: 8,
    maxFishRatio: 0.6,
    minSample: 8,
    minFishSendersForRatio: 2,
    groupNestMaxFish: 3,
    groupNestIds: [],
    namePrefixes: [],
    nameContains: [],
    nameSuffixes: [],
    groupNameSuffixes: [],
    exemptNames: [],
    exemptIds: [],
    fishIds: [],
    bypassDirectAddress: true,
    blockSends: true,
  },
};

function splitList(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,，、]+/);
  return [...new Set(arr.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 200);
}

function cleanIdList(raw) {
  return splitList(raw).filter((x) => /^\d{4,15}$/.test(x));
}

/** 把任意输入按字段边界收一次；非法值返回 fallback。 */
function coercePanelValue(raw, spec, fallback) {
  if (!spec) return raw;
  switch (spec.kind) {
    case 'bool':
      return typeof raw === 'boolean' ? raw : fallback;
    case 'int': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.round(n))) : fallback;
    }
    case 'float': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : fallback;
    }
    case 'clock':
      return typeof raw === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : fallback;
    case 'digits':
      return String(raw ?? '').replace(/\D/g, '').slice(0, spec.max ?? 12);
    case 'ids':
      return cleanIdList(raw);
    case 'list':
      return splitList(raw);
    default:
      return raw;
  }
}

function pickPanelSection(source, defaults, spec) {
  const out = {};
  for (const [key, item] of Object.entries(spec)) {
    out[key] = coercePanelValue(source?.[key], item, defaults[key]);
  }
  return out;
}

function mergePanelSection(current, patch, spec) {
  const next = { ...(current && typeof current === 'object' ? current : {}) };
  for (const [key, item] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = coercePanelValue(patch[key], item, undefined);
    if (value === undefined) continue;
    next[key] = value;
  }
  return next;
}

const NODE_CANDIDATES = [
  path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? '',
    '.dsh',
    'dsh-runtimes',
    'dsh-primary-runtime',
    'dependencies',
    'node',
    'bin',
    'node.exe',
  ),
  'C:\\Program Files\\nodejs\\node.exe',
  'C:\\Program Files (x86)\\nodejs\\node.exe',
];

export class BridgeService {
  constructor({ root = DEFAULT_ROOT, nodeExe = '', dshWebUrl = '', log } = {}) {
    this.root = root;
    this.nodeExe = nodeExe;
    this.dshWebUrl = dshWebUrl;
    this.log = log ?? (() => {});
  }

  get configPath() {
    return path.join(this.root, 'config.json');
  }

  get stateDir() {
    return path.join(this.root, 'state');
  }

  // —— 配置 ——

  readConfig() {
    const raw = fs.readFileSync(this.configPath, 'utf8');
    return JSON.parse(raw);
  }

  consoleInfo() {
    const cfg = this.readConfig();
    const base = String(cfg?.bridge?.consoleBase ?? `http://127.0.0.1:${DEFAULT_PORT}`);
    let url;
    try {
      url = new URL(base);
    } catch {
      url = new URL(`http://127.0.0.1:${DEFAULT_PORT}`);
    }
    return {
      base: url.origin,
      host: url.hostname || '127.0.0.1',
      port: Number(url.port || DEFAULT_PORT),
      token: String(cfg?.consoleToken ?? ''),
      cfg,
    };
  }

  // —— 探活 ——

  probe(host, port, timeoutMs = 700) {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  lockPid() {
    try {
      const raw = fs.readFileSync(path.join(this.stateDir, 'bridge.lock'), 'utf8').trim();
      const pid = Number.parseInt(raw, 10);
      return Number.isFinite(pid) && pid > 0 ? pid : 0;
    } catch {
      return 0;
    }
  }

  async callConsole(pathname, { method = 'GET', body = null, timeoutMs = 5000 } = {}) {
    const info = this.consoleInfo();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(new URL(pathname, info.base), {
        method,
        headers: {
          'x-console-token': info.token,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { ok: res.ok, status: res.status, data };
    } catch (error) {
      return { ok: false, status: 0, error: String(error?.message ?? error) };
    } finally {
      clearTimeout(timer);
    }
  }

  // —— 状态 ——

  async status() {
    let info;
    try {
      info = this.consoleInfo();
    } catch (error) {
      return {
        ok: false,
        running: false,
        root: this.root,
        error: `读不了 ${this.configPath}：${error?.message ?? error}`,
      };
    }

    const listening = await this.probe(info.host, info.port);
    const pid = this.lockPid();
    const base = { ok: true, root: this.root, port: info.port, pid, listening };

    if (!listening) {
      return {
        ...base,
        running: false,
        hint: `桥接没在跑。点「启动」会以 detached 方式拉起 ${this.root}\\src\\bridge.js。`,
      };
    }

    const res = await this.callConsole('/api/status');
    if (!res.ok) {
      return {
        ...base,
        running: true,
        error: res.data?.error ?? res.error ?? `状态接口返回 ${res.status}`,
        hint: '端口在监听但拿不到状态，通常是 consoleToken 对不上：检查 D:\\surfcore\\config.json。',
      };
    }

    const raw = res.data ?? {};
    let purposeEnabled = null;
    try {
      purposeEnabled = this.readConfig()?.purpose?.enabled !== false;
    } catch {
      purposeEnabled = null;
    }
    const activity = typeof raw.activity === 'string' ? raw.activity.split('\n').filter(Boolean).slice(-6) : [];
    return {
      ...base,
      running: true,
      mode: raw.mode ?? null,
      role: raw.role ?? null,
      roleMode: raw.roleMode ?? null,
      dshReady: raw.dshReady === true,
      dshBaseUrl: raw.dshBaseUrl ?? null,
      ownerQQ: raw.ownerQQ ?? null,
      allowGroups: Array.isArray(raw.allowGroups) ? raw.allowGroups : [],
      allowPrivate: Array.isArray(raw.allowPrivate) ? raw.allowPrivate : [],
      socialV2Paused: raw.socialV2Paused === true,
      goalCount: raw.goalCount ?? 0,
      nextFireText: raw.nextFireText ?? null,
      purpose: raw.purpose
        ? {
            enabled: purposeEnabled === null ? raw.purpose.enabled === true : purposeEnabled,
            countToday: raw.purpose.countToday ?? 0,
            dailyMax: raw.purpose.dailyMax ?? 0,
            lastRunAt: raw.purpose.lastRunAt ?? null,
            lastSentAt: raw.purpose.lastSentAt ?? null,
            lastPurpose: raw.purpose.lastPurpose ?? '',
            lastText: raw.purpose.lastText ?? '',
            lastEmotion: raw.purpose.lastEmotion ?? '',
            lastEmotionLabel: raw.purpose.lastEmotionLabel ?? '',
            lastEmotionText: raw.purpose.lastEmotionText ?? '',
            nextFireAt: raw.purpose.nextFireAt ?? null,
            nextFireText: raw.purpose.nextFireText ?? '',
            drives: raw.purpose.drives && typeof raw.purpose.drives === 'object' ? raw.purpose.drives : {},
            topNeeds: Array.isArray(raw.purpose.topNeeds) ? raw.purpose.topNeeds : [],
            goals: Array.isArray(raw.purpose.goals) ? raw.purpose.goals.slice(0, 5) : [],
            goalCount: raw.purpose.goalCount ?? 0,
            candidateCount: raw.purpose.candidateCount ?? 0,
            materialCount: raw.purpose.materialCount ?? 0,
            observationCount: raw.purpose.observationCount ?? 0,
            pending: Array.isArray(raw.purpose.pending) ? raw.purpose.pending : [],
            history: Array.isArray(raw.purpose.history) ? raw.purpose.history.slice(-6) : [],
            lastSkip: raw.purpose.lastSkip ?? null,
          }
        : null,
      activity,
      consoleTokenPresent: info.token.length > 0,
    };
  }

  // —— SnowLuma（OneBot 网关）——

  snowLumaInfo() {
    let cfg = {};
    try {
      cfg = this.readConfig();
    } catch {
      cfg = {};
    }
    const sn = cfg?.snowluma && typeof cfg.snowluma === 'object' ? cfg.snowluma : {};
    const httpUrl = String(sn.httpUrl || DEFAULT_SNOWLUMA_HTTP);
    const wsUrl = String(sn.wsUrl || DEFAULT_SNOWLUMA_WS);
    let parsed;
    try {
      parsed = new URL(httpUrl);
    } catch {
      parsed = new URL(DEFAULT_SNOWLUMA_HTTP);
    }
    const homeDir =
      String(sn.homeDir || '').trim() || path.dirname(String(sn.launcherPath || DEFAULT_LAUNCHER));

    // launcherPath 在 enhanced 的配置里写的是目录（D:\SnowLuma），真正能执行的是
    // launchScript / 目录下的 launcher.bat。三层兜底，别让面板把目录当程序去跑。
    let launcherPath = String(sn.launchScript || '').trim();
    if (!launcherPath) {
      const raw = String(sn.launcherPath || '').trim();
      launcherPath = raw || DEFAULT_LAUNCHER;
      try {
        if (fs.statSync(launcherPath).isDirectory()) {
          const bat = path.join(launcherPath, 'launcher.bat');
          const exe = path.join(launcherPath, 'launcher.exe');
          if (fs.existsSync(bat)) launcherPath = bat;
          else if (fs.existsSync(exe)) launcherPath = exe;
        }
      } catch {
        /* 路径不存在时保持原样，由 start 时报错 */
      }
    }

    // SnowLuma 的扫码登录界面在它自己的 WebUI 上（默认 127.0.0.1:5099），
    // 端口写在 <homeDir>\config\runtime.json 的 webuiPort。
    let webuiHost = '127.0.0.1';
    let webuiPort = 5099;
    try {
      const rt = JSON.parse(fs.readFileSync(path.join(homeDir, 'config', 'runtime.json'), 'utf8'));
      const h = String(rt?.webuiHost || '').trim();
      if (h && h !== '0.0.0.0' && h !== '::') webuiHost = h;
      const p = Number(rt?.webuiPort);
      if (Number.isFinite(p) && p > 0 && p < 65536) webuiPort = p;
    } catch {
      /* 读不到就用默认值，别让面板因为一个可选文件崩掉 */
    }
    const webuiUrl = `http://${webuiHost}:${webuiPort}/`;

    return {
      httpUrl,
      wsUrl,
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
      webuiUrl,
      webuiHost,
      webuiPort,
      launcherPath,
      homeDir,
    };
  }

  async snowLumaStatus() {
    const info = this.snowLumaInfo();
    const running = await this.probe(info.host, info.port, 900);
    return {
      ok: true,
      running,
      port: info.port,
      httpUrl: info.httpUrl,
      wsUrl: info.wsUrl,
      webuiUrl: info.webuiUrl,
      webuiPort: info.webuiPort,
      launcherPath: info.launcherPath,
      launcherExists: fs.existsSync(info.launcherPath),
      hint: running ? '' : `SnowLuma 没在跑。点「启动 SnowLuma」会执行 ${info.launcherPath}。`,
    };
  }

  async startSnowLuma() {
    const info = this.snowLumaInfo();
    if (await this.probe(info.host, info.port, 700)) {
      return { ok: true, already: true, ...(await this.snowLumaStatus()) };
    }
    if (!fs.existsSync(info.launcherPath)) {
      return { ok: false, error: `找不到启动器：${info.launcherPath}` };
    }
    const child = spawn('cmd.exe', ['/c', 'start', '', info.launcherPath], {
      cwd: info.homeDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    this.log(`SnowLuma 启动器已执行：${info.launcherPath}`);
    const ok = await this.waitFor(() => this.probe(info.host, info.port, 600), 25000);
    return {
      ok,
      launcherPath: info.launcherPath,
      error: ok ? undefined : '25 秒内没等到 SnowLuma 的端口，可能还在启动，稍后点「刷新」',
      ...(await this.snowLumaStatus()),
    };
  }

  consoleUrl() {
    const info = this.consoleInfo();
    return {
      ok: true,
      base: info.base,
      port: info.port,
      token: info.token,
      path: info.token ? `/?token=${encodeURIComponent(info.token)}` : '/',
    };
  }

  // —— 面板可改的配置（目的引擎 / 防刷屏）——

  readPanelConfig() {
    const cfg = this.readConfig();
    return {
      ok: true,
      file: this.configPath,
      purpose: pickPanelSection(cfg?.purpose, PANEL_DEFAULTS.purpose, PANEL_SPEC.purpose),
      fishGuard: pickPanelSection(cfg?.fishGuard, PANEL_DEFAULTS.fishGuard, PANEL_SPEC.fishGuard),
    };
  }

  savePanelConfig(patch) {
    const cfg = this.readConfig();
    const next = { ...cfg };

    if (patch?.purpose && typeof patch.purpose === 'object') {
      next.purpose = mergePanelSection(cfg?.purpose, patch.purpose, PANEL_SPEC.purpose);
    }
    if (patch?.fishGuard && typeof patch.fishGuard === 'object') {
      next.fishGuard = mergePanelSection(cfg?.fishGuard, patch.fishGuard, PANEL_SPEC.fishGuard);
    }

    let backup = '';
    try {
      backup = `${this.configPath}.bak-${Date.now()}`;
      fs.copyFileSync(this.configPath, backup);
    } catch {
      backup = '';
    }
    const tmp = `${this.configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.configPath);
    this.log(`面板配置已写回 ${this.configPath}`);
    return {
      ok: true,
      backup,
      ...this.readPanelConfig(),
      restartHint: 'purpose / fishGuard 是启动时读进内存的，改完要重启桥接才生效。',
    };
  }

  // —— 会话映射 ——

  readSessions() {
    const file = path.join(this.stateDir, 'sessions.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        ok: true,
        file,
        sessions: parsed?.sessions ?? {},
        policies: parsed?.sessionPolicies ?? {},
      };
    } catch (error) {
      return { ok: false, file, sessions: {}, policies: {}, error: String(error?.message ?? error) };
    }
  }

  // —— 日志 ——

  readTail(name, lines = 200) {
    const fileName = LOG_FILES[name] ?? LOG_FILES.bridge;
    const file = path.join(this.stateDir, fileName);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return { ok: false, file, lines: [], error: '日志还没生成' };
    }
    const window = Math.min(stat.size, 256 * 1024);
    const buffer = Buffer.alloc(window);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, buffer, 0, window, Math.max(0, stat.size - window));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const text = buffer.toString('utf8');
    const all = text.split(/\r?\n/);
    if (all.length && all[all.length - 1] === '') all.pop();
    return {
      ok: true,
      file,
      name,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      lines: all.slice(-Math.max(1, Math.min(1000, lines))),
    };
  }

  listLogs() {
    return Object.entries(LOG_FILES).map(([name, fileName]) => {
      const file = path.join(this.stateDir, fileName);
      try {
        const stat = fs.statSync(file);
        return { name, file, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      } catch {
        return { name, file, size: 0, modifiedAt: null };
      }
    });
  }

  // —— 启停 ——

  resolveNode() {
    if (this.nodeExe && fs.existsSync(this.nodeExe)) return this.nodeExe;
    if (process.env.SHORELINE_NODE && fs.existsSync(process.env.SHORELINE_NODE)) {
      return process.env.SHORELINE_NODE;
    }
    for (const candidate of NODE_CANDIDATES) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    // DSH 本身跑在 Electron 里，process.execPath 是 DeepSeek.exe，不能拿来跑 node 脚本。
    return '';
  }

  async start() {
    const running = await this.status();
    if (running.running) return { ok: true, already: true, status: running };

    const entry = path.join(this.root, 'src', 'bridge.js');
    if (!fs.existsSync(entry)) {
      return { ok: false, error: `找不到桥接入口：${entry}` };
    }
    const node = this.resolveNode();
    if (!node) {
      return { ok: false, error: '没找到可用的 node.exe，可在插件配置里填 nodeExe' };
    }

    const env = { ...process.env };
    const webUrl = this.dshWebUrl || process.env.DSH_WEB_URL || '';
    if (webUrl) env.DSH_WEB_URL = webUrl;

    const child = spawn(node, [entry], {
      cwd: this.root,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    this.log(`桥接已拉起，pid=${child.pid ?? '?'}，node=${node}`);

    const ok = await this.waitFor(async () => (await this.status()).running, 15000);
    const status = await this.status();
    return {
      ok,
      pid: child.pid ?? 0,
      node,
      error: ok ? undefined : '15 秒内没等到控制台端口监听，请看下方日志',
      status,
    };
  }

  async stop() {
    const info = this.consoleInfo();
    const listening = await this.probe(info.host, info.port);
    const pid = this.lockPid();
    if (!listening && !pid) return { ok: true, already: true };

    if (pid) {
      try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
      } catch (error) {
        this.log('taskkill 失败：', error?.message ?? error);
      }
    }

    const stopped = await this.waitFor(async () => {
      const now = await this.probe(info.host, info.port, 400);
      return !now;
    }, 8000);

    return { ok: stopped, pid, error: stopped ? undefined : '8 秒内端口仍在监听' };
  }

  async restart() {
    const stopped = await this.stop();
    if (!stopped.ok) return { ok: false, stage: 'stop', ...stopped };
    return { ok: true, stage: 'start', ...(await this.start()) };
  }

  async waitFor(check, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await check()) return true;
      } catch {
        /* 再试一次 */
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return false;
  }
}

export { DEFAULT_ROOT, LOG_FILES };
