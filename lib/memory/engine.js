// 记忆曲线引擎 —— 纯函数，不碰文件系统。
//
// 目标：用 100 分制模拟人类遗忘曲线，并且让「经常想起的事」忘得更慢。
//
// 核心模型（两层）：
//   1. 先验稳定度 S0：由记忆类型决定这条记忆「天生能撑多久」，身份类一年，
//      琐碎小事四小时。这是「不同话题遗忘速度不同」的落点。
//   2. 后验复习增益：每被想起一次，S 增长 S *= 1 + a·G·(1-R)。
//      增益 ∝ (1-R) 就是间隔效应 —— 快忘光的边缘被想起，涨得最多；
//      刚刚才提过的事再提一次，几乎不加分。
//
// 记忆强度 R 用幂律而非纯指数：(1 + Δt/S)^-b。
// 纯指数尾巴掉太快，现实里「很久以前的事突然想起来」需要长尾，幂律能给。

export const DAY_MS = 86_400_000;

/** 复习强度。grade 决定一次「想起」值多少增益。 */
export const GRADES = {
  recall: { key: 'recall', gain: 1.0, label: '主动回忆' },
  remind: { key: 'remind', gain: 0.55, label: '被提醒想起' },
  passive: { key: 'passive', gain: 0.12, label: '只是看到' },
};

/**
 * 记忆类型表。S0 单位是天，代表「这条记忆从 100 分掉到 50 分大约要多久」。
 * 数字不是拍脑袋：它们是可调的先验，用 Config.types 覆盖。
 */
export const TYPES = {
  identity: { S0: 400, label: '身份与关系', detail: '他是谁、我们是什么关系、怎么称呼' },
  first: { S0: 300, label: '最初的日子', detail: '第一次见面、开头那几天' },
  promise: { S0: 180, label: '约定', detail: '答应过的事、约好的时间' },
  fact: { S0: 0, label: '事实', detail: '他的固定属性：吃什么、不吃什么、习惯、住处、在意什么 —— 是「他是什么样」，不是「发生了什么」', noDecay: true },
  emotion: { S0: 45, label: '情绪事件', detail: '吵过、哭过、特别开心的一次' },
  opinion: { S0: 90, label: '偏好与观点', detail: '喜欢什么、讨厌什么、怎么看一件事' },
  slang: { S0: 20, label: '圈子梗', detail: '群里才懂的说法、梗图出处' },
  digest: { S0: 60, label: '合并', detail: '把几天里零散的对话并成一段' },
  flow: { S0: 1.5, label: '流水', detail: '当天的往来原话，自动攒的，忘得快但留痕' },
  video: { S0: 45, label: '看过的视频', detail: '看了什么、讲了什么 —— 记内容，不记「我看了个视频」' },
  daily: { S0: 7, label: '日常', detail: '今天聊了什么、普通的一天' },
  ephemeral: { S0: 0.25, label: '琐碎', detail: '随手一句、吃过什么、天气' },
};

export const TYPE_KEYS = Object.keys(TYPES);

/**
 * 可以被「新说法」取代的类型——只有会变的事才需要取代。
 * 事实、身份、偏好、约定：他说「现在可以吃香菜了」，旧的「不吃香菜」就该退场。
 * 日常 / 情绪 / 看过的东西 / 流水是「发生过的事」，不会因为后来的话而变假，不需要取代。
 */
export const SUPERSEDABLE_TYPES = ['fact', 'identity', 'opinion', 'promise'];

/** 使用证据的窗口和上限：同一件事 24 小时内只算一次，最多攒 3 次，避免反复提到就无限加强。 */
const ACTIVATION_GAP_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_CAP = 3;

/** 幂律指数。越小尾巴越长。0.5 与 FSRS 的 DECAY 同一量级。 */
const DECAY_POWER = 0.5;

/**
 * FSRS 的曲线缩放：让 Δt = S 时留存率正好是 90%，而不是 70.7%。
 * 这样「约能撑 N 天」才和字面意思对得上。19/81 来自 FSRS-6。
 */
const DECAY_FACTOR = 19 / 81;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toTime = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : fallback;
};

const iso = (time) => new Date(time).toISOString();

