// 游客态增强：视频元数据、播放地址、抽帧、分享到 QQ。
// 不读 SESSDATA，不登录 B 站；只用公开 view/playurl 接口。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { getConfig } from './store.mjs';
import { safeFetch } from './http.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HEADERS = { 'user-agent': UA, referer: 'https://www.bilibili.com/' };
// 数据根：配置、历史、封面、媒体缓存都在这下面。默认在 ~/.dsh/bili-feed。
// 面板里可以单独指定 mediaDir（媒体目录），不填就是 <数据根>/media。
const DATA_DIR = process.env.BILI_FEED_DATA
  || path.join(os.homedir(), '.dsh', 'bili-feed');
const CRED_FILE = path.join(DATA_DIR, 'credentials.json');
const COVER_DIR = path.join(DATA_DIR, 'covers');

/** 媒体目录：抽帧、音频这些体积大的东西。面板可覆盖，默认 <DATA_DIR>/media。 */
export function mediaRoot() {
  let custom = '';
  try {
    custom = String(getConfig()?.mediaDir ?? '').trim();
  } catch {}
  return custom || path.join(DATA_DIR, 'media');
}

async function getJSON(url, timeout = 15000, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await safeFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.code !== 0) throw new Error(`code=${body.code} ${body.message || ''}`);
      return body.data;
    } catch (error) {
      lastError = error;
      // 412 / 5xx / 网络抖动都是暂时的，歇一下重试；code= 这种业务错误重试也没用。
      if (String(error?.message ?? '').startsWith('code=')) break;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function videoInfo(bvid) {
  const d = await getJSON(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  const page = d.pages?.[0] || {};
  return {
    bvid: d.bvid,
    title: d.title,
    cover: d.pic,
    author: d.owner?.name || '',
    mid: d.owner?.mid || 0,
    duration: page.duration || d.duration || 0,
    pages: Array.isArray(d.pages) ? d.pages.length : 1,
    cid: page.cid || d.cid || 0,
    pubdate: d.pubdate || 0,
    desc: d.desc || '',
    url: `https://www.bilibili.com/video/${d.bvid}`,
  };
}

export async function playUrl(bvid, cid, qn = 32) {
  const u = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=${qn}&fnval=1&fnver=0&fourk=0`;
  const d = await getJSON(u);
  const segs = Array.isArray(d.durl) ? d.durl : [];
  if (!segs.length || !segs[0]?.url) throw new Error('没有拿到 MP4 播放地址（该视频可能是番剧/付费/地区限制）');
  // 每个分片都带一组备用 CDN：某条线路偶尔连不上（fetch failed），换一条就过去了。
  const parts = segs.map((s) => [s.url, ...(Array.isArray(s.backup_url) ? s.backup_url : [])].filter(Boolean));
  return {
    urls: segs.map((s) => s.url),
    parts,
    size: segs.reduce((n, s) => n + (Number(s.size) || 0), 0),
    quality: d.quality || qn,
  };
}

async function downloadOne(url, outFile, timeout = 120000) {
  const res = await safeFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!res.ok) throw new Error(`视频下载 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('视频下载为空');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return outFile;
}

/** 依次试主线路和备用 CDN，任何一条成功就收工。 */
async function download(candidates, outFile) {
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
  let lastError;
  for (let i = 0; i < list.length; i += 1) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await downloadOne(list[i], outFile);
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  const detail = lastError?.cause?.message || lastError?.message || String(lastError);
  throw new Error(`视频下载失败（${list.length} 条线路都试过了）：${detail}`);
}

export function findFfmpeg() {
  const candidates = [
    process.env.BILI_FFMPEG,
    // 抽帧/转写需要 ffmpeg：优先环境变量，其次是 PATH 里的 ffmpeg。
    'ffmpeg',
  ].filter(Boolean);
  for (const p of candidates) {
    if (p === 'ffmpeg') return p;
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${String(m).padStart(2, '0')}:${ss}`;
}

function probeDuration(file, ffmpeg) {
  const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));
  try {
    const out = execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
      timeout: 15000, windowsHide: true, stdio: 'pipe',
    }).toString().trim();
    const n = Number(out);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // 剪映自带 ffmpeg 没有 ffprobe，退回解析 ffmpeg -i 的 Duration。
  }
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { timeout: 15000, windowsHide: true, stdio: 'pipe' });
  } catch (e) {
    const text = String(e?.stderr || '');
    const m = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return 0;
}

/** 抽帧：按视频时长分档取帧数；count 显式传入时覆盖分档。返回本地 jpg 路径。 */
export async function frames(bvid, count = undefined) {
  const info = await videoInfo(bvid);
  if (!info.cid) throw new Error('拿不到 cid');
  const dir = path.join(mediaRoot(), 'frames', `${bvid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const videoFile = path.join(dir, 'video.mp4');
  const play = await playUrl(bvid, info.cid, 32);
  const ffmpeg = findFfmpeg();

  // B 站长视频常被切成多个 durl 分片；只下第一片会得到 3 分钟试看。
  const parts = [];
  const plan = Array.isArray(play.parts) && play.parts.length ? play.parts : play.urls.map((u) => [u]);
  for (let i = 0; i < plan.length; i += 1) {
    const part = path.join(dir, `part_${String(i + 1).padStart(2, '0')}.mp4`);
    await download(plan[i], part);
    parts.push(part);
  }
  if (parts.length === 1) {
    fs.copyFileSync(parts[0], videoFile);
  } else {
    const listFile = path.join(dir, 'concat.txt');
    fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', videoFile], {
      timeout: 120000, windowsHide: true, stdio: 'pipe',
    });
  }

  const actual = probeDuration(videoFile, ffmpeg) || info.duration;
  const cfg = getConfig();
  let n;
  if (count !== undefined && Number(count) > 0) {
    n = Number(count);
  } else if (actual <= 30) {
    n = cfg.frameMicro;
  } else if (actual <= 180) {
    n = cfg.frameShort;
  } else if (actual <= 360) {
    n = cfg.frameMedium;
  } else if (actual < 720) {
    n = cfg.frameLong;
  } else {
    n = cfg.frameXlong;
  }
  n = Math.min(Math.max(Number(n) || 10, 1), 40);
  const times = [];
  const usable = Math.max(1, actual - 1);
  for (let i = 0; i < n; i += 1) {
    const t = Math.max(0.5, (usable * (i + 0.5)) / n);
    times.push(t);
  }
  const files = [];
  for (let i = 0; i < times.length; i += 1) {
    const out = path.join(dir, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
    try {
      execFileSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(times[i]), '-i', videoFile,
        '-frames:v', '1', '-update', '1', '-q:v', '2', out,
      ], { timeout: 60000, windowsHide: true, stdio: 'pipe' });
    } catch (e) {
      // 某些 ffmpeg 构建即使写出 jpg 也会以非零退出；文件存在就算成功。
      if (!fs.existsSync(out)) {
        const detail = String(e?.stderr || e?.message || e).slice(-300);
        throw new Error(`ffmpeg 抽帧失败：${detail}`);
      }
    }
    if (fs.existsSync(out)) files.push({ path: out, time: formatTime(times[i]) });
  }
  if (!files.length) throw new Error(`抽帧没有输出（视频实际时长 ${Math.round(actual)} 秒）`);

  // 拼一张联系人缩略图：MCP 直接回图，QQ 会话不需要 read_image 权限。
  let sheet = null;
  const cols = Math.min(5, files.length);
  const rows = Math.ceil(files.length / cols);
  const sheetFile = path.join(dir, 'sheet.jpg');
  try {
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-framerate', '1', '-start_number', '1',
      '-i', path.join(dir, 'frame_%02d.jpg'),
      '-vf', `scale=320:-1,tile=${cols}x${rows}:padding=4:margin=6`,
      '-frames:v', '1', sheetFile,
    ], { timeout: 30000, windowsHide: true, stdio: 'pipe' });
    if (fs.existsSync(sheetFile)) sheet = sheetFile;
  } catch {
    // 拼图失败不影响单帧；调用方仍能拿到路径。
  }

  // 抽完只留 jpg，视频分片/合并文件删掉，避免每次抽帧都留几十 MB。
  for (const f of [...parts, videoFile, path.join(dir, 'concat.txt')]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }

  return { info, play, dir, files, sheet, actualDuration: actual };
}

