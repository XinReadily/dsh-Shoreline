// 自动检测更新 + 一键更新（P5）。
//
// 数据来源只有 GitHub：release 优先，没有 release 就比 main 的提交哈希。
// 本机访问 GitHub 的 IPv6 半连问题用 family:4 规避（和 lib/bili/http.mjs 同因）。
// 更新 = 下载 codeload 的 tar.gz、在内存里解 tar、只覆盖插件目录里该覆盖的文件。
// 用户自己的东西不覆盖：presets/（真实仿真提示词）、bridge/config.json、bridge/state/、
// node_modules/、各种 *.bak-*。覆盖前把被改的文件备份到 .update-backup-<时间戳>/。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import https from 'node:https';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_REPO = 'XinReadily/dsh-Shoreline';
const CACHE_MS = 30 * 60 * 1000;
const MAX_REDIRECTS = 6;
const MAX_BYTES = 60 * 1024 * 1024;
// 这些前缀/名字在更新时永远跳过：用户配置、真实提示词、运行时数据、依赖。
const SKIP_PREFIXES = ['presets/', 'bridge/config.json', 'bridge/state/', 'node_modules/', '.git/', 'state/'];
const SKIP_PATTERNS = [/\.bak-/, /(^|\/)\.bak-before-/, /(^|\/)\.update-backup-/, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/];

let cache = null;

function repoName(options = {}) {
  const fromOptions = String(options.repo ?? '').trim();
  if (fromOptions) return fromOptions;
  const fromEnv = String(process.env.SHORELINE_REPO ?? '').trim();
  return fromEnv || DEFAULT_REPO;
}

export function readLocalVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export function compareVersions(a, b) {
  const parse = (v) => String(v ?? '').replace(/^v/i, '').split(/[.\-+]/).map((x) => Number.parseInt(x, 10)).map((n) => (Number.isFinite(n) ? n : 0));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function tlsOptions(insecure = false) {
  // 本机常见情况：GitHub 走本地代理（hosts 指向 127.0.0.1），证书链是代理自签的，
  // Node 会报 unable to verify the first certificate。
  // 目标解析到本机回环时自动跳过校验（链路只在本机，外部中间人碰不到）；
  // 解析到公网地址时保持校验，除非用户显式设置 SHORELINE_INSECURE_TLS=1。
  if (insecure || process.env.SHORELINE_INSECURE_TLS === '1') return { rejectUnauthorized: false };
  return {};
}

// 先解析目标 IP，决定要不要关闭证书校验；返回 { insecure, address }。
async function resolveTarget(hostname) {
  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    const loopback = address === '::1' || address.startsWith('127.');
    return { insecure: loopback, address };
  } catch {
    return { insecure: false, address: '' };
  }
}

async function request(url, { method = 'GET', timeoutMs = 15000, headers = {} } = {}) {
  const u = new URL(url);
  const target = await resolveTarget(u.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request(
      u,
      { method, family: 4, ...tlsOptions(target.insecure), headers: { 'user-agent': 'shoreline-updater', ...headers } },
      (res) => {
        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          total += c.length;
          if (total > MAX_BYTES) {
            req.destroy(new Error('响应过大'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

async function requestFollow(url, options = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await request(current, options);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).toString();
      // 跳到 objects.githubusercontent.com 之类的下载域名时，不再带 accept/UA 之外的头发送
      continue;
    }
    return res;
  }
  throw new Error('重定向过多');
}

async function githubJson(pathname) {
  const res = await requestFollow(`https://api.github.com${pathname}`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return { status: 404, data: null };
  if (res.status !== 200) throw new Error(`GitHub 返回 ${res.status}`);
  return { status: 200, data: JSON.parse(res.body.toString('utf8')) };
}

function readCacheFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, '.update-cache.json'), 'utf8'));
  } catch {
    return {};
  }
}

function writeCacheFile(patch) {
  try {
    const file = path.join(ROOT, '.update-cache.json');
    const current = readCacheFile();
    fs.writeFileSync(file, JSON.stringify({ ...current, ...patch }, null, 2) + '\n');
  } catch {
    // 写不了就算了，不影响检查
  }
}