/** 这条记忆最后一次「被接触」的时间：创建或最后一次复习。 */
export function lastTouch(record) {
  return Math.max(toTime(record.createdAt, 0), toTime(record.lastReviewAt, 0));
}

/** 类型给的先验稳定度；importance / emotional 在同一维度上缩放它。 */
export function stabilityOf(record, types = TYPES) {
  if (record.noDecay) return Number.POSITIVE_INFINITY;
  const base = types[record.type] ?? types.daily;
  if (base.noDecay) return Number.POSITIVE_INFINITY;
  const s0 = Number(base.S0) > 0 ? Number(base.S0) : types.daily.S0;
  // 显式给过 stability 就以它为准（迁移 / 手工校正）。
  const stored = Number(record.stability);
  const seed = Number.isFinite(stored) && stored > 0 ? stored : s0;
  const importance = clamp(Number(record.importance) || 50, 0, 100);
  const emotional = clamp(Number(record.emotional) || 0, 0, 10);
  // 重要度和情绪只放大、不缩小：0.5 倍到 2 倍。
  const factor = (0.5 + importance / 100) * (1 + emotional / 10);
  return Math.max(0.05, seed * factor);
}

/**
 * 当前记忆强度，0–1（乘 100 就是百分制）。
 * 幂律：(1 + 19/81 · Δt / S)^-0.5 —— Δt = S 时正好 90%。
 */
export function retention(record, now = Date.now(), types = TYPES) {
  if (record.pinned) return 1;
  const S = stabilityOf(record, types);
  if (!Number.isFinite(S)) return 1;
  const dt = Math.max(0, now - lastTouch(record)) / DAY_MS;
  return Math.pow(1 + (DECAY_FACTOR * dt) / S, -DECAY_POWER);
}

/** 0–100 的强度分，直接给模型看。 */
export function strength(record, now = Date.now(), types = TYPES) {
  return Math.round(retention(record, now, types) * 1000) / 10;
}

/** 五档只用于「说人话」，不参与计算。 */
export function clarity(score) {
  if (score >= 80) return 'vivid';
  if (score >= 55) return 'clear';
  if (score >= 30) return 'fuzzy';
  if (score >= 12) return 'trace';
  return 'forgotten';
}

export const CLARITY_TEXT = {
  vivid: '记得很清楚',
  clear: '记得',
  fuzzy: '有点模糊',
  trace: '只剩个影子',
  forgotten: '基本忘了',
};

/**
 * 复习：改变的是 S（能撑多久），不是直接加分数。
 * 增益 ∝ (1-R) —— 这就是间隔效应。
 */
export function applyReview(record, grade = 'recall', now = Date.now(), types = TYPES) {
  const g = GRADES[grade] ?? GRADES.recall;
  // 被取代的旧说法是"作废"而不是"忘掉"：翻到它只说明看到了旧原文，
  // 不能把它重新激活、更不能再当成现行事实。否则搜一次旧事就复活了。
  if (record.state === 'superseded') {
    record.lastReviewAt = iso(now);
    return record;
  }
  const R = retention(record, now, types);
  const S = stabilityOf(record, types);
  if (!Number.isFinite(S)) {
    record.lastReviewAt = iso(now);
    return record;
  }
  // 1 + 1.8·G·(1-R)：快忘光时 (1-R)≈1，涨幅最大；刚看过时≈0。
  const gain = 1 + 1.8 * g.gain * (1 - R);
  const cap = Number(record.maxStability) > 0 ? Number(record.maxStability) : 3650;
  const next = Math.min(cap, S * gain);
  record.stability = Math.round(next * 1000) / 1000;
  record.lastReviewAt = iso(now);
  record.reviewCount = (Number(record.reviewCount) || 0) + 1;
  record.lastGrade = g.key;
  // 主动想起一条已经收进概括的原始对话 —— 说明它确实重要，解除收拢、单独留着。
  if (record.state === 'merged') record.mergedInto = null;
  record.state = 'active';
  return record;
}

/**
 * 使用证据：只有「真的被翻到、被想起、被引用」才加一点活跃度。
 * 关键约束：
 *   · 它不碰 stability / retention，衰减曲线原样不动 —— 它只影响「这一轮选谁进注入块」；
 *   · 同一件事 24 小时内只算一次，最多 3 次，反复提到不会一直变强。
 */
