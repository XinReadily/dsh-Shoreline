/**
 * Node.js 检测与一键安装。
 *
 * DSH 自带一个 Node（改不了），但用户机器上可能没有独立的 node 命令：
 * OpenQQ 之类的子进程需要一个能直接启动的 node.exe。这里检测系统 Node 与
 * DSH 自带 Node，必要时把官方 Windows zip 下载解压到插件数据目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import { execFileSync } from 'node:child_process';
import { downloadTo, unzipTo, flattenSingleRoot } from './bridge/openqq.js';

const MIN_MAJOR = 22;
const MIRROR = 'https://nodejs.org/dist';

export function nodeInstallRoot() {
  return path.join(os.homedir(), '.dsh', 'shoreline', 'node');
}

function requestJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    dns.lookup(new URL(url).hostname, { family: 4 }, (err, addr) => {
      const opts = {
        headers: { 'user-agent': 'shoreline', accept: 'application/json' },
        timeout: timeoutMs,
      };
      if (!err && /^(127\.|::1)/.test(addr)) opts.rejectUnauthorized = false;
      https
        .get(url, opts, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            resolve(requestJson(new URL(res.headers.location, url).toString(), timeoutMs));
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(new Error(`解析 ${url} 失败：${error?.message ?? error}`));
            }
          });
        })
        .on('error', reject);
    });
  });
}

function versionOf(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: `v${m[1]}.${m[2]}.${m[3]}` };
}

/** 找系统 PATH 里的 node（跳过 DSH 自带的那个）。 */
export function systemNode() {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(cmd, ['node'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const first = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (!first) return null;
    return { exe: first, version: versionOf(execFileSync(first, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim()) };
  } catch {
    return null;
  }
}

/** 插件目录里已经装好的 Node（~/.dsh/shoreline/node/*\/node.exe）。 */
export function installedNode() {
  const root = nodeInstallRoot();
  if (!fs.existsSync(root)) return null;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const exe = path.join(dir, 'node.exe');
    if (!fs.existsSync(exe)) continue;
    try {
      const version = versionOf(execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim());
      return { exe, version, home: dir };
    } catch {
      /* 坏目录跳过 */
    }
  }
  return null;
}

export function nodeInfo() {
  const dsh = versionOf(process.version);
  const system = systemNode();
  const installed = installedNode();
  const usable = [system, installed].filter(Boolean).find((n) => n.version && n.version.major >= MIN_MAJOR) || null;
  return {
    dsh: dsh ? dsh.raw : process.version,
    system: system ? { exe: system.exe, version: system.version?.raw || '' } : null,
    installed: installed ? { exe: installed.exe, version: installed.version?.raw || '' } : null,
    minMajor: MIN_MAJOR,
    usable: usable ? { exe: usable.exe, version: usable.version.raw } : null,
    hint: usable
      ? ''
      : `没有找到 Node ${MIN_MAJOR}+（OpenQQ 需要）。点「安装 Node」下载官方 Windows 版到插件目录，或自己装一个。`,
  };
}

/** 挑最新的 Node LTS（22/24）win-x64 zip。 */
export async function latestNodeZip() {
  const index = await requestJson(`${MIRROR}/index.json`);
  const list = Array.isArray(index) ? index : [];
  const pick = list.find((v) => /^v(22|24)\./.test(v.version) && v.lts) || list.find((v) => /^v(22|24)\./.test(v.version));
  if (!pick) throw new Error('没能从 nodejs.org 找到 LTS 版本');
  const version = pick.version;
  return {
    version,
    url: `${MIRROR}/${version}/node-${version}-win-x64.zip`,
    shasum: pick.files?.find?.((f) => f === `win-x64-zip`) ? '' : '',
  };
}

export async function installNode() {
  const root = nodeInstallRoot();
  const existing = installedNode();
  if (existing) return { ok: true, already: true, exe: existing.exe, version: existing.version.raw, home: existing.home };
  const zip = await latestNodeZip();
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(os.tmpdir(), `shoreline-node-${Date.now()}.zip`);
  await downloadTo(zip.url, tmp);
  const target = path.join(root, zip.version);
  fs.mkdirSync(target, { recursive: true });
  unzipTo(tmp, target);
  flattenSingleRoot(target);
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* 忽略 */
  }
  const exe = path.join(target, 'node.exe');
  if (!fs.existsSync(exe)) throw new Error(`安装后没找到 node.exe（${target}）`);
  const version = versionOf(execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim());
  return { ok: true, exe, version: version?.raw || zip.version, home: target };
}
