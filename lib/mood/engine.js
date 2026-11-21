// 情感状态机 —— 「此刻的她」。
//
// 记忆管「发生过什么」，目的引擎管「想做什么」，这里管「现在是什么状态」。
// 五个维度：亲密、开心是双向的（-100 到 100），疲倦、怒气、委屈是单向的（0 到 100），
// 日常值一律 10；没人推动就按半衰期回落到日常值。
//
// 第二版加入联动：一次推动会先被其他四个维度放大或缩小（倍率），
// 再按阈值带一下别的维度（直接联动）。联动只在「对话回合」触发——
// 同一段对话里最多每 30 分钟一次，同一条件当天触发越多收益越小，
// 否则一天几百个时间步会把 +1 累积成主驱动，所有负面情绪都会被自动磨平。
// 不做检索、不存事实，只维护一个连续的状态，再渲染成一句第一人称的处境。

const HOUR = 60 * 60 * 1000;

/** 状态格式版本：第一版没有 version 字段，读到旧状态时做一次语义迁移。 */
export const STATE_VERSION = 2;

/**
 * 五个维度。
 * halfLifeHours：偏离日常值之后，回落到一半所需的时间。
 * range：取值范围。亲密、开心可以跌到负数（疏远/讨厌、伤心），其余只涨不跌。
 * perTarget：是否按对话对象分开存（亲密和生气是分人的，其余是全局的）。
 */
export const DIMENSIONS = {
  fatigue: { key: 'fatigue', label: '疲倦', base: 10, halfLifeHours: 6, color: '#8b7cf6', range: [0, 100] },
  closeness: {
    key: 'closeness',
    label: '亲密',
    base: 10,
    halfLifeHours: 120,
    color: '#2fbf71',
    perTarget: true,
    range: [-100, 100],
  },
  anger: { key: 'anger', label: '怒气', base: 10, halfLifeHours: 2, color: '#e0483e', perTarget: true, range: [0, 100] },
  grievance: { key: 'grievance', label: '委屈', base: 10, halfLifeHours: 5, color: '#b06ad8', range: [0, 100] },
  joy: { key: 'joy', label: '开心', base: 10, halfLifeHours: 4, color: '#ffb020', range: [-100, 100] },
};

/** 对「不是主人」的人，亲密涨落只算两成——不然群里聊几次就跟人家比主人还亲。 */
export const OTHER_CLOSENESS_GAIN = 0.2;

/** 对别人生的气，回到主人身边会转成多少委屈。生气是往外顶，委屈是往内收。 */
export const ANGER_TO_GRIEVANCE = 0.3;

/**
 * 递减增益：同一维度在半小时内被连着往同一边推，第二次只算八成，第三次六成四……
 * 防的是一次争吵里她连推五次生气，一把顶到 90 下不来。情绪该有惯性，不该有加速度。
 */
export const REPEAT_WINDOW_MS = 30 * 60 * 1000;
const REPEAT_BASE = 0.8;
const REPEAT_FLOOR = 0.3;

/**
 * 委屈压着不散，会慢慢把关系推远：委屈在 30 以上时，每个联动窗口（30 分钟）
 * 对当前对象扣一点亲密度，最多扣到 45。委屈过了 60 就交给 G60-I 那条硬联动，
 * 两段不叠加。下限 45 是有意的——一次吵架不该把关系一路掉到底。
 */
export const STRAIN_THRESHOLD = 30;
export const STRAIN_FLOOR = 45;

/**
 * 阈值联动的节奏闸：同一段对话里最多每 30 分钟跑一次。
 * 一天按时间步算有 288 次，+1 的量级跑满会把状态顶到边上；
 * 按「对话回合」算，一天通常只有几十次，量级就对了。
 */
export const LINK_MIN_GAP_MS = 30 * 60 * 1000;
/** 同一条件当天第 k 次触发，收益乘 0.85^k，最低 0.25；每天重置。 */
export const LINK_DAILY_DECAY = 0.85;
export const LINK_DECAY_FLOOR = 0.25;
/** 单回合所有直接联动加起来的绝对值上限。 */
export const LINK_TURN_CAP = 6;