export function addActivation(record, now = Date.now()) {
  const last = toTime(record.lastActivatedAt, 0);
  if (last && now - last < ACTIVATION_GAP_MS) return record;
  record.activations = Math.min(ACTIVATION_CAP, (Number(record.activations) || 0) + 1);
  record.lastActivatedAt = iso(now);
  return record;
}

/** 软遗忘：不删除，只标记为「想不起来」。 */
export function settleState(record, now = Date.now(), types = TYPES) {
  if (record.pinned || record.noDecay) return record;
  // 「已收成概括」的原始对话保持原样，别被衰减流程改成 dormant。
  if (record.state === 'merged') return record;
  // 被取代的旧说法保持原样：它不是"淡忘了"，是"作废了"，不参与分数推断。
  if (record.state === 'superseded') return record;
  const score = strength(record, now, types);
  if (score < 6) record.state = 'dormant';
  else if (record.state === 'dormant' && score >= 20) record.state = 'active';
  return record;
}

// ── 检索 ────────────────────────────────────────────────────────────────────

const PUNCT = /[\s\p{P}\p{S}]+/gu;

function bigrams(text) {
  const clean = String(text ?? '').toLowerCase().replace(PUNCT, '');
  const set = new Set();
  if (clean.length <= 1) {
    if (clean) set.add(clean);
    return set;
  }
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
  return set;
}

/** 0–1 的相关性：query 的二元组有多少落在记忆正文/标题/标签里。 */
export function relevance(record, query) {
  const raw = String(query ?? '').trim().toLowerCase();
  if (!raw) return 0;
  const hayText = [
    record.title,
    record.text,
    (record.tags ?? []).join(' '),
    record.factLabel,
  ].filter(Boolean).join(' ').toLowerCase();
  // 单字查询（「海」「猫」）走子串匹配：bigram 集合里只有双字，
  // 以前输入一个字永远命中 0，看起来像搜索坏了。
  if (raw.length === 1) return hayText.includes(raw) ? 1 : 0;
  const q = bigrams(raw);
  if (!q.size) return 0;
  const hay = bigrams(hayText);
  if (!hay.size) return 0;
  let hit = 0;
  for (const gram of q) if (hay.has(gram)) hit += 1;
  return hit / q.size;
}

/**
 * 综合分：强度打底，相关性加权。
 * 相关性极高的（比如叫得出名字）额外抬一点，避免「很清晰但完全无关」压过来。
 */
export function scoreOf(record, query, now = Date.now(), types = TYPES) {
  const R = retention(record, now, types);
  const rel = query ? relevance(record, query) : 0;
  const base = R * (0.45 + 0.55 * rel);
  return base + (rel >= 0.75 ? 0.12 : 0);
}

export function search(
  records,
  query,
  { limit = 5, now = Date.now(), types = TYPES, includeDormant = true, includeSuperseded = true } = {},
) {
  const rows = [];
  for (const record of records) {
    if (!includeDormant && record.state === 'dormant') continue;
    if (!includeSuperseded && record.state === 'superseded') continue;
    const rel = relevance(record, query);
    if (rel <= 0) continue;
    // 被取代的旧说法还能翻到（"以前是这样说的"），但排在现行说法后面；
    // 这样她想起旧事时能看到原话，又不会拿旧说法当现在的事实。
    const score = scoreOf(record, query, now, types) * (record.state === 'superseded' ? 0.55 : 1);
    rows.push({ record, rel, score });
  }
  rows.sort((a, b) => b.score - a.score || b.rel - a.rel);
  return rows.slice(0, clamp(limit, 1, 50));
}

// ── 注入块 ──────────────────────────────────────────────────────────────────

const dayLabel = (time, now = Date.now()) => {
  const d = new Date(time);
  const n = new Date(now);
  const abs = `${d.getMonth() + 1}月${d.getDate()}日`;
  // 光有「11月8日」她得自己心算，算着算着就压成「昨天」了。
  // 直接把相对间隔写出来：今天 / 昨天 / N 天前 / N 周前。
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(n) - startOf(d)) / DAY_MS);
  if (days <= 0) return `${abs}（今天）`;
  if (days === 1) return `${abs}（昨天）`;
  if (days <= 6) return `${abs}（${days}天前）`;
  if (days <= 13) return `${abs}（1周前）`;
  if (days <= 20) return `${abs}（2周前）`;
  if (days <= 34) return `${abs}（${Math.round(days / 7)}周前）`;
  return abs;
};

