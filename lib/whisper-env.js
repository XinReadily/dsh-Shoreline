// 一键安装 B 站视频声音转写（faster-whisper）环境。
//
// 复用 ~/.dsh/shoreline/python 那份嵌入式 Python（Edge 语音也在用），
// 只补 faster-whisper 及其依赖的 wheel；模型从国内镜像下 small（约 480 MB）。
// 装完把 voice.json 的 asr.python / asr.script / asr.models 写好，转写直接用。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import {
  ensurePythonRuntime,
  installPackages,
  pythonHome,
  pythonExe,
  sitePackagesDir,
} from './python-env.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL_REPO = 'Systran/faster-whisper-small';
// 国内镜像优先，官方兜底。
const MODEL_MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co'];

// faster-whisper 的运行时依赖（都是 cp311-win_amd64 或纯 Python 轮子）。
const PACKAGES = [
  'faster-whisper',
  'ctranslate2',
  'av',
  'tokenizers',
  'huggingface_hub',
  'onnxruntime',
  'tqdm',
  'filelock',
  'fsspec',
  'packaging',
  'pyyaml',
  'requests',
  'charset_normalizer',
  'urllib3',
  'numpy',
  'zhconv',
];

// small 模型的四个文件（model.bin 约 461 MB）。
const MODEL_FILES = [
  { name: 'config.json', minBytes: 1000 },
  { name: 'tokenizer.json', minBytes: 100000 },
  { name: 'vocabulary.txt', minBytes: 100000 },
  { name: 'model.bin', minBytes: 400 * 1024 * 1024 },
];

export function whisperHome() {
  return path.join(os.homedir(), '.dsh', 'shoreline', 'whisper');
}

export function whisperModelsDir() {
  return path.join(whisperHome(), 'models');
}

export function whisperModelDir(size = 'small') {
  return path.join(whisperModelsDir(), `faster-whisper-${size}`);
}

export function transcribeScriptPath() {
  return path.join(whisperHome(), 'transcribe.py');
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function sizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function logTo(logger, line) {
  try {
    logger(`[whisper-env] ${line}`);
  } catch {
    /* 忽略 */
  }
}

export function whisperEnvInfo() {
  const home = whisperHome();
  const model = whisperModelDir('small');
  const python = pythonExe();
  const site = sitePackagesDir(pythonHome());
  const script = transcribeScriptPath();
  const filesOk = MODEL_FILES.every((f) => sizeOf(path.join(model, f.name)) >= f.minBytes);
  const pkgOk = exists(path.join(site, 'faster_whisper'));
  return {
    home,
    python,
    script,
    models: whisperModelsDir(),
    modelDir: model,
    pythonOk: exists(python),
    scriptOk: exists(script),
    packagesOk: pkgOk,
    modelOk: filesOk,
    modelMb: Math.round(sizeOf(path.join(model, 'model.bin')) / 1024 / 1024),
    ready: exists(python) && exists(script) && pkgOk && filesOk,
  };
}

// 大文件下载：hf-mirror 的 model.bin 有时会连接建立后一直不吐字节，
// 所以这里带「空闲超时 + 重试」，而不是用没有超时的 downloadTo。
function downloadWithTimeout(url, dest, { idleMs = 60000, retries = 3, log: logger = () => {} } = {}) {
  const attempt = (left) => new Promise((resolve, reject) => {
    const part = `${dest}.part`;
    const req = https.get(url, { family: 4, headers: { 'user-agent': 'shoreline-whisper-env' }, timeout: idleMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadWithTimeout(new URL(res.headers.location, url).toString(), dest, { idleMs, retries, log: logger }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(part);
      let last = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - last > idleMs) {
          clearInterval(timer);
          req.destroy(new Error('下载卡住（长时间没有数据）'));
          out.destroy();
        }
      }, 5000);
      res.on('data', (chunk) => { last = Date.now(); out.write(chunk); });
      res.on('end', () => {
        clearInterval(timer);
        out.end(() => {
          try {
            fs.renameSync(part, dest);
            resolve(fs.statSync(dest).size);
          } catch (error) {
            reject(error);
          }
        });
      });
      res.on('error', (error) => {
        clearInterval(timer);
        out.destroy();
        reject(error);
      });
    });
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', (error) => {
      try { fs.rmSync(`${dest}.part`, { force: true }); } catch { /* 忽略 */ }
      reject(error);
    });
  }).catch((error) => {
    if (left <= 1) throw error;
    logTo(logger, `下载失败（${error?.message ?? error}），重试 ${left - 1} 次`);
    return attempt(left - 1);
  });
  return attempt(retries);
}

