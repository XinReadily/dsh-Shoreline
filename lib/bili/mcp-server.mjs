#!/usr/bin/env node
/**
 * 零依赖 MCP server（stdio）：B 站游客态查询 + 抽帧 + 观看记录 + QQ 分享。
 * 不登录 B 站；所有写操作只落在本机 state/bili-feed。
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { hot, search, video, danmaku, week } from './bili.mjs';
import { videoInfo, frames, shareToTarget } from './bili-extra.mjs';
import { transcribe } from './transcript.mjs';
import { getConfig, recordCall, recordView, readHistory, readLogs } from './store.mjs';

const SERVER_NAME = 'dsh-bili-feed';
const SERVER_VERSION = '0.2.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'bili_hot',
    description: 'B站当前热门视频榜（标题、UP主、播放量、时长、分区、BV号）。想知道「今天B站在聊什么」就用这个。',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 50, description: '要几条，默认 12' },
      },
    },
  },
  {
    name: 'bili_search',
    description: '按关键词搜 B 站视频，返回标题/UP主/播放量/时长/BV号。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', minLength: 1, description: '搜索关键词' },
        page: { type: 'integer', minimum: 1, maximum: 50, description: '页码，默认 1' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'bili_video',
    description: '看某个视频的详情：标题、UP主、分区、时长、播放/弹幕/点赞/投币/收藏/评论数、简介、cid；会记入「刷过的视频」。这也是判断「这视频在讲什么」的第一手信息——标题+简介+UP 常常就够了，够了就别再抽帧。看完真想留点什么，用 memory_remember 记一条 video 类型，写它讲了什么、哪一刻有意思，不要只写「看了个视频」。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', minLength: 4, description: 'BV号，例如 BV1GJ411x7h7' },
      },
      required: ['bvid'],
    },
  },
  {
    name: 'bili_danmaku',
    description: '拉某个视频的弹幕，返回「刷得最多的句子」和「末尾最新的句子」——用来感受观众的真实反应。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', minLength: 4, description: 'BV号' },
        top: { type: 'integer', minimum: 1, maximum: 50, description: '取几条高频弹幕，默认 12' },
      },
      required: ['bvid'],
    },
  },
  {
    name: 'bili_week',
    description: 'B站「每周必看」精选榜。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bili_transcript',
    description: '把视频「说的话」取出来：先找 B 站的 CC 字幕，有就直接返回全文（很便宜）；没有再用本地 whisper 下音轨转写（几十秒到几分钟，另占 CPU）。**和 bili_frames 一样，别每个视频都调**：标题、简介、弹幕、评论能说清就不用听声音；只有内容全在语音里（讲解、闲聊、杂谈、教程口播）才用。下载的音频转写完即删。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', minLength: 4, description: 'BV号' },
      },
      required: ['bvid'],
    },
  },
  {
    name: 'bili_frames',
    description: '对某个视频抽帧看图（游客态下载 360P + 本地 ffmpeg），返回缩略拼图和本地 jpg 路径/时间点；不需要 read_image。**别每个视频都调**：先用标题、简介、弹幕（bili_danmaku）、评论判断这视频在讲什么，说得清就不用抽；只有「画面本身就是内容」（MMD、手书、剧情向、绘画过程）或者文字信息确实不够时才用。下载的视频抽完即删，只留 jpg。count 不填按视频时长用面板里的分档值。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', minLength: 4, description: 'BV号' },
        count: { type: 'integer', minimum: 1, maximum: 40, description: '抽几张；不填按视频时长分档取默认值' },
      },
      required: ['bvid'],
    },
  },
  {
    name: 'bili_history',
    description: '查看小汐通过游客态刷过的视频记录（标题、UP主、时间、链接）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '返回几条，默认 20' },
      },
    },
  },
  {
    name: 'bili_share',
    description: '把某个视频的封面 + 标题 + 链接发到 QQ（游客态，不登录 B 站）。默认发主人私聊；target=group 时发到配置的群。受面板“允许分享”开关控制。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', minLength: 4, description: 'BV号' },
        target: { type: 'string', enum: ['private', 'group'], description: '发私聊还是群聊，默认 private' },
        groupId: { type: 'string', description: '群号；不填用面板配置的分享群' },
      },
      required: ['bvid'],
    },
  },
];

const int = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
};

const str = (v, name) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error(`${name} 不能为空`);
  return s;
};

function errorCode(e) {
  const m = String(e?.message ?? e).match(/(?:code=|HTTP )(-?\d+)/i);
  return m ? Number(m[1]) : undefined;
}

function textHistory(list) {
  if (!list.length) return '还没有刷过视频的记录。';
  const out = [`# 小汐刷过的视频（${list.length} 条，最近在前）`];
  list.forEach((v, i) => {
    out.push(`${i + 1}. ${v.title}\n   ${v.author || '?'} · ${new Date(v.lastSeenAt).toLocaleString('zh-CN')} · ${v.url}`);
  });
  return out.join('\n');
}

/** 工具分发：返回纯文本；抛错即 isError。 */
async function callTool(name, args = {}) {
  const cfg = getConfig();
  if (!cfg.enabled && name !== 'bili_history') throw new Error('B站游客态已关闭（去插件面板打开）');

  switch (name) {
    case 'bili_hot':
      return hot(int(args.count, 12, 1, 50));
    case 'bili_search':
      return search(str(args.keyword, 'keyword'), int(args.page, 1, 1, 50));
    case 'bili_video': {
      const bvid = str(args.bvid, 'bvid');
      const result = await video(bvid);
      const info = await videoInfo(bvid).catch(() => null);
      if (info) recordView(info);
      return result;
    }
    case 'bili_danmaku':
      return danmaku(str(args.bvid, 'bvid'), int(args.top, 12, 1, 50));
    case 'bili_week':
      return week();
    case 'bili_transcript': {
      const bvid = str(args.bvid, 'bvid');
      const r = await transcribe(bvid);
      recordView(await videoInfo(bvid).catch(() => null));
      const lines = [
        `# ${r.title || bvid}（${bvid}）${r.kind === 'subtitle' ? 'CC 字幕' : '语音转写'}`,
        r.chars && r.chars > r.text.length ? `（原文 ${r.chars} 字，这里截了前 ${r.text.length} 字）` : '',
        '',
        r.text || '（没听到内容）',
      ].filter(Boolean);
      return lines.join('\n');
    }
    case 'bili_frames': {
      if (!cfg.allowFrames) throw new Error('抽帧已关闭（去插件面板打开）');
      const bvid = str(args.bvid, 'bvid');
      const r = await frames(bvid, args.count === undefined ? undefined : int(args.count, 1, 1, 40));
      recordView(r.info);
      const lines = [`# ${r.info.title}（${r.info.bvid}）抽帧 ${r.files.length} 张`];
      r.files.forEach((f, i) => lines.push(`${i + 1}. ${f.time} · ${f.path}`));
      lines.push(`视频：${r.info.url}`);
      return { text: lines.join('\n'), sheet: r.sheet };
    }
    case 'bili_history':
      return textHistory(readHistory(int(args.limit, 20, 1, 100)));
    case 'bili_share': {
      if (!cfg.allowShare) throw new Error('分享到 QQ 已关闭（去插件面板打开）');
      const target = args.target === 'group' ? 'group' : 'private';
      const groupId = args.groupId ? String(args.groupId) : undefined;
      const r = await shareToTarget(str(args.bvid, 'bvid'), target, groupId);
      recordView(r.info);
      return `已把封面和链接发到${target === 'group' ? `群 ${groupId || cfg.shareGroupId}` : '主人私聊'}：\n${r.info.title}\n${r.info.url}`;
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

async function loggedCall(name, args) {
  const started = Date.now();
  const base = {
    tool: name,
    args: {
      bvid: args?.bvid,
      keyword: args?.keyword,
      count: args?.count,
      limit: args?.limit,
    },
  };
  try {
    const result = await callTool(name, args);
    const text = typeof result === 'string' ? result : String(result?.text || '');
    recordCall({ ...base, ms: Date.now() - started, ok: true, chars: text.length });
    return result;
  } catch (e) {
    recordCall({
      ...base,
      ms: Date.now() - started,
      ok: false,
      code: errorCode(e),
      error: String(e?.message ?? e).slice(0, 300),
    });
    throw e;
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  if (isNotification) return;

  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    reply(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }

  if (method === 'ping') {
    reply(id, {});
    return;
  }

  if (method === 'tools/list') {
    reply(id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    try {
      const result = await loggedCall(name, params?.arguments ?? {});
      const text = typeof result === 'string' ? result : String(result?.text || '');
      const content = [{ type: 'text', text }];
      if (result && typeof result === 'object' && result.sheet) {
        content.push({
          type: 'image',
          data: readFileSync(result.sheet).toString('base64'),
          mimeType: 'image/jpeg',
        });
      }
      reply(id, { content });
    } catch (e) {
      reply(id, { content: [{ type: 'text', text: `${name} 失败：${e?.message ?? e}` }], isError: true });
    }
    return;
  }

  replyError(id, -32601, `不支持的 method：${method}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  Promise.resolve(handle(msg)).catch((e) => {
    if (msg && msg.id !== undefined && msg.id !== null) {
      replyError(msg.id, -32603, String(e?.message ?? e));
    }
  });
});
rl.on('close', () => {
  process.exitCode = 0;
});