function lineOf(record, now, types) {
  const s = strength(record, now, types);
  const tag = CLARITY_TEXT[clarity(s)];
  const when = dayLabel(toTime(record.createdAt, now), now);
  const body = String(record.text ?? record.title ?? '')
    .replace(/\r?\n+/g, '；')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (record.type === 'fact') return `- ${record.factLabel ?? '记得'}：${body}`;
  // 只有原话才标是谁说的：转述本身就是她概括过的，再贴一个「【主人·私聊】」反而像引用，
  // 而且转述里常掺着两个人的话，标一个人是错的。
  const who = record.voice === 'quote' ? whoOf(record) : '';
  // 情绪是回忆的钩子：同一件事，附上「那时候他听着挺累」，比只剩事情本身更容易被想起来。
  const moods = [record.moodOther ? `他当时${String(record.moodOther).slice(0, 20)}` : '', record.moodSelf ? `我${String(record.moodSelf).slice(0, 20)}` : '']
    .filter(Boolean)
    .join('，');
  const tail = moods ? `（${moods}）` : '';
  // 推断出来的事要能认出来：标三个字，代价小，但她说错话时能追溯到「这是我猜的」。
  const guess = record.evidence === 'inferred' ? '〔推断〕' : '';
  return `- ${when}（${tag}）${guess}${who}：${body.slice(0, 120)}${tail}`;
}

/**
 * 「谁、在哪说的」。不知道就返回空串——不猜，也不显示占位符。
 * 私聊和群聊要分开：群聊里主动翻私聊的事很别扭，她自己得知道边界。
 */
export function whoOf(record) {
  const sp = String(record.speaker ?? '').trim();
  const ch = String(record.channel ?? '').trim();
  if (sp.startsWith('group:')) {
    const name = sp.slice(6).trim();
    return `【群聊·${name || '别人'}】`;
  }
  if (sp === 'owner') return ch === 'group' ? '【主人·群聊】' : '【主人·私聊】';
  if (sp === 'self') return '【我】';
  if (sp === 'unknown') return '';
  if (ch === 'bili') return '【B站】';
  if (ch === 'group') return '【群聊】';
  if (ch === 'private') return '【私聊】';
  return '';
}

/**
 * 注入用的综合分：强度占六成，新近占四成。
 * 只按强度排，身份类会永远霸榜、最近聊的事挤不进来；
 * 只按新近排，重要但不常提的事会消失。两者混着才像人。
 */
export function injectScore(record, now = Date.now(), types = TYPES) {
  const s = strength(record, now, types) / 100;
  const days = Math.max(0, now - lastTouch(record)) / DAY_MS;
  const recency = Math.exp(-days / 10);
  // 使用证据只做小幅微调（最多 0.09），压不过强度和新近这两项：
  // 它回答的是「最近是不是真被翻出来用过」，不回答「还记不记得住」。
  const activation = Math.min(ACTIVATION_CAP, Number(record.activations) || 0) * 0.03;
  return 0.6 * s + 0.4 * recency + activation;
}

/**
 * 注入时的类型权重。强度只回答「多清楚」，不回答「值不值得提」。
 * 一句刚聊过的「蹲了一下午」再清楚也不该占掉「她说过想去看海」的位置。
 */
const TYPE_WEIGHT = {
  identity: 1.0,
  first: 1.0,
  promise: 1.0,
  fact: 1.0,
  emotion: 0.9,
  opinion: 0.8,
  slang: 0.6,
  digest: 0.85,
  video: 0.5,
  daily: 0.4,
  ephemeral: 0.12,
};

/**
 * 生成注入到提示词里的记忆块。
 * 原则：不是把卡倒进去，而是「此刻最该想起来的东西」。
 *   · 事实层永远在前（不用回忆的东西）；
 *   · 然后按强度×新近取高分的；
 *   · 最后留一两条「模糊边缘」，让她知道自己正在忘 —— 这是真人最真实的状态。
 */