// 下载一个模型文件：先镜像后官方，已存在且大小够就跳过。
async function fetchModelFile(baseUrl, name, dest, logger) {
  const url = `${baseUrl}/${MODEL_REPO}/resolve/main/${name}`;
  try {
    const size = await downloadWithTimeout(url, dest, { log: logger });
    logTo(logger, `${name} 下载完成：${Math.round(size / 1024 / 1024)} MB`);
    return url;
  } catch (error) {
    logTo(logger, `${name} 从 ${baseUrl} 下载失败：${error?.message ?? error}`);
    throw error;
  }
}

async function downloadModel({ onProgress = () => {}, logger = () => {}, force = false } = {}) {
  const dir = whisperModelDir('small');
  fs.mkdirSync(dir, { recursive: true });
  const total = MODEL_FILES.length;
  let done = 0;
  const problems = [];
  for (const file of MODEL_FILES) {
    const dest = path.join(dir, file.name);
    if (!force && sizeOf(dest) >= file.minBytes) {
      done += 1;
      onProgress({ step: 'model', done, total, message: `已存在 ${file.name}` });
      continue;
    }
    onProgress({ step: 'model', done, total, message: `下载模型 ${file.name}…` });
    let ok = false;
    for (const base of MODEL_MIRRORS) {
      try {
        await fetchModelFile(base, file.name, dest, logger);
        ok = sizeOf(dest) >= file.minBytes;
        if (ok) break;
      } catch {
        /* 换下一个源 */
      }
    }
    if (!ok) problems.push(`${file.name} 下载失败`);
    done += 1;
  }
  return { problems };
}

/** 安装（或修复）whisper 转写环境。 */
export async function installWhisperEnv({ force = false, log: logger = () => {}, onProgress = () => {} } = {}) {
  const before = whisperEnvInfo();
  if (before.ready && !force) return { ok: true, already: true, ...before };

  const py = await ensurePythonRuntime({ log: logger, onProgress });
  logTo(logger, `Python ${py.already ? '已存在' : '已就绪'}：${py.python}`);

  const site = sitePackagesDir(pythonHome());
  onProgress({ step: 'deps', done: 0, total: PACKAGES.length, message: '下载 faster-whisper 依赖…' });
  const { missing } = await installPackages(PACKAGES, site, {
    log: logger,
    onProgress: (i, name, len) => onProgress({ step: 'deps', done: i + 1, total: len, message: `装 ${name}` }),
  });

  const { problems } = await downloadModel({ onProgress, logger, force });

  const scriptSrc = path.join(HERE, 'bili', 'transcribe.py');
  const scriptDst = transcribeScriptPath();
  fs.mkdirSync(path.dirname(scriptDst), { recursive: true });
  if (exists(scriptSrc)) {
    fs.copyFileSync(scriptSrc, scriptDst);
  } else {
    missing.push('插件里缺少 lib/bili/transcribe.py');
  }

  const after = whisperEnvInfo();
  const ok = after.ready && missing.length === 0 && problems.length === 0;
  onProgress({ step: 'done', done: 1, total: 1, message: ok ? '安装完成' : '安装未完成' });
  return {
    ok,
    ...after,
    missing,
    problems,
    error: ok ? '' : (missing[0] || problems[0] || 'whisper 未安装成功'),
  };
}