export const DIM_KEYS = Object.keys(DIMENSIONS);

export function dimRange(key) {
  return DIMENSIONS[key]?.range ?? [0, 100];
}

/** 按维度自己的范围夹住。 */
export function clampDim(key, n) {
  const [lo, hi] = dimRange(key);
  const v = Number(n);
  const base = DIMENSIONS[key]?.base ?? 10;
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : base));
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 归一化到 -1~1。正向（高于日常值）按 (值-10)/90，负向按 (值-10)/110——
 * 负区只有 110 的空间，同样的偏离在负区更「重」，疏远比亲近更难回。
 * 疲倦/怒气/委屈低于日常值时也给负数，因为「比平时还轻」不该是 +0。
 */
export function normalizedValue(key, x) {
  const base = DIMENSIONS[key]?.base ?? 10;
  const v = Number.isFinite(Number(x)) ? Number(x) : base;
  if (key === 'closeness' || key === 'joy') {
    return v >= base ? Math.min(1, (v - base) / 90) : Math.max(-1, (v - base) / 110);
  }
  return Math.max(-1, Math.min(1, (v - base) / 90));
}

/**
 * 五个倍率：某个维度要动的时候，先乘上它自己这一格的倍率。
 *
 *   亲密 = 1 - 0.45×怒气 - 0.30×委屈 + 0.25×开心
 *   开心 = 1 - 0.35×疲倦 - 0.30×怒气 - 0.25×委屈 + 0.20×亲密
 *   疲倦 = 1 - 0.20×开心 + 0.25×怒气 + 0.20×委屈
 *   怒气 = 1 + 0.45×疲倦 + 0.35×委屈 - 0.25×开心 - 0.30×亲密
 *   委屈 = 1 + 0.30×疲倦 + 0.40×怒气 - 0.20×开心 - 0.20×亲密
 *
 * 倍率夹在 0.5~2.0：情绪可以影响情绪，但不能让一次推直接把状态顶穿。
 */
export function multipliers(state, { target = '' } = {}) {
  const key = normalizeTarget(target);
  const I = closenessTo(state, key);
  const H = dimValueOf(state, 'joy', key);
  const F = dimValueOf(state, 'fatigue', key);
  const A = angerAt(state, key);
  const G = dimValueOf(state, 'grievance', key);
  const n = {
    I: normalizedValue('closeness', I),
    H: normalizedValue('joy', H),
    F: normalizedValue('fatigue', F),
    A: normalizedValue('anger', A),
    G: normalizedValue('grievance', G),
  };
  const c = (v) => Math.min(2, Math.max(0.5, v));
  return {
    closeness: c(1 - 0.45 * n.A - 0.3 * n.G + 0.25 * n.H),
    joy: c(1 - 0.35 * n.F - 0.3 * n.A - 0.25 * n.G + 0.2 * n.I),
    fatigue: c(1 - 0.2 * n.H + 0.25 * n.A + 0.2 * n.G),
    anger: c(1 + 0.45 * n.F + 0.35 * n.G - 0.25 * n.H - 0.3 * n.I),
    grievance: c(1 + 0.3 * n.F + 0.4 * n.A - 0.2 * n.H - 0.2 * n.I),
    n,
  };
}

/** 新状态：全部落在日常值上。 */
export function createState(now = Date.now()) {
  const values = {};
  for (const key of DIM_KEYS) values[key] = DIMENSIONS[key].base;
  return {
    at: now,
    version: STATE_VERSION,
    values,
    closeness: {},
    angerBy: {},
    history: [],
    linkAt: 0,
    linkCounts: null,
  };
}

/**
 * 旧状态（第一版）迁移到第二版语义。
 * 亲密：0~100 base 50 → -100~100 base 10；开心：0~100 base 30 → -100~100 base 10；
 * 疲倦：base 20 → base 10。怒气、委屈原本就是 base 10，只夹范围。
 * 迁移只做一次，之后持久化的状态自带 version=2。
 */
