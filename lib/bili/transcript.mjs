import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { biliJson, biliDownload } from './net.mjs';
import { videoInfo, playUrl, findFfmpeg, mediaRoot } from './bili-extra.mjs';

// 听视频的两条路：先看 B 站有没有 CC 字幕（几乎不用下载），没有才下音轨转写。
// 转写引擎是 faster-whisper 的便携版。路径优先用面板「B站 → 视频声音转写」里配的，
// 没配就用默认的 D:\dsh-data\whisper——面板改了要立刻生效，所以每次调用才解析。

const DEFAULT_WHISPER_DIR = process.env.SHORELINE_WHISPER_DIR || path.join('D:', 'dsh-data', 'whisper');

function voiceAsr() {
  try {
    const file = path.join(os.homedir(), '.dsh', 'shoreline', 'voice.json');
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    return data && typeof data.asr === 'object' && data.asr ? data.asr : {};
  } catch {
    return {};
  }
}

export function whisperPaths() {
  const asr = voiceAsr();
  const python = String(asr.python || '').trim()
    || path.join(DEFAULT_WHISPER_DIR, 'python', process.platform === 'win32' ? 'python.exe' : 'python');
  const script = String(asr.script || '').trim() || path.join(DEFAULT_WHISPER_DIR, 'transcribe.py');
  return { python, script };
}

export function transcribeReady() {
  const { python, script } = whisperPaths();
  return fs.existsSync(python) && fs.existsSync(script);
}

async function api(url) {
  const body = await biliJson(url);
  if (body.code !== 0) throw new Error(`code=${body.code} ${body.message || ''}`);
  return body.data;
}

async function readSubtitle(bvid, cid) {
  if (!cid) {
    const info = await videoInfo(bvid);
    cid = info.cid;
  }
  const d = await api(`https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`);
  const list = d?.subtitle?.subtitles || [];
  if (!list.length) return null;
  const pick = list.find((s) => String(s.lan || '').startsWith('zh')) || list[0];
  const raw = pick.subtitle_url || pick.url || '';
  const url = raw.startsWith('//') ? `https:${raw}` : raw;
  if (!url) return null;
  const body = await biliJson(url);
  const text = (body.body || []).map((x) => x.content).join('').replace(/\s+/g, ' ').trim();
  return { lan: pick.lan || '', text };
}

function run(cmd, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('处理超时'));
    }, timeout);
    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { err += c.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().slice(-400) || `${path.basename(cmd)} 退出码 ${code}`));
    });
  });
}

export async function transcribe(bvid, { maxChars = 12000 } = {}) {
  const info = await videoInfo(bvid);
  const sub = await readSubtitle(bvid, info.cid).catch(() => null);
  if (sub && sub.text.length >= 20) {
    return {
      ok: true,
      kind: 'subtitle',
      bvid,
      title: info.title,
      lan: sub.lan,
      text: sub.text.slice(0, maxChars),
      chars: sub.text.length,
      totalChars: sub.text.length,
      duration: info.duration,
    };
  }
  if (!transcribeReady()) {
    throw new Error('这个视频没有 CC 字幕，转写引擎也没装好');
  }

  const dir = path.join(mediaRoot(), 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const videoFile = path.join(dir, `${bvid}-${stamp}.mp4`);
  const wavFile = path.join(dir, `${bvid}-${stamp}.wav`);

  try {
    const play = await playUrl(bvid, info.cid, 16);
    const candidates = (play.parts && play.parts[0]) || play.urls || [];
    let lastErr = null;
    for (const url of candidates) {
      try {
        await biliDownload(url, videoFile);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    if (!fs.existsSync(videoFile) || fs.statSync(videoFile).size < 10240) {
      throw new Error('视频没下下来');
    }

    // 有 ffmpeg 就抽成 16k wav；没有就直接把原文件交给 whisper——它自带的 av 能解 mp4/m4s/mp3，
    // 只是多花一点解码时间，不该因为缺一个外部程序就让整条转写不能用。
    let audioFile = videoFile;
    try {
      await run(findFfmpeg(), ['-y', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wavFile], { timeout: 180000 });
      audioFile = wavFile;
    } catch {
      audioFile = videoFile;
    }
    const { python, script } = whisperPaths();
    const raw = await run(python, [script, audioFile], { timeout: 900000 });
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
    if (!parsed.ok) throw new Error(parsed.error || '转写失败');
    return {
      ok: true,
      kind: 'whisper',
      bvid,
      title: info.title,
      text: String(parsed.text || '').slice(0, maxChars),
      chars: String(parsed.text || '').length,
      totalChars: String(parsed.text || '').length,
      chunks: (parsed.chunks || []).slice(0, 80),
      duration: parsed.duration || info.duration,
      model: parsed.model || '',
    };
  } finally {
    for (const f of [videoFile, wavFile]) {
      try { fs.rmSync(f, { force: true }); } catch {}
    }
  }
}
