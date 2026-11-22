import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_VOICE_DIR = path.join(os.homedir(), '.dsh', 'shoreline');
export const DEFAULT_VOICE_FILE = path.join(DEFAULT_VOICE_DIR, 'voice.json');

// ffmpeg 检查要起子进程，别每次刷新都跑；60 秒内的结果复用。
let ffmpegCache = { at: 0, ok: false };

function ffmpegReady() {
  const now = Date.now();
  if (now - ffmpegCache.at < 60000) return ffmpegCache.ok;
  let ok = false;
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    execFileSync(finder, ['ffmpeg'], { windowsHide: true, stdio: 'ignore', timeout: 4000 });
    ok = true;
  } catch {
    ok = false;
  }
  ffmpegCache = { at: now, ok };
  return ok;
}

export const DEFAULT_VOICE = {
  tts: {
    engine: 'edge',
    // Edge 兜底：不依赖密钥，随时能出声。
    edge: { voice: 'zh-CN-XiaoyiNeural', rate: 0, pitch: 0 },
    // 火山声音复刻。两条路：
    //  · v1 + volcano_icl：只能用 emotion 标签（happy/sad/angry），语速手动调；
    //  · v3 + seed-icl-2.0：能带 instruction（一句心情描述），文字怎么表达交给模型自己判断。
    // 填了 apiKey 或 resourceId 就走 v3，否则退回 v1。
    // 注意：v3 里复刻音色的资源必须是 seed-icl-2.0（字符版，配额 10）；
    // 写成 volc.megatts.voiceclone 会报 quota exceeded for types: concurrency（那是并发版，配额 0）。
    volc: {
      appId: '',
      token: '',
      apiKey: '',
      voiceId: '',
      cluster: 'volcano_icl',
      resourceId: 'seed-icl-2.0',
      speed: 1,
      // -50~100，负数更慢。复刻音色每次都自己决定说多快，慢一点明显更自然。
      // 实测 0 → 31.5KB、-10 → 40.5KB、-20 → 41.7KB，再往下收益递减，所以默认 -10。
      speechRate: -10,
      emotion: 'auto',
      emotionScale: 1,
    },
    // 实测结论：sad 标签对复刻音色无效，慢速更像难过；happy 强度 1 可用。
    policy: {
      happyScale: 1,
      sadUseSlow: true,
      sadSpeed: 0.92,
      tiredSpeed: 0.96,
      angryEmotion: 'angry',
    },
  },
  asr: {
    enabled: true,
    // 留空 = 用默认的 D:\dsh-data\whisper（faster-whisper 便携版）；填了就用填的。
    python: '',
    script: '',
    model: 'small',
    lang: 'zh',
  },
  // 预留：火山 2.0 的上下文与自然语言指令，等 resource 绑定好再接。
  reserved: {
    volc2: false,
    contextTexts: false,
    instruction: false,
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      out[key] = merge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export class VoiceService {
  constructor({ file = DEFAULT_VOICE_FILE } = {}) {
    this.file = file;
    this.data = clone(DEFAULT_VOICE);
    this.loaded = false;
  }

  async init() {
    if (this.loaded) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = merge(clone(DEFAULT_VOICE), raw);
    } catch {
      this.data = clone(DEFAULT_VOICE);
    }
    this.loaded = true;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get() {
    return clone(this.data);
  }

  async save(patch) {
    await this.init();
    this.data = merge(this.data, patch);
    this.persist();
    return this.get();
  }

  /**
   * 只报「配置齐不齐」和「文件在不在」，不真去合成语音——
   * 面板刷新一次就调一次合成太贵。
   */
  status() {
    const tts = this.data.tts || {};
    const volc = tts.volc || {};
    const edge = tts.edge || {};
    const asr = this.data.asr || {};
    const volcReady = Boolean(String(volc.appId || '').trim() && String(volc.token || '').trim() && String(volc.voiceId || '').trim());
    const whisperDir = process.env.SHORELINE_WHISPER_DIR || path.join('D:', 'dsh-data', 'whisper');
    const asrPython = String(asr.python || '').trim()
      || path.join(whisperDir, 'python', process.platform === 'win32' ? 'python.exe' : 'python');
    const asrScript = String(asr.script || '').trim() || path.join(whisperDir, 'transcribe.py');
    const pyOk = (() => {
      try {
        return fs.existsSync(asrPython);
      } catch {
        return false;
      }
    })();
    const scriptOk = (() => {
      try {
        return fs.existsSync(asrScript);
      } catch {
        return false;
      }
    })();
    return {
      engine: tts.engine || 'edge',
      edge: { voice: edge.voice || '', ready: Boolean(edge.voice) },
      volc: {
        appId: volc.appId || '',
        hasToken: Boolean(volc.token),
        hasApiKey: Boolean(volc.apiKey),
        voiceId: volc.voiceId || '',
        cluster: volc.cluster || 'volcano_icl',
        resourceId: volc.resourceId || 'seed-icl-2.0',
        v3: Boolean(String(volc.apiKey || '').trim() || String(volc.resourceId || '').trim()),
        ready: volcReady,
      },
      asr: {
        enabled: asr.enabled !== false,
        model: asr.model || 'small',
        lang: asr.lang || 'zh',
        python: asrPython,
        script: asrScript,
        pythonOk: pyOk,
        scriptOk,
        ffmpegOk: ffmpegReady(),
        ready: pyOk && scriptOk,
      },
      reserved: this.data.reserved || {},
    };
  }
}