export function migrateLegacy(state) {
  const values = { ...(state?.values ?? {}) };
  const pos = (v, oldBase) => {
    const cur = Number(v);
    if (!Number.isFinite(cur)) return 10;
    return clampDim('fatigue', 10 + ((cur - oldBase) / (100 - oldBase)) * 90);
  };
  const bipolar = (v, oldBase) => {
    const cur = Math.max(0, Math.min(100, Number(v)));
    if (!Number.isFinite(cur)) return 10;
    return cur >= oldBase ? 10 + ((cur - oldBase) / (100 - oldBase)) * 90 : 10 - ((oldBase - cur) / oldBase) * 110;
  };

  if (Number.isFinite(Number(values.fatigue))) values.fatigue = Math.round(pos(values.fatigue, 20) * 10) / 10;
  if (Number.isFinite(Number(values.joy))) values.joy = Math.round(bipolar(values.joy, 30) * 10) / 10;
  values.fatigue = clampDim('fatigue', values.fatigue);
  values.joy = clampDim('joy', values.joy);
  values.anger = clampDim('anger', values.anger);
  values.grievance = clampDim('grievance', values.grievance);

  const closeness = {};
  for (const [k, v] of Object.entries(state?.closeness ?? {})) {
    const cur = Math.max(0, Math.min(100, Number(v)));
    if (!Number.isFinite(cur)) continue;
    closeness[k] = Math.round(bipolar(cur, 50) * 10) / 10;
  }
  const angerBy = {};
  for (const [k, v] of Object.entries(state?.angerBy ?? {})) {
    const cur = Number(v);
    if (!Number.isFinite(cur)) continue;
    angerBy[k] = Math.round(clampDim('anger', cur) * 10) / 10;
  }

  return {
    at: Number(state?.at || Date.now()),
    version: STATE_VERSION,
    values,
    closeness,
    angerBy,
    history: Array.isArray(state?.history) ? state.history.slice(-30) : [],
    linkAt: 0,
    linkCounts: null,
  };
}

/** 把状态推进到 now：每个维度按半衰期向日常值回落。 */
export function decayState(state, now = Date.now(), { ownerTarget = '' } = {}) {
  const src = state && state.version !== STATE_VERSION ? migrateLegacy(state) : state;
  const next = {
    at: now,
    version: STATE_VERSION,
    values: { ...(src?.values ?? {}) },
    closeness: { ...(src?.closeness ?? {}) },
    angerBy: { ...(src?.angerBy ?? {}) },
    history: Array.isArray(src?.history) ? src.history.slice(-30) : [],
    linkAt: Number(src?.linkAt || 0),
    linkCounts: src?.linkCounts ?? null,
  };
  const elapsed = Math.max(0, now - Number(src?.at || now));
  for (const key of DIM_KEYS) {
    const dim = DIMENSIONS[key];
    if (dim.perTarget) continue;
    const cur = Number.isFinite(next.values[key]) ? next.values[key] : dim.base;
    const k = Math.pow(0.5, elapsed / (dim.halfLifeHours * HOUR));
    next.values[key] = Math.round(clampDim(key, dim.base + (cur - dim.base) * k) * 10) / 10;
  }
  for (const [mapKey, dimKey] of [
    ['closeness', 'closeness'],
    ['angerBy', 'anger'],
  ]) {
    const dim = DIMENSIONS[dimKey];
    const k = Math.pow(0.5, elapsed / (dim.halfLifeHours * HOUR));
    for (const target of Object.keys(next[mapKey])) {
      const cur = Number(next[mapKey][target]);
      if (!Number.isFinite(cur)) continue;
      next[mapKey][target] = Math.round(clampDim(dimKey, dim.base + (cur - dim.base) * k) * 10) / 10;
    }
  }

  // 「委屈磨关系」现在走阈值联动的窗口（见 applyLinks），不再按流逝时间单独扣：
  // 两套并存会在委屈 60 附近叠加出双倍速度，正是要避免的跳变。
  return next;
}