export async function checkUpdate(options = {}) {
  const repo = repoName(options);
  const current = readLocalVersion();
  if (!options.force && cache && Date.now() - cache.at < CACHE_MS && cache.repo === repo) {
    return { ...cache.result, cached: true };
  }
  const result = { ok: true, repo, current, latest: current, behind: false, kind: 'none', url: `https://github.com/${repo}`, checkedAt: new Date().toISOString() };
  try {
    const release = await githubJson(`/repos/${repo}/releases/latest`);
    if (release.data) {
      const tag = String(release.data.tag_name ?? release.data.name ?? '');
      result.tag = tag;
      result.latest = tag.replace(/^v/i, '');
      result.kind = 'release';
      result.url = release.data.html_url || result.url;
      result.notes = String(release.data.body ?? '').slice(0, 2000);
      result.publishedAt = release.data.published_at ?? '';
      result.behind = compareVersions(result.latest, current) > 0;
      result.ahead = compareVersions(current, result.latest) > 0;
    } else {
      // 没有 release：比 main 的提交哈希
      const [commit, pkgFile] = await Promise.all([
        githubJson(`/repos/${repo}/commits/main`),
        githubJson(`/repos/${repo}/contents/package.json?ref=main`),
      ]);
      const sha = String(commit.data?.sha ?? '');
      let remoteVersion = current;
      try {
        const content = String(pkgFile.data?.content ?? '');
        remoteVersion = JSON.parse(Buffer.from(content, 'base64').toString('utf8')).version || current;
      } catch {
        // 版本读不到就只比哈希
      }
      const known = String(readCacheFile().lastCommitSha ?? '');
      const versionCmp = compareVersions(remoteVersion, current);
      result.latest = remoteVersion;
      result.kind = 'commit';
      result.commit = sha.slice(0, 12);
      result.url = `https://github.com/${repo}/commit/${sha}`;
      // 远端版本更高 → 有更新；版本相同但 main 的提交变了 → 也有更新；
      // 远端版本更低说明本地是开发中的版本（还没发出去），不提示更新，避免把自己降级。
      result.behind = versionCmp > 0 || (versionCmp === 0 && Boolean(known) && Boolean(sha) && known !== sha);
      result.ahead = versionCmp < 0;
      if (sha) writeCacheFile({ lastCommitSha: sha });
    }
  } catch (error) {
    result.ok = false;
    result.error = error?.message ?? String(error);
    if (/certificate|CERT_|SELF_SIGNED/i.test(result.error)) {
      result.error += '（本机 GitHub 走本地代理时证书链不完整：可设环境变量 SHORELINE_INSECURE_TLS=1，或给 DSH 的 node 加 --use-system-ca）';
    }
  }
  cache = { at: Date.now(), repo, result };
  return result;
}

// —— tar.gz 解析（只读，不落临时文件）——

function parseTar(buf) {
  const files = [];
  let off = 0;
  let longName = '';
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156]);
    const dataOff = off + 512;
    const data = buf.subarray(dataOff, dataOff + size);
    off = dataOff + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') continue; // pax 扩展头：内容忽略
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/, '');
      continue;
    }
    if (type === 'K') continue;
    if (type !== '0' && type !== '\0' && type !== '5') continue;
    const full = prefix ? `${prefix}/${name}` : name;
    const finalName = longName || full;
    longName = '';
    if (type === '5' || finalName.endsWith('/')) continue;
    files.push({ name: finalName, data: Buffer.from(data) });
  }
  return files;
}

function shouldSkip(name) {
  if (SKIP_PREFIXES.some((p) => name.startsWith(p))) return true;
  return SKIP_PATTERNS.some((re) => re.test(name));
}

// 更新只写不删会留下过期文件（比如仓库删掉的 client 片段），所以这些纯代码目录里
// 「本次包里没有的文件」会被清掉（清之前先备份到 .update-backup-<时间戳>/）。
// 只动代码扩展名，且不碰 presets / seed / state / README 这类用户内容。
const PRUNE_DIRS = ['client/', 'lib/', 'test/', 'scripts/', 'public/'];
const PRUNE_EXT = /\.(js|mjs|cjs|json|css|html)$/i;

