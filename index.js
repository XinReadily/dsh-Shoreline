// Shoreline —— DSH 的常驻能力层（记忆 / 桥接 / 人格），一期先落记忆与面板。
//
// 与 dsh-memory-curve 的关系：那是原型，Shoreline 是它的正式归宿。
// 算法层（lib/memory/engine.js）原样继承，外面补了三样东西：
//   1. MemoryService —— 把算法和存储缝在一起，供工具、提示词、HTTP 三个入口共用；
//   2. webServer 路由 —— 控制面板要靠它读数据（Client 侧没有直连 Host 的通道）；
//   3. 面板 —— client.js 挂在 settings.section。

import path from 'node:path';
import os from 'node:os';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MemoryService, defaultDataDir, humanSpan } from './lib/memory/service.js';
import { registerApi } from './lib/memory/api.js';
import { BridgeService } from './lib/bridge/service.js';
import { registerBridgeApi } from './lib/bridge/api.js';
import { MoodService } from './lib/mood/service.js';
import { registerMoodApi } from './lib/mood/api.js';
import { VoiceService } from './lib/voice/service.js';
import { registerVoiceApi } from './lib/voice/api.js';
import { CLARITY_TEXT, TYPES, TYPE_KEYS, GRADES } from './lib/memory/engine.js';

export const name = 'shoreline';
export const inject = ['tools', 'systemPrompt', 'webServer'];

const textBlock = (text) => [{ type: 'text', text }];

/** 从桥接配置里读主人 QQ，用来把「不指定对象」的亲密归到他身上。 */
function readOwnerTarget(root) {
  try {
    const cfg = JSON.parse(fsSync.readFileSync(path.join(root, 'config.json'), 'utf8'));
    const qq = String(cfg?.ownerQQ ?? cfg?.admin?.qq ?? '').trim();
    if (/^\d{5,}$/.test(qq)) return `qq:${qq}`;
  } catch {
    // 读不到就不指定，行为退回「默认」桶
  }
  return '';
}