/**
 * 直接联动：某个维度已经很高/很低时，会在这一回合顺手带一下别的维度。
 * 每条件每回合最多一次，乘该维度的倍率，单回合总和不超过 ±6。
 * 频率闸（30 分钟）和每日递减在 applyLinks 里处理。
 */
function applyLinks(state, { now = Date.now(), targetKey = '' } = {}) {
  const last = Number(state.linkAt || 0);
  if (now - last < LINK_MIN_GAP_MS) return state;

  const day = new Date(now).toISOString().slice(0, 10);
  const store =
    state.linkCounts && state.linkCounts.day === day && state.linkCounts.counts
      ? { day, counts: { ...state.linkCounts.counts } }
      : { day, counts: {} };

  const m = multipliers(state, { target: targetKey });
  let total = 0;
  const apply = (cond, dimKey, delta, scope = 'target') => {
    const seen = store.counts[cond] || 0;
    const factor = Math.max(LINK_DECAY_FLOOR, Math.pow(LINK_DAILY_DECAY, seen));
    const dd = delta * factor;
    if (total + Math.abs(dd) > LINK_TURN_CAP) return;

    // 亲密/怒气按对象存；疲倦/委屈/开心是全局值。所以「全局维度 → 亲密/怒气」
    // 的联动要落到每个已认识的对象的头上，而亲密↔怒气之间的联动只碰当前对象。
    if (scope === 'all' && (dimKey === 'closeness' || dimKey === 'anger')) {
      const keys = new Set([targetKey, ...Object.keys(state.closeness || {}), ...Object.keys(state.angerBy || {})]);
      for (const key of keys) {
        const mk = multipliers(state, { target: key })[dimKey];
        const cur = dimValueOf(state, dimKey, key);
        setDimValueOf(state, dimKey, key, cur + dd * mk);
      }
    } else {
      const cur = dimValueOf(state, dimKey, targetKey);
      setDimValueOf(state, dimKey, targetKey, cur + dd * m[dimKey]);
    }
    total += Math.abs(dd);
    store.counts[cond] = seen + 1;
  };

  const v = state.values;
  const I = closenessTo(state, targetKey);
  const A = angerAt(state, targetKey);
  const F = v.fatigue;
  const G = v.grievance;
  const H = v.joy;

  if (F >= 60) { apply('F60-H', 'joy', -2); apply('F60-A', 'anger', 1, 'all'); }
  if (A >= 60) { apply('A60-I', 'closeness', -2); apply('A60-H', 'joy', -1); }
  if (G >= 60) { apply('G60-I', 'closeness', -2, 'all'); apply('G60-H', 'joy', -1); }
  if (H >= 50) { apply('H50-F', 'fatigue', -1); apply('H50-A', 'anger', -1, 'all'); apply('H50-G', 'grievance', -1); }
  if (H <= -20) { apply('H-20-A', 'anger', 1, 'all'); apply('H-20-G', 'grievance', 1); apply('H-20-I', 'closeness', -1, 'all'); }
  if (I >= 75) { apply('I75-G', 'grievance', -1); apply('I75-A', 'anger', -1); apply('I75-H', 'joy', 1); }
  if (I <= -30) { apply('I-30-A', 'anger', 2); }
  if (F <= 20 && H >= 40) { apply('F20-I', 'closeness', 1, 'all'); }

  // 委屈磨关系：30 ≤ 委屈 < 60 时，每个联动窗口扣一点亲密，扣到 45 为止。
  // 60 以上交给 G60-I 硬联动，两段不重叠；强度随委屈从 0.6 爬到 1.6，
  // 59 到 60 的边际差不到一倍，不会出现「过线突然快十倍」的跳变。
  if (G >= STRAIN_THRESHOLD && G < 60) {
    const cur = closenessTo(state, targetKey);
    if (cur > STRAIN_FLOOR) {
      const seen = store.counts['G30-I'] || 0;
      const factor = Math.max(LINK_DECAY_FLOOR, Math.pow(LINK_DAILY_DECAY, seen));
      const intensity = (G - STRAIN_THRESHOLD) / 30;
      const drop = Math.min(cur - STRAIN_FLOOR, (0.6 + 1.0 * intensity) * factor * m.closeness);
      if (drop > 0 && total + drop <= LINK_TURN_CAP) {
        setDimValueOf(state, 'closeness', targetKey, cur - drop);
        total += drop;
        store.counts['G30-I'] = seen + 1;
      }
    }
  }

  state.linkAt = now;
  state.linkCounts = store;
  return state;
}