export function renderBlock(records, { now = Date.now(), types = TYPES, maxChars = 1600, platform = 'all' } = {}) {
  const visible = records.filter(
    (r) =>
      (!platform || platform === 'all' || r.platform === 'all' || r.platform === platform) &&
      // 被取代的旧说法不进注入块：它已经"作废"了，还摆在【关于主人】里会让她说错话。
      // 原文仍在库里，靠 memory_search 能翻到。
      r.state !== 'superseded',
  );
  const facts = visible.filter((r) => r.type === 'fact');
  // 太短的碎片（「行」「对啊，怎么了」）不往提示词里放，但仍留在库里可被检索。
  const worthShowing = (r) => String(r.text ?? '').length >= 12;
  // 一次性闲聊几乎不往长期记忆里放：刚聊完的那几分钟例外，过了就只是噪音。
  const eligible = (r) => {
    if (r.type === 'ephemeral') return strength(r, now, types) >= 78;
    return true;
  };
  const rest = visible.filter(
    (r) =>
      r.type !== 'fact' &&
      // 流水是「留档备查」的那种印象，不往提示词里塞；要用的时候靠搜索翻出来。
      r.source !== 'flow' &&
      r.state !== 'dormant' &&
      r.state !== 'merged' &&
      worthShowing(r) &&
      eligible(r),
  );

  const scored = rest
    .map((record) => ({
      record,
      s: injectScore(record, now, types) * (TYPE_WEIGHT[record.type] ?? 0.6),
      strength: strength(record, now, types),
    }))
    .sort((a, b) => b.s - a.s);

  // 同一类最多占几个位置：不让某类日常闲聊把整块塞满。
  const quota = { daily: 3, ephemeral: 1 };
  const used = {};
  const strong = [];
  for (const item of scored) {
    if (item.strength < 40) continue;
    const type = item.record.type;
    const limit = quota[type];
    if (limit !== undefined && (used[type] ?? 0) >= limit) continue;
    used[type] = (used[type] ?? 0) + 1;
    strong.push(item);
    if (strong.length >= 8) break;
  }
  const edge = scored
    .filter((x) => x.strength >= 12 && x.strength < 40)
    .sort((a, b) => a.strength - b.strength)
    .slice(0, 2);

  // 事实层不参与截断：它放的是「不用回忆就该知道」的东西（怎么称呼他、不吃什么、约好的事）。
  // 被 maxChars 挤掉等于把称呼忘了，这个代价比少说两句旧事重得多。
  let out = '';
  if (facts.length) {
    out += `## 关于主人\n${facts.slice(0, 8).map((r) => lineOf(r, now, types)).join('\n')}\n`;
  }
  const restSections = [];
  if (strong.length) restSections.push(['还记得的事', strong.map((x) => lineOf(x.record, now, types))]);
  if (edge.length) restSections.push(['正在变模糊', edge.map((x) => lineOf(x.record, now, types))]);
  for (const [title, lines] of restSections) {
    const chunk = `## ${title}\n${lines.join('\n')}\n`;
    if (out.length + chunk.length > maxChars) break;
    out += chunk;
  }
  if (!out.trim()) return '';
  const today = new Date(now);
  const todayStr = `${today.getMonth() + 1}月${today.getDate()}日`;
  // 给一个明确的时间锚点：不然「11月8日」到底是几天前，她得靠猜。
  return `【你的记忆】\n今天：${todayStr}\n${out.trim()}\n（提到旧事时，以日期后面的「N天前」为准，别把上周的事说成昨天。）\n（更早的事记不清很正常，想得起就想起，想不起就说想不起。）\n（标着【私聊】的事，只在和主人私下说话时才能提；群聊里别人没先提起，就别自己翻出来。）`;
}

// ── 迁移 ────────────────────────────────────────────────────────────────────