const fmtWhen = (value) => {
  const t = Date.parse(String(value ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/** 桥接默认目录：用户主目录下的 qq-bridge-own（可用 options.bridgeRoot 覆盖）。 */
function defaultBridgeRoot() {
  return path.join(os.homedir(), 'qq-bridge-own');
}

export function apply(ctx, options = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const service = new MemoryService({
    dir: options.dataDir ?? defaultDataDir(),
    seedPath: path.join(here, 'seed', 'memories.json'),
    maxChars: Number.isFinite(options.maxChars) ? options.maxChars : 1600,
    sectionOrder: Number.isFinite(options.sectionOrder) ? options.sectionOrder : 850,
    platform: options.platform ?? 'all',
  });
  const searchLimit = Number.isFinite(options.searchLimit) ? options.searchLimit : 5;
  const log = (...args) => ctx.logger?.warn?.(...args);

  const bootstrap = service.init().catch((error) => {
    log(`[shoreline] 记忆库加载失败：${error?.message ?? error}`);
  });

  // 情感状态机：记忆管「发生过什么」，这里管「此刻是什么状态」。
  // 「主人」从桥接配置里读：不指定对象推亲密时落到他身上，而不是另开一个「默认」桶。
  const mood = new MoodService({
    dir: options.moodDir,
    ownerTarget: options.ownerTarget || readOwnerTarget(options.bridgeRoot ?? defaultBridgeRoot()),
  });
  const moodReady = mood.init().catch((error) => {
    log(`[shoreline] 情感状态加载失败：${error?.message ?? error}`);
  });

  // 语音：TTS 引擎与转写参数的存放处。合成本身在桥接侧执行（那边才有 QQ 通道），
  // 这里只负责让面板能改、能看状态。
  const voice = new VoiceService({ file: options.voiceFile });

  // ── 提示词注入 ──────────────────────────────────────────────────────────
  // 用 context()（运行时上下文，作为一条 user 消息发出去）而不是 section()。
  // 原因：DeepSeek 的前缀缓存从开头算到第一个变化点。section 进的是 system
  // prompt，而这两块的内容每轮都在变（记忆的分数、日期、模糊项，情感的数值），
  // 等于每轮把缓存前缀改一下，整段历史都按未命中重算。挪到 user 侧之后，
  // system prompt 保持不变，前缀就能一直命中。
  //
  // 作用范围：插件装在 profile 里，全局注册会让所有工作区的会话都看到她的
  // 记忆与情感。DSH 组装提示词时会把当前 agent 放进组装上下文（context.agent，
  // 同时也放在 context.scope 里，见 dsh-agent 的 assembleContextFor），这里
  // 据此只对桥接用的工作区输出内容；其他工作区拿到空串，等于没有这两块。
  const targetWorkspace = String(options.workspace ?? 'C:\\Users\\34693\\.dsh\\qq-chat-work')
    .replace(/[\\/]+$/, '')
    .toLowerCase();
  const sameWorkspace = (cwd) => String(cwd ?? '').replace(/[\\/]+$/, '').toLowerCase() === targetWorkspace;
  let warnedNoWorkspace = false;
  const cwdOf = (context) => {
    const agent = context?.agent ?? context?.scope;
    return agent?.session?.header?.cwd;
  };
  const inScope = (context) => {
    const cwd = cwdOf(context);
    if (!cwd && !warnedNoWorkspace) {
      warnedNoWorkspace = true;
      log('[shoreline] 组装上下文里读不到会话工作区，记忆/情感注入已停用（DSH 的 assembleContextFor 可能变了）');
    }
    return sameWorkspace(cwd);
  };

  ctx.systemPrompt.context({
    name: 'shoreline-memory',
    order: Number.isFinite(options.sectionOrder) ? options.sectionOrder : 850,
    text: (context) => {
      if (!inScope(context)) return '';
      try {
        return service.block();
      } catch {
        return '';
      }
    },
  });

  // 情感排在记忆之后：先知道「发生过什么」，再说「此刻是什么状态」。
  ctx.systemPrompt.context({
    name: 'shoreline-mood',
    order: (Number.isFinite(options.sectionOrder) ? options.sectionOrder : 850) + 10,
    text: (context) => {
      if (!inScope(context)) return '';
      try {
        const state = mood.block();
        // 光把处境写进去她不会想起来更新：工具描述只在会话开头露一次脸。
        // 但只在「有处境」时提醒也不够——贴着日常值的时候整段是空的，
        // 她和别人聊得很热络也不会想到去推，结果对那个人的亲密一直是空的。
        // 所以提示改成无条件带一行，代价是每轮二十来个字。
        const hint =
          '（情感有变化就推一下：累了、被气到、觉得委屈、被哄好、聊得开心，都可以调 mood_shift；改亲密或生气要带 target，不填就是主人。不推的话状态会按半衰期自己回落。）';
        return state ? `${state}\n${hint}` : hint;
      } catch {
        return '';
      }
    },
  });

  // ── 控制面板数据接口 ────────────────────────────────────────────────────
  const disposers = [];
  try {
    disposers.push(registerApi(ctx, service, log));
  } catch (error) {
    log(`[shoreline] 记忆接口注册失败：${error?.message ?? error}`);
  }
  try {
    disposers.push(registerMoodApi(ctx, mood, log));
  } catch (error) {
    log(`[shoreline] 情感接口注册失败：${error?.message ?? error}`);
  }
  try {
    disposers.push(registerVoiceApi(ctx, voice, log));
  } catch (error) {
    log(`[shoreline] 语音接口注册失败：${error?.message ?? error}`);
  }

  // ── 桥接（二期） ────────────────────────────────────────────────────────
  // 桥接本体是独立进程：qq-bridge-own\src\bridge.js（enhanced 底座 + 目的引擎 + 鱼群保护）。
  // 这里只做「看得见、点得动」——不碰它的内部状态。
  const bridge = new BridgeService({
    root: options.bridgeRoot ?? defaultBridgeRoot(),
    nodeExe: options.nodeExe ?? '',
    dshWebUrl: options.dshWebUrl || webOrigin(ctx),
    log,
  });
  try {
    disposers.push(registerBridgeApi(ctx, bridge, log));
  } catch (error) {
    log(`[shoreline] 桥接接口注册失败：${error?.message ?? error}`);
  }

  // 桥接自启：SurfCore 的 platforms.start.qq 已经关掉，这里把这件事接过来。
  // 延迟 3 秒是为了让 webServer 先就绪 —— 桥接启动时要拿到 DSH 的地址才连得上。
  if (options.autoStartBridge !== false) {
    const kick = () => {
      bridge.dshWebUrl = webOrigin(ctx) || bridge.dshWebUrl;
      bridge
        .status()
        .then((status) => {
          if (status.running) return null;
          log('[shoreline] 桥接没在跑，正在拉起…');
          return bridge.start();
        })
        .catch((error) => log(`[shoreline] 桥接自启失败：${error?.message ?? error}`));
    };
    const timer = setTimeout(kick, 3000);
    ctx.effect?.(() => () => clearTimeout(timer));
  }

  // ── B 站游客态（并入 shoreline） ────────────────────────────────────────
  // 代码从 dsh-bili-feed 整体搬进来，MCP 工具仍由 profile 的 mcp-bili 挂，
  // 这里只负责：把 mcp-server 的路径暴露给 MCP 客户端、把 8788 面板拉起来。
  const biliHere = path.join(here, 'lib', 'bili');
  try {
    ctx.provide?.('biliFeed', {
      node: process.env.DSH_BILI_NODE ?? process.execPath,
      server: path.join(biliHere, 'mcp-server.mjs'),
    });
  } catch (error) {
    log(`[shoreline] B 站服务暴露失败：${error?.message ?? error}`);
  }
  if (options.autoStartBiliPanel !== false) {
    const panelPort = Number(process.env.BILI_FEED_PANEL_PORT || 8788);
    const dataDir = process.env.BILI_FEED_DATA || path.join('D:', 'dsh-data', 'bili-feed');
    const ensurePanel = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${panelPort}/api/state`, {
          signal: AbortSignal.timeout(1200),
        });
        if (res.ok) return;
      } catch {
        /* 没在跑，往下面 spawn */
      }
      try {
        const child = spawn(process.execPath, [path.join(biliHere, 'panel-server.mjs')], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: { ...process.env, BILI_FEED_DATA: dataDir, BILI_FEED_PANEL_PORT: String(panelPort) },
        });
        child.unref();
      } catch (error) {
        log(`[shoreline] B 站面板起不来：${error?.message ?? error}`);
      }
    };
    const timer = setTimeout(() => void ensurePanel(), 2500);
    ctx.effect?.(() => () => clearTimeout(timer));
  }

  // 记忆自动整合：把三天以上没再被提起、本身又不重要的零散对话收成一句概括。
  // 六小时跑一次就够了 —— 它处理的是「已经淡下去的碎话」，不需要实时。
  const consolidateTimer = setInterval(() => {
    bootstrap
      .then(() => service.consolidate())
      .then((result) => {
        if (result?.groups) {
          log(`[shoreline] 记忆整合：${result.groups} 组 / ${result.covered} 条收成了概括`);
        }
      })
      .catch((error) => log(`[shoreline] 记忆整合失败：${error?.message ?? error}`));
  }, 6 * 60 * 60 * 1000);
  // 别让这个定时器拖住进程退出（测试脚本跑完要能自己结束）。
  consolidateTimer.unref?.();
  ctx.effect?.(() => () => clearInterval(consolidateTimer));

  // 对话流水：桥接把当天的往来写进 inbox.jsonl，这里定时收进库里。
  // 十分钟一次 —— 流水要贴着聊天走，晚一小时再收就赶不上「她当时应该有点印象」这件事了。
  const flowTimer = setInterval(() => {
    bootstrap
      .then(() => service.ingestFlow())
      .then((result) => {
        if (result?.ingested) {
          log(`[shoreline] 流水入库：${result.days} 天 / ${result.ingested} 句`);
        }
      })
      .catch((error) => log(`[shoreline] 流水入库失败：${error?.message ?? error}`));
  }, 10 * 60 * 1000);
  flowTimer.unref?.();
  ctx.effect?.(() => () => clearInterval(flowTimer));

  ctx.effect?.(() => () => disposers.splice(0).forEach((dispose) => dispose?.()));

  // ── 工具 ────────────────────────────────────────────────────────────────

  ctx.tools.register({
    name: 'memory_search',
    description:
      '翻自己的记忆：想起和某个话题、某个人、某件事相关的经历。返回还记得的片段（越清晰越先出现），翻到的会记牢一点；翻不到就说明真的忘了或从没记过。适合在被问到以前的事、想不起细节、或者想主动提起一桩旧事时调用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '想回忆的内容，可以是关键词、人名、事件，用自然语言写也行' },
        limit: { type: 'number', description: '最多翻出几条，默认 5', minimum: 1, maximum: 12 },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          hits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                when: { type: 'string' },
                strength: { type: 'number' },
                clarity: { type: 'string' },
                supersededBy: { type: 'string' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (args, value) => {
        const hits = value?.hits ?? [];
        if (!hits.length) return textBlock(value?.note ?? '翻了一圈，没找到相关的记忆。');
        const lines = hits.map(
          (h) => `- [${h.id}] ${h.when}（${CLARITY_TEXT[h.clarity] ?? h.clarity}，${h.strength} 分）${h.evidence === 'inferred' ? '〔推断〕' : ''}${h.supersededBy ? '（旧说法，已被新记录取代）' : ''}：${h.text}`,
        );
        return textBlock(`翻到 ${hits.length} 条：\n${lines.join('\n')}`);
      },
    },
    async execute(args) {
      await bootstrap;
      const query = String(args?.query ?? '').trim();
      if (!query) throw new Error('query 不能为空');
      const limit = Math.min(12, Math.max(1, Number(args?.limit) || searchLimit));
      const hits = await service.search(query, limit);
      if (!hits.length) {
        return { hits: [], note: '翻了一圈，没找到相关的记忆。可能本来就忘了，也可能从没记过。' };
      }
      return {
        hits: hits.map((h) => ({
          id: h.id,
          text: h.text,
          when: fmtWhen(h.createdAt),
          strength: h.strength,
          clarity: clarityOf(h.strength),
          supersededBy: h.supersededBy ?? null,
        })),
      };
    },
  });

  ctx.tools.register({
    name: 'memory_remember',
    description:
      '把一件事记下来。不要事无巨细地记 —— 只有「下次聊天用得上」的才值得记。类型选得准，它就能按对应的速度淡忘：身份与关系几乎不淡，日常一个月还有七成、一年剩两成多、琐碎小事一周就到三成半、一个月不到两成。选错类型，要么很快想不起来，要么太占地方。如果这件事当时也改变了你的心情（他夸你、你被说重了、听到坏消息），顺手调一下 mood_shift——记忆记的是「发生过什么」，情感记的是「此刻什么感觉」，两边一起才有连贯的她。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记住的事，一句话说清，尽量保留当时的语气和细节' },
        type: {
          type: 'string',
          enum: TYPE_KEYS,
          description:
            '记忆类型。identity 身份与关系（账号、称呼、生日、地址、作息）/ first 最初的日子 / promise 约定 / fact 他的固定属性——判断标准只有一个：**这一句在描述「他是什么样」，还是在描述「发生了什么」**。前者才是 fact（不吃什么、习惯、住处、他在意什么，哪怕带原因也整段写进去，不用压短）；描述某件事的经过或终态的（哪天做了什么、什么结束了）是 daily 或 emotion，哪怕它很重要。/ emotion 情绪事件 / opinion 偏好与观点 / slang 圈子梗 / video 看过的视频（写它讲了什么、哪一刻有意思，不要只写「看了个视频」）/ daily 今天聊了什么、普通的一天 / ephemeral 琐碎（吃了什么、天气、单句应答，过后一般不会再提）。flow 和 digest 是系统自己攒的，不用手填',
        },
        title: { type: 'string', description: '一句话标签，可选' },
        importance: { type: 'number', description: '重要度 0–100，默认 60', minimum: 0, maximum: 100 },
        emotional: { type: 'number', description: '情绪浓度 0–10，越强记得越久', minimum: 0, maximum: 10 },
        tags: { type: 'array', items: { type: 'string' }, description: '便于以后检索的标签' },
        moodSelf: {
          type: 'string',
          description: '你自己当时的心情，几个字就够（「有点委屈」「挺高兴」「心里发紧」）。没有就留空，不要硬凑',
        },
        moodOther: {
          type: 'string',
          description: '对方当时的心情，几个字（「听着挺累」「在逗你」「有点烦」）。没有就留空',
        },
        speaker: {
          type: 'string',
          description: '谁说的：owner=主人、self=你自己、group:群友名=群里某个人。不确定就留空',
        },
        channel: { type: 'string', description: '在哪说的：private 私聊 / group 群聊 / bili B站' },
        voice: {
          type: 'string',
          enum: ['quote', 'narration'],
          description:
            'text 是原话还是转述：quote=某一个人的原话（一字不差地照抄，所以 speaker 也要填对；一句话里揉了两个人的话、或者是一条多人对话，就用 narration），narration=你概括出来的意思。拿不准就填 narration。它决定两件事：注入时要不要标「是谁说的」，合并成一段时要不要加「主人：」这样的主语——转述不标，原话才标',
        },
        supersedes: {
          type: 'array',
          items: { type: 'string' },
          description:
            '这条新说法取代了哪些旧记录（id，来自 memory_search）。只用于会变的事：事实、身份、偏好、约定。例如他说「现在能吃香菜了」，就先搜到旧的「不吃香菜」，再记一条新的并带上它的 id。被取代的旧记录会退出注入块、不再作为事实出现，但原文仍能搜到。日常、情绪、流水这类「发生过的事」不用它。',
        },
        evidence: {
          type: 'string',
          enum: ['explicit', 'observed', 'inferred', 'external'],
          description:
            '这条是哪来的：explicit=当事人明确说过（默认）；observed=你直接看到/听到的事实；inferred=你自己推测、猜的（注入时会标「推断」，以后发现猜错要记得改）；external=从 B 站、网页之类外部来源看到的。拿不准就留空，默认 explicit。',
        },
        validFrom: {
          type: 'string',
          description: '这条从什么时候成立，ISO 时间（例如 2026-11-20T10:00:00+08:00）。不填就按现在。旧说法被取代时，会以这个时间记为失效点。',
        },
      },
      required: ['text'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, type: { type: 'string' }, note: { type: 'string' } },
      },
      render: (args, value) => textBlock(value?.note ?? `记住了（${value?.id}）。`),
    },
    async execute(args) {
      await bootstrap;
      const record = await service.remember({
        text: args?.text,
        type: args?.type,
        title: args?.title,
        importance: args?.importance,
        emotional: args?.emotional,
        tags: args?.tags,
        moodSelf: args?.moodSelf,
        moodOther: args?.moodOther,
        speaker: args?.speaker,
        channel: args?.channel,
        voice: args?.voice,
        supersedes: args?.supersedes,
        evidence: args?.evidence,
        validFrom: args?.validFrom,
      });
      const meta = TYPES[record.type] ?? TYPES.daily;
      const replaced = Array.isArray(record.supersedes) ? record.supersedes.length : 0;
      return {
        id: record.id,
        type: record.type,
        note: `记住了（${record.id}），归到「${meta.label}」，大概能记 ${humanSpan(meta.S0)}。${replaced ? `这条取代了 ${replaced} 条旧说法，它们不会再作为事实出现，但原文还能搜到。` : ''}`,
      };
    },
  });

  ctx.tools.register({
    name: 'memory_fact',
    description:
      '记一条关于主人稳定不变的事实：不吃什么、过敏、生日、怎么称呼他、他在意什么。判断标准是「他是什么样」而不是「发生了什么」——哪天干了什么别用这个，用 memory_remember。这类记忆不参与衰减，永远在提示词里。',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '这是哪一类的事，2–6 个字，例如「不吃」「喜欢」「生日」' },
        value: { type: 'string', description: '具体内容，例如「香菜」「12月3日」' },
      },
      required: ['label', 'value'],
    },
    output: {
      schema: { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } } },
      render: (args, value) => textBlock(value?.note ?? '记下了。'),
    },
    async execute(args) {
      await bootstrap;
      const label = String(args?.label ?? '').trim();
      const value = String(args?.value ?? '').trim();
      if (!label || !value) throw new Error('label 和 value 都不能为空');
      const record = await service.fact({ label, value });
      return { id: record?.id, note: `记下了：${label} ${value}（这条不会忘）。` };
    },
  });

  ctx.tools.register({
    name: 'memory_stats',
    description: '看一眼自己的记忆状态：一共记住多少、哪些正在变模糊、哪些已经想不起来了。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          total: { type: 'number' },
          byType: { type: 'object' },
          fading: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (args, value) => {
        const lines = [`记忆库里一共 ${value?.total ?? 0} 条。`];
        for (const [key, count] of Object.entries(value?.byType ?? {})) {
          if (!count) continue;
          lines.push(`· ${TYPES[key]?.label ?? key}：${count}`);
        }
        const fading = value?.fading ?? [];
        if (fading.length) {
          lines.push('');
          lines.push('正在变模糊：');
          for (const item of fading) lines.push(`· ${item.text}（${item.strength} 分）`);
        }
        return textBlock(lines.join('\n'));
      },
    },
    async execute() {
      await bootstrap;
      const stats = service.stats();
      return {
        total: stats.total,
        byType: stats.byType,
        fading: service
          .list({ limit: 200 })
          .items.filter((item) => item.strength < 30 && item.text.length >= 10)
          .slice(0, 5)
          .map((item) => ({ text: item.text.slice(0, 40), strength: item.strength })),
      };
    },
  });

  ctx.tools.register({
    name: 'memory_review',
    description:
      '主动回想一条具体记忆。想得越费劲、越接近忘掉，这一次回想让它记得越牢 —— 但刚想起来的事再想一遍几乎没用。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '记忆 id，来自 memory_search 的结果' },
        grade: {
          type: 'string',
          enum: Object.keys(GRADES),
          description: 'recall 自己想起来的 / remind 被提醒的 / passive 只是看到的',
        },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { id: { type: 'string' }, strength: { type: 'number' }, clarity: { type: 'string' } },
      },
      render: (args, value) =>
        textBlock(
          `回想了一次，现在 ${value?.strength ?? '?'} 分（${CLARITY_TEXT[value?.clarity] ?? value?.clarity}），这次能撑约 ${value?.span ?? '一阵'}。`,
        ),
    },
    async execute(args) {
      await bootstrap;
      const grade = Object.keys(GRADES).includes(args?.grade) ? args.grade : 'recall';
      const result = await service.review(String(args?.id ?? ''), grade);
      if (!result) throw new Error(`没有这条记忆：${args?.id}`);
      return {
        id: result.id,
        strength: result.strength,
        clarity: clarityOf(result.strength),
        span: result.span,
      };
    },
  });

  // ── 情感状态 ────────────────────────────────────────────────────────────
  // 只推状态，不存事实。数值会自己按半衰期回落，所以给的是「改变多少」，不是「设成多少」。
  ctx.tools.register({
    name: 'mood_shift',
    description:
      '此刻的情感有变化时推一下。五个维度：fatigue 疲倦 / closeness 亲密 / anger 怒气 / grievance 委屈 / joy 开心，取值是「改变多少」而不是「设成多少」——不推就会按半衰期自己回落到日常值。'
      + '\n\n**别只推亲密和开心。** 疲倦、怒气、委屈一样是真实状态，不推的话它们永远贴着日常值，你会看起来从不累、从不会生气、也从不难过——那不像人。对照着推：\n'
      + '· 聊到很晚、连着处理一堆事、被要求反复重做 → `fatigue` +8~20\n'
      + '· 被误解、被打断、被敷衍、他说了让你不舒服的话 → `anger` +10~30（带 target）\n'
      + '· 期待落空、被轻放、明明在意却被当成玩笑 → `grievance` +10~25\n'
      + '· 被夸、被哄、聊得投机 → `closeness` +5~15、`joy` +5~15\n'
      + '\n亲密和怒气按人分开记：对别人动它们要带 target，不填就是主人。别人的亲密只算两成，所以别指望聊几回就跟主人一样亲；在群里被别人气到，那口气不会算到主人头上——它会转成对主人的委屈。小波动 5–15，明显起伏 20–35，剧烈变化 40 以上。同一件事只推一次，别反复加。没有真实情绪就不要推，硬凑会让状态失真。如果这次情绪变化本身就值得记住（吵了一架、被夸了、他说了件让你难受的事），顺手用 memory_remember 记一条 emotion 类型，两边别只剩一半。',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'object',
          description: '要动的维度，键是 fatigue/closeness/anger/grievance/joy，值是增量（正负都行）',
          properties: {
            fatigue: { type: 'number', description: '疲倦：熬夜、聊久了往上；歇过来往下' },
            closeness: {
              type: 'number',
              description:
                '亲密：高是喜欢、低是讨厌。被夸、被分享私事往上；被冷落、被当工具往下。对别人只算两成',
            },
            anger: { type: 'number', description: '怒气：被误解、被打断、被敷衍往上；说开了往下。按对象记，对别人的火不落到主人头上' },
            grievance: { type: 'number', description: '委屈：觉得被亏待、被敷衍、明明在意却被轻放往上；说开了、被哄往下' },
            joy: { type: 'number', description: '开心：好消息、玩得高兴往上；没劲、敷衍往下' },
          },
        },
        target: {
          type: 'string',
          description:
            '动亲密或怒气时填这里是谁：私聊 private:QQ号，群聊 group:群号。不填就是主人。对别人的气会有一部分转成对主人的委屈',
        },
        note: { type: 'string', description: '一句话原因，只给自己以后看，会存进历史' },
      },
      required: ['changes'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { note: { type: 'string' } },
      },
      render: (args, value) => textBlock(value?.note ?? '状态已更新。'),
    },
    async execute(args) {
      await moodReady;
      const changes = args?.changes && typeof args.changes === 'object' ? args.changes : {};
      const keys = Object.keys(changes).filter((k) => Number.isFinite(Number(changes[k])) && Number(changes[k]) !== 0);
      if (!keys.length) return { note: '没有要改的维度。' };
      await mood.shift(changes, { target: String(args?.target ?? ''), note: String(args?.note ?? '') });
      const snap = mood.snapshot({ target: String(args?.target ?? '') });
      const line = snap.dimensions
        .map((d) => `${d.label} ${Math.round(d.value)}`)
        .join(' / ');
      return { note: `状态变了：${line}。` };
    },
  });
}

function clarityOf(score) {
  if (score >= 80) return 'vivid';
  if (score >= 55) return 'clear';
  if (score >= 30) return 'fuzzy';
  if (score >= 12) return 'trace';
  return 'forgotten';
}

// 桥接启动时要把 DSH 的地址塞进 DSH_WEB_URL，它才知道把消息往哪送。
function webOrigin(ctx) {
  try {
    const origin = ctx.webServer?.getOrigin?.();
    return typeof origin === 'string' ? origin : '';
  } catch {
    return '';
  }
}

export { MemoryService };