function readCredentials() {
  try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); } catch { return {}; }
}

function imageFileForOneBot(localFile) {
  const buf = fs.readFileSync(localFile);
  return `base64://${buf.toString('base64')}`;
}

/** 下载封面到本地。OneBot 对远程 URL 的抓取经常 fetch failed，本地 base64 最稳。 */
async function localCover(info) {
  if (!info.cover) return undefined;
  fs.mkdirSync(COVER_DIR, { recursive: true });
  const out = path.join(COVER_DIR, `${info.bvid}.jpg`);
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    const res = await safeFetch(info.cover, { headers: HEADERS, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!res.ok) throw new Error(`封面下载 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('封面下载为空');
    fs.writeFileSync(out, buf);
  }
  return out;
}

async function snowlumaSend(message, { target = 'private', groupId, userId } = {}) {
  const cfg = readCredentials();
  const httpUrl = String(cfg.httpUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const token = String(cfg.accessToken || '');
  const toUser = String(userId || cfg.ownerQQ || '');
  const toGroup = String(groupId || cfg.shareGroupId || '');
  if (!token) throw new Error('SnowLuma accessToken 未配置');
  const body = target === 'group'
    ? { group_id: Number(toGroup), message }
    : { user_id: Number(toUser), message };
  if (target === 'group' && !toGroup) throw new Error('群号未配置');
  if (target !== 'group' && !toUser) throw new Error('ownerQQ 未配置');
  const endpoint = target === 'group' ? 'send_group_msg' : 'send_private_msg';
  const res = await safeFetch(`${httpUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.status && data.status !== 'ok') || data.retcode) {
    throw new Error(`SnowLuma 发送失败 HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function shareTo(bvid, { target = 'private', groupId } = {}) {
  const info = await videoInfo(bvid);
  const text = `${info.title}\n${info.author} · ${info.url}`;
  const message = [];
  let cover;
  try {
    cover = await localCover(info);
  } catch {
    // 封面拉不到就只发文字；不要让整条分享失败。
    cover = undefined;
  }
  if (cover) message.push({ type: 'image', data: { file: imageFileForOneBot(cover) } });
  message.push({ type: 'text', data: { text } });
  const sent = await snowlumaSend(message, { target, groupId });
  return { info, sent, text, target, groupId: groupId || undefined };
}

/** 发封面 + 标题 + 链接到 owner 私聊。 */
export async function shareToOwner(bvid) {
  return shareTo(bvid, { target: 'private' });
}

/** 发到指定会话；群聊用本地 base64，避免 OneBot 拉远程封面失败。 */
export async function shareToTarget(bvid, target = 'private', groupId) {
  return shareTo(bvid, { target, groupId });
}