export function isPrunablePath(name) {
  const rel = String(name ?? '');
  if (!rel) return false;
  if (shouldSkip(rel)) return false;
  return PRUNE_DIRS.some((p) => rel.startsWith(p)) && PRUNE_EXT.test(rel);
}

function walkFiles(dir, prefix, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) walkFiles(abs, `${rel}/`, out);
    else if (entry.isFile()) out.push(rel);
  }
}

function pruneStale(seen, backupDir) {
  const pruned = [];
  for (const prefix of PRUNE_DIRS) {
    const start = path.join(ROOT, prefix);
    if (!fs.existsSync(start)) continue;
    const files = [];
    walkFiles(start, prefix, files);
    for (const rel of files) {
      if (seen.has(rel) || !isPrunablePath(rel)) continue;
      const target = path.join(ROOT, rel);
      try {
        const backup = path.join(backupDir, rel);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(target, backup);
        fs.unlinkSync(target);
        pruned.push(rel);
      } catch {
        // 删不掉就算了，下次更新再试
      }
    }
  }
  return pruned;
}

// 给测试用：更新时哪些路径会被跳过（用户配置、真实提示词、运行时数据、备份文件）。
export function shouldSkipUpdatePath(name) {
  return shouldSkip(String(name ?? ''));
}

// 给测试用：解析 tar 缓冲区，返回 [{name, data}]。
export function parseTarEntries(buf) {
  return parseTar(buf);
}

// 给测试用：更新时下载哪个 ref。release 必须用原始 tag（可能带 v 前缀，
// 用 latest 去掉 v 后的版本号去 codeload 会 404）；commit 走 main。
export function pickUpdateRef(info = {}, override = '') {
  const forced = String(override ?? '').trim();
  if (forced) return forced;
  if (info.kind === 'commit') return 'main';
  return String(info.tag || info.latest || 'main');
}

export async function applyUpdate(options = {}) {
  const repo = repoName(options);
  const info = await checkUpdate({ repo, force: true });
  if (info.ok === false) throw new Error(`检查更新失败：${info.error || '未知错误'}`);
  const ref = pickUpdateRef(info, options.ref);
  const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  const res = await requestFollow(url);
  if (res.status !== 200) throw new Error(`下载源码包失败：HTTP ${res.status}`);
  let tarBuf;
  try {
    tarBuf = zlib.gunzipSync(res.body);
  } catch {
    throw new Error('源码包不是有效的 gzip');
  }
  const entries = parseTar(tarBuf);
  if (!entries.length) throw new Error('源码包是空的');
  // GitHub 的包顶层是 <repo>-<ref>/，统一去掉第一段
  const first = entries[0].name.split('/')[0];
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupDir = path.join(ROOT, `.update-backup-${stamp}`);
  const written = [];
  const skipped = [];
  const seen = new Set();
  for (const entry of entries) {
    const rel = entry.name.startsWith(`${first}/`) ? entry.name.slice(first.length + 1) : entry.name;
    if (!rel || rel.includes('..')) continue;
    if (shouldSkip(rel)) {
      skipped.push(rel);
      continue;
    }
    const target = path.join(ROOT, rel);
    if (!target.startsWith(ROOT + path.sep)) continue;
    seen.add(rel);
    if (fs.existsSync(target)) {
      try {
        const old = fs.readFileSync(target);
        if (old.equals(entry.data)) continue; // 内容一样就不动
        const backup = path.join(backupDir, rel);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, old);
      } catch {
        // 备份失败也继续写，避免整次更新失败
      }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    written.push(rel);
  }
  // 清掉代码目录里本次包里已经没有的文件（仓库删掉的片段/模块），清之前同样先备份。
  const pruned = pruneStale(seen, backupDir);
  const version = readLocalVersion();
  // 只有在确实拿到了新提交哈希时才更新缓存；release 包没有 commit 字段，别把已知哈希清掉。
  if (info.commit) writeCacheFile({ lastCommitSha: info.commit });
  cache = null;
  return {
    ok: true,
    repo,
    ref,
    version,
    written,
    pruned,
    skipped: skipped.length,
    backupDir: written.length || pruned.length ? backupDir : '',
    requiresRestart: true,
  };
}