/** 从 SurfCore 的旧记忆卡记录推断类型。只做冷启动用。 */
export function inferType(record) {
  const kind = String(record.kind ?? '');
  const tags = Array.isArray(record.tags) ? record.tags : [];
  if (record.isFact) return 'fact';
  if (record.firstMet === true) return 'first';
  if (kind === 'firstMeet' || kind === 'first') return 'first';
  if (tags.includes('first-met')) return 'first';
  if (kind === 'promise') return 'promise';
  const text = `${record.title ?? ''} ${record.text ?? ''}`;
  if (/第一次见面|初次相见|刚认识|刚加好友|那天开始/.test(text)) return 'first';
  if (/答应|约好|说好|下次一定|保证/.test(text)) return 'promise';
  const emotional = Number(record.emotional) || 0;
  if (emotional >= 6) return 'emotion';
  if (/喜欢|讨厌|爱吃|不吃|受不了|最喜欢|最讨厌|过敏/.test(text)) return 'opinion';
  // identity 只收「关于主人的硬信息」——联系方式、账号、称呼、作息这类不会变的东西。
  // 旧卡里 importance 高的记录多半是对话片段，直接判 identity 会让它们永远霸占注入块。
  if (Number(record.importance) >= 60 && /QQ|UID|账号|昵称|群号|称呼|生日|作息|几点睡|醒来|名字|年龄|住在|地址/.test(text)) {
    return 'identity';
  }
  if (/梗|哈哈哈|笑死/.test(text)) return 'slang';
  return 'daily';
}

/** 把旧记录转成新结构。 */
export function migrateRecord(old, now = Date.now()) {
  const type = inferType(old);
  const createdAt = toTime(old.createdAt, now);
  const lastReviewAt = toTime(old.lastSeenAt ?? old.createdAt, createdAt);
  const importance = clamp(Number(old.importance) || 50, 0, 100);
  const emotional = clamp(Number(old.emotional) || 0, 0, 10);
  const recall = clamp(Number(old.recallCount) || 0, 0, 999);
  const base = TYPES[type] ?? TYPES.daily;
  // 旧卡里 recallCount 反映「被想起过几次」，迁移时折算成稳定性增长。
  const stability = base.noDecay ? 0 : Math.max(0.05, base.S0 * (0.5 + importance / 100) * (1 + emotional / 10) * Math.pow(1.35, Math.min(recall, 12)));
  return {
    id: String(old.id ?? `mc_${createdAt.toString(36)}`),
    type,
    title: String(old.title ?? '').slice(0, 200),
    text: String(old.text ?? '').slice(0, 2000),
    factLabel: type === 'fact' ? String(old.title ?? '记得').replace(/^.*?[:：]/, '').slice(0, 20) : undefined,
    platform: String(old.scope ?? old.platform ?? 'all'),
    importance,
    emotional,
    pinned: old.pinned === true,
    noDecay: type === 'fact',
    stability: Math.round(stability * 1000) / 1000,
    createdAt: iso(createdAt),
    lastReviewAt: iso(lastReviewAt),
    reviewCount: recall,
    state: 'active',
    tags: Array.isArray(old.tags) ? old.tags.slice(0, 8) : [],
    migratedFrom: 'surfcore-memory-card',
  };
}

export { clamp, toTime, iso };

/** 本地日期（YYYY-MM-DD），按用户时区切分而不是 UTC。 */
export function localDay(time) {
  const d = new Date(time);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 把一段话压成一句能被人在脑子里复述的短句。 */
function shorten(text, max = 42) {
  let t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\[[^\]]{1,10}\]\s*/, '')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('？'), cut.lastIndexOf(' '));
  return `${stop > 16 ? cut.slice(0, stop) : cut}…`;
}

/** 只留名字，不带【】和渠道，用来写「主人：…」这种对话行。 */
export function speakerName(record) {
  const value = String(record?.speaker ?? '').trim();
  if (!value) return '';
  if (value === 'owner') return '主人';
  if (value === 'self') return '我';
  if (value === 'unknown') return '';
  // 私聊里的其他人：桥接把昵称装在 name: 里，认不出来的人至少留个 QQ 号。
  if (value.startsWith('name:')) return value.slice(5).replace(/^群友\s*/, '').trim();
  if (value.startsWith('group:')) return value.slice(6).replace(/^群友\s*/, '').trim();
  return '';
}