/**
 * 推动状态。changes 里只写要动的维度，正负都行。
 *
 * 顺序：先按半衰期衰减 → 推 delta×倍率×同向递减 → 跑阈值联动 → 记 history。
 * 倍率来自 multipliers()，联动来自 applyLinks()——
 * 所以「累的时候更容易生气」「开心的时候气散得快」不是另写的规则，
 * 而是同一套倍率在起作用。
 */
export function applyShift(state, changes = {}, { now = Date.now(), target = '', note = '', ownerTarget = '', manual = false } = {}) {
  const next = decayState(state, now, { ownerTarget });
  const ownerKey = ownerTarget ? normalizeTarget(ownerTarget) : '';
  // 不填 target、或者填了个空的，都算「对主人」——不能落到一个叫 default 的第三个桶里，
  // 那样面板上按主人去查会查不到，她以为推了、你看到的是没变。
  const key = (!target || normalizeTarget(target) === 'default') && ownerKey ? ownerKey : normalizeTarget(target);
  const isOwner = !ownerKey || key === ownerKey;

  const repeatFactor = (dimKey, delta) => {
    // 面板手动调整是「直接改状态」，不走递减：点三次 +2 就是 +6，不该第三次只给 64%。
    if (manual) return 1;
    const sign = Math.sign(delta);
    const since = now - REPEAT_WINDOW_MS;
    let seen = 0;
    for (const item of next.history) {
      const t = Date.parse(item?.at);
      if (!Number.isFinite(t) || t < since) continue;
      const v = Number(item?.changes?.[dimKey]);
      if (Number.isFinite(v) && Math.sign(v) === sign) seen += 1;
    }
    return Math.max(REPEAT_FLOOR, Math.pow(REPEAT_BASE, seen));
  };

  const mults = multipliers(next, { target: key });

  for (const dimKey of DIM_KEYS) {
    const delta = Number(changes?.[dimKey]);
    if (!Number.isFinite(delta) || delta === 0) continue;
    if (DIMENSIONS[dimKey].perTarget) continue;
    const cur = Number.isFinite(Number(next.values[dimKey])) ? Number(next.values[dimKey]) : DIMENSIONS[dimKey].base;
    next.values[dimKey] = clampDim(dimKey, cur + delta * mults[dimKey] * repeatFactor(dimKey, delta));
  }

  // 亲密按对象存（私聊折成 qq:QQ号，跟着人走，不跟着窗口走）。
  // 别人的涨落只算两成：聊几次就跟主人一样亲，之后「谁更重要」就看不出来了。
  const clDelta = Number(changes?.closeness);
  if (Number.isFinite(clDelta) && clDelta !== 0) {
    const gain = (isOwner ? 1 : OTHER_CLOSENESS_GAIN) * mults.closeness * repeatFactor('closeness', clDelta);
    const cur = Number(next.closeness[key]);
    const base = Number.isFinite(cur) ? cur : DIMENSIONS.closeness.base;
    next.closeness[key] = clampDim('closeness', base + clDelta * gain);
  }

  // 生气也按对象存：在群里被别人气到，不等于对主人也生气。
  const angerDelta = Number(changes?.anger);
  if (Number.isFinite(angerDelta) && angerDelta !== 0) {
    const cur = Number(next.angerBy[key]);
    const base = Number.isFinite(cur) ? cur : DIMENSIONS.anger.base;
    next.angerBy[key] = clampDim('anger', base + angerDelta * mults.anger * repeatFactor('anger', angerDelta));
    // 气不会凭空消失：对别人生的气，回到主人这边变成委屈。
    if (!isOwner && angerDelta > 0) {
      next.values.grievance = clampDim('grievance', next.values.grievance + angerDelta * ANGER_TO_GRIEVANCE);
    }
  }

  // 阈值联动：这一回合里，状态已经偏到一定程度时带一下别的维度。
  applyLinks(next, { now, targetKey: key });

  const touched = DIM_KEYS.filter((k) => Number.isFinite(Number(changes?.[k])) && Number(changes[k]) !== 0);
  if (touched.length || note) {
    next.history = [
      ...next.history,
      {
        at: new Date(now).toISOString(),
        target: key === 'default' ? '' : key,
        note: String(note || '').slice(0, 80),
        changes: Object.fromEntries(touched.map((k) => [k, Number(changes[k])])),
        values: { ...next.values },
      },
    ].slice(-30);
  }
  return next;
}

