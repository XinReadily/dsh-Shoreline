// 一键安装 Edge 语音所需的 Python 环境。
//
// 装什么：Windows 嵌入式 Python 3.11 + edge-tts 及其依赖的 wheel，
// 全部解压到 ~/.dsh/shoreline/python，再把 tts.py 放进去。
// 装完把路径写进 voice.json（tts.edge.python / tts.edge.script），桥接直接读。
//
// 为什么不用纯 Node：微软新版 Sec-MS-GEC v2 token 是 CS64 + 改过常数的
// SHA256（edge_tts/drm.py 里刻意混淆），复刻不现实且随版本失效。
//
// 下载优先走国内镜像（华为云 Python、清华/阿里 PyPI），失败再回退官方源。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { downloadTo, unzipTo } from './bridge/openqq.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_VERSION = '3.11.9';
const PY_MIRRORS = [
  (v) => `https://mirrors.huaweicloud.com/python/${v}/python-${v}-embed-amd64.zip`,
  (v) => `https://www.python.org/ftp/python/${v}/python-${v}-embed-amd64.zip`,
];
const SIMPLE_MIRRORS = [
  (pkg) => `https://pypi.tuna.tsinghua.edu.cn/simple/${pkg}/`,
  (pkg) => `https://mirrors.aliyun.com/pypi/simple/${pkg}/`,
];

// edge-tts 的运行时依赖（纯 Python 或 cp311-win_amd64 wheel）。
const PACKAGES = [
  'edge-tts',
  'aiohttp',
  'aiohappyeyeballs',
  'aiosignal',
  'attrs',
  'frozenlist',
  'multidict',
  'yarl',
  'propcache',
  'idna',
  'typing_extensions',
  'certifi',
  'tabulate',
];

export function pythonHome() {
  return path.join(os.homedir(), '.dsh', 'shoreline', 'python');
}

export function pythonExe() {
  return path.join(pythonHome(), 'python.exe');
}