/**
 * 把同一天的零散记录并成一条。
 * 没有模型可用，所以是「合并」不是「总结」——原话都留着，只是合成一条。
 * 每行都带时刻：一天里的话往往隔了几个小时才说，标上时间才不会读成一整段连续对话。
 *
 * 加不加「主人：」只看 record.voice，不猜文本。
 * 靠「他说/她说」这类开头词反推转述太不可靠——那既可能是转述，也可能是引用别人的话。
 * voice 是写入时由记录的人自己标的：quote 才是原话，其余一律当转述，不加主语。
 */
export function digestText(day, list) {
  const [, month, date] = day.split('-');
  const sorted = list.slice().sort((a, b) => lastTouch(a) - lastTouch(b));
  const pad = (n) => String(n).padStart(2, '0');
  const lines = sorted
    .map((record) => {
      const body = String(record.text ?? '')
        .replace(/\s+/g, ' ')
        .replace(/^\[[^\]]{1,10}\]\s*/, '')
        .trim();
      if (!body) return '';
      const at = new Date(lastTouch(record) || Date.now());
      const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
      const who = speakerName(record);
      const quoted = record.voice === 'quote' && Boolean(who);
      return quoted ? `${clock} ${who}：${body}` : `${clock} ${body}`;
    })
    .filter(Boolean);
  if (!lines.length) return `${Number(month)}月${Number(date)}日`;
  return `${Number(month)}月${Number(date)}日\n${lines.join('\n')}`;
}

/**
 * 找出该被「收成一件事」的零散对话。
 *
 * 条件：日常 / 琐碎、三天以上没再被碰到、分数已经不高、本身也不重要。
 * 只并同类型、同一天的记录：日常并日常、琐碎并琐碎，不把两类的语气混成一段。
 * 这些留在库里占位置，又不会有人真的想逐条回忆 —— 收成一句「那阵子的事」更接近人脑的做法：
 * 具体对话忘了，留下的是印象。
 */
export function planConsolidation(
  records,
  {
    now = Date.now(),
    minAgeDays = 3,
    maxScore = 45,
    maxImportance = 65,
    minGroup = 2,
    maxGroup = 15,
    types = TYPES,
  } = {},
) {
  const groups = new Map();
  for (const record of records) {
    if (!record) continue;
    if (record.state === 'merged' || record.mergedInto) continue;
    // 被取代的旧说法不参与合并：它是要留档的原话，不是要压成概括的零散日常。
    if (record.state === 'superseded') continue;
    // 流水本身已经是「一天压成一条」，再合并就重复了。
    if (record.source === 'flow') continue;
    if (record.pinned) continue;
    if (record.type !== 'daily' && record.type !== 'ephemeral') continue;
    if (Number(record.importance ?? 50) > maxImportance) continue;
    if (strength(record, now, types) > maxScore) continue;
    const touched = lastTouch(record);
    if ((now - touched) / DAY_MS < minAgeDays) continue;
    if (String(record.text ?? '').trim().length < 8) continue;
    const day = localDay(touched);
    // 同一天里群聊和私聊是两回事：并成一条会让「谁说的、在哪说的」混掉，
    // 而且 group 的话题不该被塞进私下聊的记录里。按「类型 + 天 + 在哪说的」分开合。
    const type = record.type;
    const channel = normalizeChannel(record.channel);
    const bucket = `${type}|${day}|${channel}`;
    if (!groups.has(bucket)) groups.set(bucket, { type, day, channel, list: [] });
    groups.get(bucket).list.push(record);
  }

  const plans = [];
  for (const { type, day, channel, list } of groups.values()) {
    if (list.length < minGroup) continue;
    // 按时间顺序取前 maxGroup 条：一天超过上限时先并最早的那批，
    // 剩下的下次还会被捞到，会自己慢慢消化掉，不会被永远挡在后面。
    const picked = list
      .slice()
      .sort((a, b) => lastTouch(a) - lastTouch(b))
      .slice(0, maxGroup);
    plans.push({ type, day, channel, records: picked, text: digestText(day, picked) });
  }
  plans.sort((a, b) => lastTouch(a.records[0]) - lastTouch(b.records[0]));
  return plans;
}

function normalizeChannel(value) {
  const channel = String(value ?? '').trim();
  return channel === 'group' || channel === 'private' || channel === 'bili' ? channel : '';
}
