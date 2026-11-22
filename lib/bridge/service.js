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
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { latestOpenQQAsset, downloadTo, unzipTo, flattenSingleRoot, readOpenQQHome, isOpenQQInstalled } from './openqq.js';

const DEFAULT_ROOT = path.join(os.homedir(), 'qq-bridge-own');
// 插件自带的桥接（scripts/vendor-bridge.mjs 复制进来）
const EMBEDDED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bridge');
// 桥接运行必需的依赖；缺了就拉不起来
const BRIDGE_DEPS = ['ws', 'js-yaml', 'zod', '@modelcontextprotocol/sdk'];
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

function resolveBridgeRoot({ bridgeRoot = '', embedded = false } = {}) {
  if (bridgeRoot) return path.resolve(bridgeRoot);
  if (embedded) return EMBEDDED_ROOT;
  if (fs.existsSync(path.join(DEFAULT_ROOT, 'src', 'bridge.js'))) return DEFAULT_ROOT;
  return EMBEDDED_ROOT;
}

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
    const fallback = cfg?.consolePort ? `http://127.0.0.1:${cfg.consolePort}` : `http://127.0.0.1:${DEFAULT_PORT}`;
    const base = String(cfg?.bridge?.consoleBase ?? fallback);
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

  get embedded() {
    return this.root === EMBEDDED_ROOT;
  }

  // 首次运行时用 config.example.json 生成 config.json：随机口令、默认工作区、默认预设。
  // 老用户指向 ~/qq-bridge-own 时配置已存在，这里什么都不做。
  ensureConfig() {
    if (fs.existsSync(this.configPath)) return { created: false, file: this.configPath };
    const example = path.join(this.root, 'config.example.json');
    let cfg = {};
    if (fs.existsSync(example)) {
      try {
        cfg = JSON.parse(fs.readFileSync(example, 'utf8'));
      } catch (error) {
        this.log('[shoreline] config.example.json 解析失败：', error?.message ?? error);
      }
    }
    cfg.consolePort = Number(cfg.consolePort) || DEFAULT_PORT;
    cfg.bridge = {
      consoleBase: `http://127.0.0.1:${cfg.consolePort}`,
      ...(cfg.bridge ?? {}),
    };
    cfg.consoleToken = String(cfg.consoleToken || '') || crypto.randomBytes(16).toString('hex');
    cfg.sessionCwd = String(cfg.sessionCwd || '') || path.join(os.homedir(), '.dsh', 'qq-chat-work');
    cfg.agentPreset = String(cfg.agentPreset || '') || 'qq-chat-v2';
    cfg.snowluma = {
      wsUrl: DEFAULT_SNOWLUMA_WS,
      httpUrl: DEFAULT_SNOWLUMA_HTTP,
      ...(cfg.snowluma ?? {}),
    };
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
    this.log(`[shoreline] 已生成桥接配置 ${this.configPath}`);
    return { created: true, file: this.configPath, token: cfg.consoleToken };
  }

  missingDeps() {
    const nodeModules = path.join(this.root, 'node_modules');
    return BRIDGE_DEPS.filter((name) => !fs.existsSync(path.join(nodeModules, name)));
  }

  // 内置桥接没有自己的 node_modules 时，链接到旧安装的 node_modules（Windows junction，零拷贝）。
  ensureDeps() {
    const missing = this.missingDeps();
    if (!missing.length) return { ok: true, linked: false, missing };
    const link = path.join(this.root, 'node_modules');
    const legacy = path.join(DEFAULT_ROOT, 'node_modules');
    if (!this.embedded || fs.existsSync(link) || !fs.existsSync(legacy)) {
      return {
        ok: false,
        linked: false,
        missing,
        hint: `桥接依赖缺失（${missing.join('、')}）。先让旧桥接装好依赖，或在本机安装 Node.js 后执行 npm install。`,
      };
    }
    try {
      fs.symlinkSync(legacy, link, 'junction');
      const still = this.missingDeps();
      this.log(`[shoreline] 桥接依赖已链接到 ${legacy}`);
      return { ok: still.length === 0, linked: true, missing: still };
    } catch (error) {
      return { ok: false, linked: false, missing, hint: `创建依赖链接失败：${error?.message ?? error}` };
    }
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

  // QQ 空间：面板与桥接内置的 /api/socialV2/qzone 之间的一层。
  // 用控制台令牌直接调（管理端全权），QQ 号取 config.json 的 ownerQQ。
  qzoneKey() {
    const cfg = this.readConfig();
    const ownerQQ = String(cfg.ownerQQ ?? cfg.bridge?.ownerQQ ?? '').trim();
    if (!ownerQQ) throw new Error('config.json 里没有 ownerQQ，确定不了用哪个 QQ 号的空间');
    return `private:${ownerQQ}`;
  }

  async qzone(tool, payload = {}) {
    const key = payload.key || this.qzoneKey();
    const { key: _ignored, ...rest } = payload;
    const res = await this.callConsole('/api/socialV2/qzone', {
      method: 'POST',
      body: { key, tool, ...rest },
      timeoutMs: 60000,
    });
    if (!res.ok || res.data?.ok === false) {
      const message = res.data?.error || res.error || `桥接返回 HTTP ${res.status}`;
      throw new Error(`QQ 空间操作失败：${message}`);
    }
    return res.data;
  }

  async qzoneState() {
    return this.qzone('state');
  }

  async qzonePublish({ content, visibility, images = [], dryRun = false } = {}) {
    return this.qzone('publish', { content, visibility, images, dryRun });
  }

  async qzoneProfile({ nickname, signature, sex, dryRun = false } = {}) {
    return this.qzone('profile', { nickname, signature, sex, dryRun });
  }

  async qzoneAvatar({ image, dryRun = false } = {}) {
    return this.qzone('avatar', { image, dryRun });
  }

  async qzoneSettings(patch = {}) {
    return this.qzone('settings', { settings: patch });
  }

  async status() {
    try {
      this.ensureConfig();
    } catch (error) {
      this.log('[shoreline] 生成桥接配置失败：', error?.message ?? error);
    }
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

  // —— 网关：SnowLuma / OpenQQ（两者都是 OneBot v11）——

  /** OpenQQ 的落地目录：配置里填了用它，否则 ~/OpenQQ。 */
  openQQHome() {
    try {
      const cfg = this.readConfig();
      const configured = String(cfg?.gateway?.openqqHome ?? '').trim();
      if (configured) return configured;
    } catch {
      /* 配置读不了就走默认 */
    }
    return path.join(os.homedir(), 'OpenQQ');
  }

  /** 两个网关各自「装没装、跑没跑」，以及当前配置选的是哪个。 */
  async gatewayStatus() {
    let cfg = null;
    try { cfg = this.readConfig(); } catch { cfg = null; }
    const gw = cfg?.gateway ?? {};
    const kind = ['auto', 'snowluma', 'openqq'].includes(gw.kind) ? gw.kind : 'auto';
    const home = this.openQQHome();

    let sl = null;
    let slRunning = false;
    try {
      sl = this.snowLumaInfo();
      slRunning = await this.probe(sl.host, sl.port, 900);
    } catch (error) {
      sl = { error: error?.message ?? String(error) };
    }

    const installed = isOpenQQInstalled(home);
    const conf = installed ? readOpenQQHome(home) : null;
    const oqRunning = installed && conf ? await this.probe('127.0.0.1', conf.wsPort, 900) : false;
    const webUp = installed ? await this.probe('127.0.0.1', conf?.webPort ?? 17860, 600) : false;

    // 实际会用哪个：显式指定优先；auto 时先看 SnowLuma 端口，再退 OpenQQ
    let active = null;
    if (kind === 'snowluma') active = slRunning ? 'snowluma' : null;
    else if (kind === 'openqq') active = oqRunning ? 'openqq' : null;
    else active = slRunning ? 'snowluma' : (oqRunning ? 'openqq' : null);

    return {
      ok: true,
      kind,
      home,
      active,
      snowluma: sl ? {
        connected: slRunning,
        wsUrl: sl.wsUrl,
        httpUrl: sl.httpUrl,
        webuiUrl: sl.webuiUrl,
        launcherExists: fs.existsSync(sl.launcherPath ?? ''),
      } : { connected: false, error: sl?.error ?? '读不到 SnowLuma 配置' },
      openqq: {
        installed,
        home,
        running: oqRunning,
        webuiRunning: webUp,
        webuiUrl: `http://127.0.0.1:${conf?.webPort ?? 17860}/`,
        config: conf,
      },
      hint: active ? '' : '两个网关都没在跑：先用已有网关登录，或点「安装 OpenQQ」。',
    };
  }

  /** 只改 gateway 段，其它配置原样保留；改完要重启桥接才生效。 */
  saveGateway(patch = {}) {
    const cfg = this.readConfig();
    const next = { ...cfg };
    const gw = { ...(cfg.gateway ?? {}) };
    if (['auto', 'snowluma', 'openqq'].includes(patch.kind)) gw.kind = patch.kind;
    if (typeof patch.openqqHome === 'string') gw.openqqHome = patch.openqqHome.trim();
    next.gateway = gw;
    try {
      const bak = `${this.configPath}.bak-before-gateway-${Date.now()}`;
      fs.copyFileSync(this.configPath, bak);
    } catch {
      /* 备份失败不挡保存 */
    }
    fs.writeFileSync(this.configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { ok: true, gateway: gw, requiresRestart: true };
  }

  /** 下载并解压最新 OpenQQ 到目标目录（已装则跳过）。 */
  async installOpenQQ({ home = '' } = {}) {
    const target = String(home ?? '').trim() || this.openQQHome();
    if (isOpenQQInstalled(target)) {
      return { ok: true, already: true, home: target, hint: '这个目录里已经有 OpenQQ 了，没有重复下载。' };
    }
    const asset = await latestOpenQQAsset();
    const zip = path.join(os.tmpdir(), `openqq-${Date.now()}.zip`);
    const bytes = await downloadTo(asset.url, zip);
    fs.mkdirSync(target, { recursive: true });
    const files = unzipTo(zip, target);
    flattenSingleRoot(target);
    try { fs.unlinkSync(zip); } catch { /* 临时文件删不掉无所谓 */ }
    this.log(`OpenQQ ${asset.tag || ''} 已解压到 ${target}（${files} 个文件，${(bytes / 1024 / 1024).toFixed(1)}MB）`);
    return { ok: true, home: target, tag: asset.tag, bytes, files };
  }

  /** 用 DSH 自带的 node 起 OpenQQ（首次会在浏览器里打开配置向导）。 */
  async startOpenQQ() {
    const home = this.openQQHome();
    if (!isOpenQQInstalled(home)) return { ok: false, error: `没找到 OpenQQ：${home}（先点「安装 OpenQQ」）` };
    const conf = readOpenQQHome(home);
    const webPort = conf?.webPort ?? 17860;
    if (await this.probe('127.0.0.1', webPort, 700)) {
      return { ok: true, already: true, home, webuiUrl: `http://127.0.0.1:${webPort}/` };
    }
    const node = this.resolveNode();
    const child = spawn(node, ['src/main.mjs', 'start'], {
      cwd: home,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    this.log(`OpenQQ 已启动：${node} ${home}\\src\\main.mjs start`);
    const ok = await this.waitFor(() => this.probe('127.0.0.1', webPort, 600), 25000);
    return {
      ok,
      home,
      webuiUrl: `http://127.0.0.1:${webPort}/`,
      hint: ok ? '浏览器里会打开配置向导；扫码登录后 OneBot 才会开始工作。'
        : '25 秒内没等到 OpenQQ 的 WebUI 端口；首次启动可能卡在配置向导，去看它的控制台。',
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

  /**
   * 会话映射：优先问桥接（带 QQ 号/群名/工作区，能区分私聊与群），
   * 桥接没起或没口令时退回读 state/sessions.json，至少还能显示 key -> sessionId。
   */
  async readSessions() {
    const file = path.join(this.stateDir, 'sessions.json');
    try {
      const data = await this.callConsole('/api/socialV2/sessions', { timeoutMs: 2500 });
      if (data?.ok && Array.isArray(data.sessions)) {
        return { ok: true, file, cwd: data.cwd ?? '', sessions: data.sessions, source: 'bridge' };
      }
    } catch {
      /* 走本地文件 */
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = Object.entries(parsed?.sessions ?? {}).map(([key, sessionId]) => {
        const match = /^(private|group):(\d+)$/.exec(key);
        return {
          key,
          sessionId,
          kind: match ? match[1] : 'other',
          id: match ? match[2] : '',
          name: '',
          policy: parsed?.sessionPolicies?.[key] ?? null,
          active: false,
          dormant: false,
        };
      });
      return { ok: true, file, cwd: '', sessions: rows, source: 'file' };
    } catch (error) {
      return { ok: false, file, cwd: '', sessions: [], error: String(error?.message ?? error) };
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
    const deps = this.ensureDeps();
    if (!deps.ok) {
      return { ok: false, error: deps.hint ?? '桥接依赖缺失', deps };
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

export { DEFAULT_ROOT, EMBEDDED_ROOT, LOG_FILES, resolveBridgeRoot };