/**
 * 被动疲倦：她真的参与了一轮对话就累积一点，不经过倍率、不吃递减、不设每日上限。
 * 这是身体状态不是情绪判断，所以不走 applyShift 那一套；主人拍板每轮 +2、
 * 深夜（23:00–05:00）+4，封顶只到维度自己的 100。
 */
export function tickFatigue(state, amount, { now = Date.now(), note = 'tick' } = {}) {
  const next = decayState(state, now);
  const add = Number(amount);
  if (!Number.isFinite(add) || add <= 0) return next;
  const cur = Number.isFinite(Number(next.values.fatigue)) ? Number(next.values.fatigue) : DIMENSIONS.fatigue.base;
  next.values.fatigue = round1(clampDim('fatigue', cur + add));
  next.history = [
    ...next.history,
    {
      at: new Date(now).toISOString(),
      target: '',
      note: String(note || '').slice(0, 80),
      changes: { fatigue: Math.round(add * 10) / 10 },
      values: { ...next.values },
    },
  ].slice(-30);
  return next;
}

/** 某个维度当前值：亲密/怒气按对象取，其余取全局。 */
function dimValueOf(state, dimKey, targetKey) {
  if (dimKey === 'closeness') return closenessTo(state, targetKey);
  if (dimKey === 'anger') return angerAt(state, targetKey);
  const v = Number(state?.values?.[dimKey]);
  return Number.isFinite(v) ? v : DIMENSIONS[dimKey].base;
}

function setDimValueOf(state, dimKey, targetKey, value) {
  if (dimKey === 'closeness') {
    state.closeness[normalizeTarget(targetKey)] = round1(clampDim('closeness', value));
    return;
  }
  if (dimKey === 'anger') {
    state.angerBy[normalizeTarget(targetKey)] = round1(clampDim('anger', value));
    return;
  }
  state.values[dimKey] = round1(clampDim(dimKey, value));
}

/**
 * 亲密的键归一化。
 * 同一个人在私聊里是 `private:QQ号`、在群里如果指名道姓也该是同一份关系，
 * 所以私聊一律折成 `qq:QQ号`；群本身（对一群人的整体亲近感）保留 `group:群号`。
 */
export function normalizeTarget(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return 'default';
  const priv = text.match(/^private:(\d+)$/i);
  if (priv) return `qq:${priv[1]}`;
  if (/^qq:\d+$/i.test(text)) return `qq:${text.slice(3)}`;
  if (/^group:\d+$/i.test(text)) return text;
  return text;
}

/** 给某个对象的亲密度。没见过的从日常值起。 */
export function closenessTo(state, target) {
  const key = normalizeTarget(target);
  const v = Number(state?.closeness?.[key]);
  return Number.isFinite(v) ? v : DIMENSIONS.closeness.base;
}

