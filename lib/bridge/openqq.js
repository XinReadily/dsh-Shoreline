// OpenQQ 一键安装：查最新 release、下载 zip、解压、读出它的 OneBot 配置。
//
// 为什么自己解压而不用 PowerShell Expand-Archive：插件运行在 DSH 宿主里，
// 不应为了一个 zip 去起一个外部进程（慢、要转义路径、非 Windows 直接不可用）。
// 这里只实现「存储 + deflate」两种 zip 压缩方式，足够覆盖 GitHub 的发布包。
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import zlib from 'node:zlib';

const REPO = 'feijx3/OpenQQ';

/** 发一个 GET，强制 IPv4（本机 IPv6 常半通，全局 fetch 会卡到超时）。 */
function get(url, { json = false, maxRedirects = 6, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (target, left) => {
      const req = https.get(target, {
        family: 4,
        headers: { 'user-agent': 'shoreline-openqq-installer', accept: 'application/vnd.github+json, */*' },
        timeout: timeoutMs,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
          res.resume();
          return go(new URL(res.headers.location, target).toString(), left - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}：${target}`));
        }
        if (!json) return resolve({ stream: res });
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (error) { reject(new Error(`响应不是 JSON：${error?.message ?? error}`)); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
    };
    go(url, maxRedirects);
  });
}

/** 最新 release 里挑一个 windows x64 的 zip。 */
export async function latestOpenQQAsset() {
  const rel = await get(`https://api.github.com/repos/${REPO}/releases/latest`, { json: true });
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const asset = assets.find((a) => /win.*x64.*\.zip$/i.test(String(a?.name ?? '')))
    ?? assets.find((a) => /\.zip$/i.test(String(a?.name ?? '')));
  if (!asset) throw new Error('这个 release 里没有 zip 资产');
  return { tag: rel.tag_name ?? '', name: asset.name, size: asset.size, url: asset.browser_download_url };
}

/** 下载到 dest（覆盖）。返回字节数。 */
export async function downloadTo(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const { stream } = await get(url);
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    stream.on('data', (c) => { bytes += c.length; });
    stream.pipe(out);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
  });
  fs.renameSync(tmp, dest);
  return bytes;
}

/** 读 zip 的中央目录（只认存储与 deflate）。返回 [{ name, method, compSize, size, offset }]。 */
export function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录结尾）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录条目损坏');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, size, offset: localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 解压 zip 到 destDir（防目录穿越）。返回解出的文件数。 */
export function unzipTo(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const entries = readZipEntries(buf);
  const root = path.resolve(destDir);
  let files = 0;
  for (const e of entries) {
    const target = path.resolve(root, e.name);
    if (!target.startsWith(root + path.sep) && target !== root) throw new Error(`zip 里有越界路径：${e.name}`);
    if (e.name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    const local = e.offset;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`本地头损坏：${e.name}`);
    const nameLen = buf.readUInt16LE(local + 26);
    const extraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + nameLen + extraLen;
    const comp = buf.subarray(start, start + e.compSize);
    let data;
    if (e.method === 0) data = comp;
    else if (e.method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error(`不支持的压缩方式 ${e.method}：${e.name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    files += 1;
  }
  return files;
}

/**
 * zip 顶层通常带一个 `<name>-<tag>-win-x64/` 目录；把它里面的东西提到 destDir 根。
 * 返回是否发生了提升。
 */
export function flattenSingleRoot(destDir) {
  const root = path.resolve(destDir);
  const items = fs.readdirSync(root, { withFileTypes: true });
  if (items.length !== 1 || !items[0].isDirectory()) return false;
  const inner = path.join(root, items[0].name);
  for (const item of fs.readdirSync(inner, { withFileTypes: true })) {
    fs.renameSync(path.join(inner, item.name), path.join(root, item.name));
  }
  fs.rmdirSync(inner);
  return true;
}

/** 读 OpenQQ 的 config/openqq.json；没有就返回 null。 */
export function readOpenQQHome(home) {
  try {
    const file = path.join(String(home), 'config', 'openqq.json');
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const j = JSON.parse(text);
    return {
      file,
      accessToken: String(j?.accessToken ?? ''),
      wsPort: Number(j?.ws?.port) || 3001,
      wsEnabled: j?.ws?.enabled !== false,
      httpPort: Number(j?.http?.port) || 5700,
      httpEnabled: j?.http?.enabled === true,
      webPort: Number(j?.webPort) || 17860,
    };
  } catch {
    return null;
  }
}

/** 已安装？看目录里有没有 src/main.mjs。 */
export function isOpenQQInstalled(home) {
  try {
    return fs.existsSync(path.join(String(home), 'src', 'main.mjs'));
  } catch {
    return false;
  }
}