export function ttsScriptPath() {
  return path.join(pythonHome(), 'tts.py');
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function logTo(logger, line) {
  try {
    logger(`[edge-env] ${line}`);
  } catch {
    /* 忽略 */
  }
}

function fetchText(url, { timeoutMs = 15000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (target, left) => {
      const req = https.get(target, { family: 4, timeout: timeoutMs, headers: { 'user-agent': 'shoreline-edge-env' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
          res.resume();
          go(new URL(res.headers.location, target).toString(), left - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}：${target}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('timeout', () => req.destroy(new Error(`请求超时：${target}`)));
      req.on('error', reject);
    };
    go(url, maxRedirects);
  });
}

function getJson(url, timeoutMs = 15000) {
  return fetchText(url, { timeoutMs }).then((text) => JSON.parse(text));
}

export function compareVersions(a, b) {
  const pa = String(a || '').split(/[.+-]/).map((x) => Number.parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  const pb = String(b || '').split(/[.+-]/).map((x) => Number.parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 从 simple 索引 HTML 里挑 wheel；按文件名里的版本取最高。
export function pickWheelFromHtml(html = '') {
  const found = [];
  const re = /href="([^"]+\.whl)([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const file = href.split('/').pop() || '';
    let score = 0;
    if (file.includes('-cp311-cp311-win_amd64.whl')) score = 3;
    else if (file.includes('-cp311-abi3-win_amd64.whl')) score = 2;
    else if (file.includes('-py3-none-any.whl')) score = 1;
    if (!score) continue;
    const version = file.split('-')[1] || '';
    found.push({ url: href, filename: file, score, version });
  }
  if (!found.length) return null;
  found.sort((a, b) => (b.score - a.score) || compareVersions(b.version, a.version));
  return found[0];
}

// 从 PyPI JSON 的 urls 里挑（国内源失败时的回退）。
export function pickWheel(urls = []) {
  const files = (urls || []).filter((u) => typeof u?.filename === 'string');
  const byName = (frag) => files.find((u) => u.filename.includes(frag));
  return byName('-cp311-cp311-win_amd64.whl')
    || byName('-cp311-abi3-win_amd64.whl')
    || byName('-py3-none-any.whl')
    || byName('-py2.py3-none-any.whl')
    || null;
}

// 纯 Python 包只有源码包（比如 zhconv），从索引里挑 .tar.gz。
export function pickSdistFromHtml(html = '') {
  const found = [];
  const re = /href="([^"]+\.(?:tar\.gz|zip))([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const file = href.split('/').pop() || '';
    const version = file.split('-').slice(-1)[0].replace(/\.(tar\.gz|zip)$/, '');
    found.push({ url: href, filename: file, version });
  }
  if (!found.length) return null;
  found.sort((a, b) => compareVersions(b.version, a.version));
  return found[0];
}

async function resolveSdist(pkg, logger) {
  for (const toUrl of SIMPLE_MIRRORS) {
    try {
      const page = toUrl(pkg);
      const html = await fetchText(page, { timeoutMs: 20000 });
      const hit = pickSdistFromHtml(html);
      if (hit) {
        logTo(logger, `${pkg} 没有轮子，改下源码包 ${hit.filename}`);
        return { url: new URL(hit.url, page).toString(), filename: hit.filename };
      }
    } catch (error) {
      logTo(logger, `${pkg} 源码包探测失败：${error?.message ?? error}`);
    }
  }
  return null;
}

// 极简 tar 解析（sdist 用）：只取普通文件，够用。
export function tarEntries(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const full = prefix ? `${prefix}/${name}` : name;
    out.push({ name: full, type, data: buf.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

// 把 sdist 里的包目录/单文件模块摊进 site-packages。
export function extractSdist(tarGzPath, siteDir, pkg) {
  const raw = zlib.gunzipSync(fs.readFileSync(tarGzPath));
  const entries = tarEntries(raw);
  const wanted = pkg.replace(/-/g, '_').toLowerCase();
  fs.mkdirSync(siteDir, { recursive: true });
  let written = 0;
  for (const entry of entries) {
    if (entry.type !== '0') continue;
    const parts = entry.name.split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const rel = parts.slice(1); // 去掉 <name>-<version>/
    const head = rel[0].toLowerCase();
    const isModule = rel.length === 1 && (head === `${wanted}.py`);
    const isPackage = rel.length >= 2 && head === wanted;
    if (!isModule && !isPackage) continue;
    const target = path.resolve(siteDir, rel.join(path.sep));
    if (!target.startsWith(path.resolve(siteDir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    written += 1;
  }
  return written;
}

// 一个包先在镜像上找，镜像不行再用官方 JSON。
async function resolveWheel(pkg, logger) {
  for (const toUrl of SIMPLE_MIRRORS) {
    try {
      const page = toUrl(pkg);
      const html = await fetchText(page, { timeoutMs: 20000 });
      const hit = pickWheelFromHtml(html);
      if (hit) {
        return { url: new URL(hit.url, page).toString(), filename: hit.filename };
      }
      logTo(logger, `${pkg} 镜像上没有可用轮子，换下一个源`);
    } catch (error) {
      logTo(logger, `${pkg} 镜像失败：${error?.message ?? error}`);
    }
  }
  const meta = await getJson(`https://pypi.org/pypi/${pkg}/json`, 12000);
  const wheel = pickWheel(meta.urls);
  if (!wheel) return null;
  return { url: wheel.url, filename: wheel.filename };
}

// wheel 本质是 zip；里面可能带 <pkg>.data/purelib|platlib，需要拍平到 site-packages。
export function wheelEntries(zipPath) {
  const raw = fs.readFileSync(zipPath);
  const n = raw.length;
  let eocd = -1;
  for (let i = n - 22; i >= 0 && i > n - 66000; i -= 1) {
    if (raw.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录）');
  const count = raw.readUInt16LE(eocd + 10);
  let off = raw.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count; k += 1) {
    if (raw.readUInt32LE(off) !== 0x02014b50) break;
    const method = raw.readUInt16LE(off + 10);
    const compSize = raw.readUInt32LE(off + 20);
    const nameLen = raw.readUInt16LE(off + 28);
    const extraLen = raw.readUInt16LE(off + 30);
    const commentLen = raw.readUInt16LE(off + 32);
    const localOff = raw.readUInt32LE(off + 42);
    const name = raw.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/')) continue;
    const lNameLen = raw.readUInt16LE(localOff + 26);
    const lExtraLen = raw.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = raw.subarray(dataStart, dataStart + compSize);
    const rel = name
      .replace(/^[^/]+\.data\/purelib\//, '')
      .replace(/^[^/]+\.data\/platlib\//, '');
    out.push({ name: rel, method, data });
  }
  return out;
}

function extractWheel(wheelPath, siteDir) {
  fs.mkdirSync(siteDir, { recursive: true });
  const entries = wheelEntries(wheelPath);
  let written = 0;
  for (const entry of entries) {
    const target = path.resolve(siteDir, entry.name);
    if (!target.startsWith(path.resolve(siteDir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buf = entry.method === 8 ? zlib.inflateRawSync(entry.data) : entry.data;
    fs.writeFileSync(target, buf);
    written += 1;
  }
  return written;
}

// 嵌入式 Python 默认隔离 site-packages，需要往 _pth 里加一行。
function patchPth(home) {
  const candidates = fs.readdirSync(home).filter((f) => /^python\d+\._pth$/i.test(f));
  if (!candidates.length) throw new Error('没找到 python311._pth，Python 包可能不完整');
  for (const file of candidates) {
    const full = path.join(home, file);
    let text = fs.readFileSync(full, 'utf8');
    if (text.includes('Lib\\site-packages')) continue;
    text = `${text.replace(/\s*$/, '')}\r\nLib\\site-packages\r\n`;
    fs.writeFileSync(full, text, 'utf8');
  }
}

function dirSize(dir) {
  try {
    let total = 0;
    const walk = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    };
    walk(dir);
    return total;
  } catch {
    return 0;
  }
}

export function edgeEnvInfo() {
  const home = pythonHome();
  const py = pythonExe();
  const script = ttsScriptPath();
  const site = path.join(home, 'Lib', 'site-packages');
  return {
    home,
    python: py,
    script,
    installed: exists(py),
    pythonOk: exists(py),
    scriptOk: exists(script),
    edgeTtsOk: exists(path.join(site, 'edge_tts')),
    ready: exists(py) && exists(script) && exists(path.join(site, 'edge_tts')),
    sizeBytes: dirSize(home),
  };
}

async function downloadPython(zipPath, logger) {
  const errors = [];
  for (const toUrl of PY_MIRRORS) {
    const url = toUrl(PY_VERSION);
    try {
      logTo(logger, `下载 Python：${url}`);
      await downloadTo(url, zipPath);
      return url;
    } catch (error) {
      errors.push(`${url}: ${error?.message ?? error}`);
    }
  }
  throw new Error(`Python 运行时下载失败：${errors.join(' | ')}`);
}

/**
 * 确保嵌入式 Python 就位（Edge 语音与 whisper 转写共用这一份）。
 * 已存在直接返回；不存在就下镜像、解压、补 _pth。
 */
export async function ensurePythonRuntime({ home = pythonHome(), tmpDir = '', log: logger = () => {}, onProgress = () => {} } = {}) {
  const exe = path.join(home, process.platform === 'win32' ? 'python.exe' : 'python');
  if (exists(exe)) return { ok: true, already: true, home, python: exe };
  fs.mkdirSync(home, { recursive: true });
  const tmp = tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'shoreline-py-'));
  try {
    onProgress({ step: 'python', done: 0, total: 0, message: `下载 Python ${PY_VERSION}…` });
    const zipPath = path.join(tmp, 'python.zip');
    await downloadPython(zipPath, logger);
    logTo(logger, '解压 Python');
    unzipTo(zipPath, home);
    patchPth(home);
    logTo(logger, 'Python 就绪');
    return { ok: true, already: false, home, python: exe };
  } finally {
    if (!tmpDir) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 从镜像下这些包的 wheel 并解压进 siteDir。返回 { missing, installed }。 */
export async function installPackages(packages, siteDir, { log: logger = () => {}, onProgress = () => {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoreline-wheels-'));
  const missing = [];
  const installed = [];
  try {
    for (let i = 0; i < packages.length; i += 1) {
      const name = packages[i];
      onProgress(i, name, packages.length);
      try {
        const wheel = await resolveWheel(name, logger);
        if (wheel) {
          const dest = path.join(tmp, wheel.filename);
          if (!exists(dest)) await downloadTo(wheel.url, dest);
          extractWheel(dest, siteDir);
          installed.push(name);
          logTo(logger, `装好 ${name}：${wheel.filename}`);
          continue;
        }
        const sdist = await resolveSdist(name, logger);
        if (!sdist) {
          missing.push(`${name}: 没有可用的 Windows 轮子或源码包`);
          continue;
        }
        const dest = path.join(tmp, sdist.filename);
        if (!exists(dest)) await downloadTo(sdist.url, dest);
        const n = extractSdist(dest, siteDir, name);
        if (n > 0) {
          installed.push(name);
          logTo(logger, `装好 ${name}：${sdist.filename}（源码包，${n} 个文件）`);
        } else {
          missing.push(`${name}: 源码包里没找到包目录`);
        }
      } catch (error) {
        missing.push(`${name}: ${error?.message ?? error}`);
      }
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
  return { missing, installed };
}

export function sitePackagesDir(home = pythonHome()) {
  return path.join(home, 'Lib', 'site-packages');
}

// 安装：Python 运行时 → 依赖 wheel → tts.py。
export async function installEdgeEnv({ log: logger = () => {}, onProgress = () => {}, force = false } = {}) {
  const home = pythonHome();
  const site = path.join(home, 'Lib', 'site-packages');
  const before = edgeEnvInfo();
  if (before.ready && !force) return { ok: true, already: true, ...before };

  fs.mkdirSync(home, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoreline-edge-'));
  const total = PACKAGES.length + 2;
  const missing = [];

  try {
    // 1. Python 运行时
    await ensurePythonRuntime({ home, tmpDir: tmp, log: logger, onProgress });

    // 2. 依赖 wheel
    onProgress({ step: 'deps', done: 1, total, message: '下载 edge-tts 依赖…' });
    const result = await installPackages(PACKAGES, site, {
      log: logger,
      onProgress: (i, name) => onProgress({ step: 'deps', done: i + 2, total, message: `下载 ${name}` }),
    });
    missing.push(...result.missing);

    // 3. tts.py
    const scriptSrc = path.join(HERE, 'voice', 'tts.py');
    if (exists(scriptSrc)) {
      fs.copyFileSync(scriptSrc, ttsScriptPath());
    } else {
      missing.push('插件里缺少 lib/voice/tts.py');
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响 */
    }
  }

  const after = edgeEnvInfo();
  const ok = after.ready && missing.length === 0;
  onProgress({ step: 'done', done: total, total, message: ok ? '安装完成' : '安装未完成' });
  return {
    ok,
    ...after,
    missing,
    error: ok ? '' : (missing[0] || 'edge_tts 未安装成功'),
  };
}