/** 给某个对象的生气值。没生过气的从日常值起。 */
export function angerAt(state, target) {
  const key = normalizeTarget(target);
  const v = Number(state?.angerBy?.[key]);
  return Number.isFinite(v) ? v : DIMENSIONS.anger.base;
}

/** 面板上怎么称呼这个对象。 */
export function targetLabel(key) {
  if (!key || key === 'default') return '默认';
  if (key.startsWith('qq:')) return `QQ ${key.slice(3)}`;
  if (key.startsWith('group:')) return `群 ${key.slice(6)}`;
  return key;
}

/**
 * 渲染成一句第一人称的处境。
 * 只挑「此刻明显偏了」的维度说，全都贴日常值就返回空串——
 * 没有状态也是一种状态，不该硬说「你今天挺平静的」。
 */
export function renderMood(state, { target = '' } = {}) {
  if (!state?.values) return '';
  const v = state.values;
  const cl = closenessTo(state, target);
  const anger = angerAt(state, target);
  const parts = [];

  if (v.fatigue >= 55) parts.push('你困得厉害，回话会又快又短');
  else if (v.fatigue >= 30) parts.push('你有点困了');

  if (anger >= 55) parts.push('你还在生他的气，说话会带刺');
  else if (anger >= 30) parts.push('你还有点不痛快，没完全过去');

  // 委屈是「我觉得被亏待了」，有对象、往内收，和生气（往外顶）不是一回事。
  if (v.grievance >= 55) parts.push('你心里有点委屈，说话会绕，不太想直说');
  else if (v.grievance >= 30) parts.push('你有点委屈，还没完全过去');

  if (v.joy >= 60) parts.push('你心情很好，话会多');
  else if (v.joy >= 35) parts.push('你心情不错');
  else if (v.joy <= -30) parts.push('你心情有点低落，提不起劲');

  if (cl >= 70) parts.push('你跟他很亲近，愿意多讲点自己的事');
  else if (cl <= -20) parts.push('你跟他不太对付，会收着说');

  if (!parts.length) return '';
  return `你现在：${parts.join('；')}。`;
}

/** 给面板和接口用的快照。 */
export function summarize(state, { target = '', now = Date.now() } = {}) {
  const live = decayState(state, now);
  const current = normalizeTarget(target);
  // 亲密是分人的：把已有的对象连同「当前这个」（哪怕还没记录）一起列出来，
  // 面板上默认收着，点开才看，不占主视图。
  const keys = new Set([...Object.keys(live.closeness ?? {}), ...Object.keys(live.angerBy ?? {})]);
  keys.add(current);
  const targets = [...keys]
    .map((key) => ({
      key,
      label: targetLabel(key),
      value: closenessTo(live, key),
      anger: angerAt(live, key),
      base: DIMENSIONS.closeness.base,
      angerBase: DIMENSIONS.anger.base,
      current: key === current,
    }))
    .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.value - a.value);
  const mults = multipliers(live, { target: current });
  return {
    at: new Date(live.at).toISOString(),
    target: current === 'default' ? '' : current,
    closeness: closenessTo(live, current),
    targets,
    multipliers: {
      closeness: mults.closeness,
      joy: mults.joy,
      fatigue: mults.fatigue,
      anger: mults.anger,
      grievance: mults.grievance,
    },
    dimensions: DIM_KEYS.map((key) => ({
      key,
      label: DIMENSIONS[key].label,
      value:
        key === 'closeness' ? closenessTo(live, current) : key === 'anger' ? angerAt(live, current) : live.values[key],
      base: DIMENSIONS[key].base,
      range: DIMENSIONS[key].range,
      color: DIMENSIONS[key].color,
      halfLifeHours: DIMENSIONS[key].halfLifeHours,
      perceived: DIMENSIONS[key].perTarget ? 'here' : 'global',
    })),
    history: live.history.slice(-10),
  };
}
