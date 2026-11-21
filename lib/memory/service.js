// Shoreline 记忆服务 —— 把 engine（算法）和 store（存储）缝在一起，
// 同时给三条通道用：Agent 工具、系统提示词注入、控制面板 HTTP 接口。
//
// 设计原则：这里不写算法，也不写文件格式。算法在 engine.js，存储在 store.js。
// 这一层只负责「一次操作要动哪些东西」，保证三个入口看到的是同一份状态。

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

import { Store } from './store.js';
import {
  DAY_MS,
  TYPES,
  TYPE_KEYS,
  addActivation,
  applyReview,
  localDay,
  planConsolidation,
  renderBlock,
  search as engineSearch,
  speakerName,
  stabilityOf,
  strength,
  settleState,
  whoOf,
} from './engine.js';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.dsh', 'shoreline', 'memory');

export function defaultDataDir() {
  return DEFAULT_DATA_DIR;
}

/** 会话 key 的可读名字：私聊/群分开，免得一堆流水混在一起认不出是哪来的。 */
function flowKeyLabel(key) {
  const value = String(key ?? '').trim();
  if (!value) return '';
  const matched = value.match(/^(private|group):(\d+)$/);
  if (matched) return matched[1] === 'group' ? `群 ${matched[2]}` : `私聊 ${matched[2]}`;
  return value;
}

/** 一组记录里出现最多的那个值；平票或全空就给空串。 */
function majority(list, key) {  const counts = new Map();
  for (const record of list) {
    const value = String(record?.[key] ?? '').trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  let tie = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  return tie ? '' : best;
}

export class MemoryService {
  /**
   * @param {object} options
   * @param {string} [options.dir] 数据目录，默认 ~/.dsh/shoreline/memory
   * @param {string} [options.seedPath] 首次启动时导入的种子文件
   * @param {number} [options.maxChars] 注入块字数上限
   * @param {number} [options.sectionOrder] 注入块的提示词段落顺序
   * @param {string} [options.platform] all | qq | bili | wechat
   */
  constructor({ dir, seedPath, maxChars = 1600, sectionOrder = 850, platform = 'all' } = {}) {
    this.dir = dir ? path.resolve(dir) : DEFAULT_DATA_DIR;
    this.seedPath = seedPath ?? null;
    this.maxChars = maxChars;
    this.sectionOrder = sectionOrder;
    this.platform = platform;
    this.store = new Store({ dir: this.dir });
    this.records = [];
    this.loaded = false;
    this.loading = null;
    this.settings = { maxChars, sectionOrder };
  }

  /** 幂等加载。并发调用共用同一个 Promise。 */
  async init() {
    if (this.loaded) return this;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.records = await this.store.all();
        if (this.records.length === 0 && this.seedPath) {
          this.records = await this.importSeed(this.seedPath);
        }
        this.loaded = true;
      } finally {
        this.loading = null;
      }
      return this;
    })();
    return this.loading;
  }

  async importSeed(seedPath) {
    try {
      const raw = await fs.readFile(seedPath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.records ?? [];
      if (!list.length) return [];
      const now = Date.now();
      const records = list.map((item) => normalizeRecord(item, now));
      await this.store.replaceAll(records);
      await this.store.event('seed-import', { count: records.length, from: seedPath });
      return records;
    } catch (error) {
      await this.store.event('seed-import-failed', { error: String(error?.message ?? error) });
      return [];
    }
  }

  async persist() {
    await this.store.replaceAll(this.records);
  }

  // ── 读取 ────────────────────────────────────────────────────────────────

  all() {
    return this.records;
  }

  get(id) {
    return this.records.find((r) => r.id === id) ?? null;
  }

  /** 面板总览数据。 */
  stats(now = Date.now()) {
    const byType = Object.fromEntries(TYPE_KEYS.map((key) => [key, 0]));
    let active = 0;
    let dormant = 0;
    let fading = 0;
    let merged = 0;
    let mergedGroups = 0;
    let sum = 0;
    for (const record of this.records) {
      byType[record.type] = (byType[record.type] ?? 0) + 1;
      const score = strength(record, now);
      sum += score;
      if (record.state === 'merged') merged += 1;
      else if (record.state === 'dormant' || score < 6) dormant += 1;
      else if (score < 30) fading += 1;
      else active += 1;
      // 「合并过的」是整理产物，不是类型：新产物保留原类型，老产物是 digest。
      if (record.merged === true || record.type === 'digest') mergedGroups += 1;
    }
    const sorted = [...this.records].sort((a, b) => lastTouchOf(b) - lastTouchOf(a));
    return {
      total: this.records.length,
      active,
      dormant,
      fading,
      merged,
      mergedGroups,
      avgStrength: this.records.length ? Math.round((sum / this.records.length) * 10) / 10 : 0,
      byType,
      newest: sorted.slice(0, 5).map((r) => brief(r, now)),
      oldest: [...this.records].sort((a, b) => lastTouchOf(a) - lastTouchOf(b)).slice(0, 3).map((r) => brief(r, now)),
      dir: this.dir,
      loaded: this.loaded,
      settings: { ...this.settings },
    };
  }

  /** 面板列表：按当前强度排序，支持搜索/筛选/分页。 */
  list({ query = '', type = '', state = '', merged = false, hideFlow = false, limit = 60, offset = 0 } = {}) {
    const now = Date.now();
    let rows = this.records;
    // 流水（flow）默认不进列表：一天一条、内容很长，只在勾了「流水」时才看。
    if (hideFlow) rows = rows.filter((r) => r.type !== 'flow');
    // 被取代的旧说法默认不占列表位置（它们已经是"作废"的），但可以单独筛出来看原文。
    if (state !== 'superseded') rows = rows.filter((r) => r.state !== 'superseded');
    if (type) rows = rows.filter((r) => r.type === type);
    // 「只看合并后的」：新产物带 merged 标记且保留原类型，老产物是 digest 类型。
    // 它和类型筛选是叠加的，不是互斥的。
    if (merged) rows = rows.filter((r) => r.merged === true || r.type === 'digest');
    if (state === 'active') rows = rows.filter((r) => r.state !== 'merged' && strength(r, now) >= 30);
    if (state === 'fading') {
      rows = rows.filter((r) => {
        const v = strength(r, now);
        return r.state !== 'merged' && v >= 6 && v < 30;
      });
    }
    if (state === 'dormant') {
      rows = rows.filter((r) => r.state === 'dormant' || strength(r, now) < 6);
    }
    if (state === 'merged') rows = rows.filter((r) => r.state === 'merged');
    if (state === 'superseded') rows = rows.filter((r) => r.state === 'superseded');
    if (query.trim()) {
      const hits = engineSearch(rows, query, { limit: 500, now });
      return {
        total: hits.length,
        items: hits.slice(offset, offset + limit).map((hit) => full(hit.record ?? hit, now)),
      };
    }
    // 列表按「记下的时间」倒序：近的在上、早的在下。
    // 以前按分数排，同一件事过几天分数一变就跳位置，翻起来找不到；
    // 搜索（query 非空）仍按相关度，不动。
    const sorted = [...rows].sort(
      (a, b) => (Date.parse(String(b.createdAt ?? '')) || 0) - (Date.parse(String(a.createdAt ?? '')) || 0),
    );
    return { total: sorted.length, items: sorted.slice(offset, offset + limit).map((r) => full(r, now)) };
  }

  /** Agent 检索：命中即记一次「被提醒」级复习。 */
  async search(query, limit = 5) {
    const now = Date.now();
    const hits = engineSearch(this.records, query, { limit, now });
    const records = hits.map((hit) => hit.record ?? hit);
    if (records.length) {
      for (const record of records) {
        applyReview(record, 'remind', now);
        // 真的被翻出来了，才算一次「使用证据」。不改衰减曲线，只让她下次更容易想起来。
        addActivation(record, now);
      }
      await this.persist();
      await this.store.event('search', { query, hits: records.map((r) => r.id) });
    }
    return records.map((r) => full(r, now));
  }

  // ── 写入 ────────────────────────────────────────────────────────────────

  async remember({
    text,
    title = '',
    type = 'daily',
    importance = 60,
    emotional = 0,
    tags = [],
    speaker = '',
    channel = '',
    moodSelf = '',
    moodOther = '',
    voice = 'narration',
    supersedes = [],
    evidence = 'explicit',
    validFrom = '',
  }) {
    const now = Date.now();
    const targets = Array.isArray(supersedes) ? [...new Set(supersedes.map(String).filter(Boolean))] : [];
    const record = normalizeRecord(
      {
        id: `m-${randomUUID().slice(0, 8)}`,
        text,
        title,
        type: TYPES[type] ? type : 'daily',
        importance,
        emotional,
        tags,
        speaker,
        channel,
        moodSelf,
        moodOther,
        voice,
        // 先写上新记录，旧记录的 supersededBy 才能指向它。
        supersedes: targets,
        evidence,
        validFrom: validFrom || undefined,
        createdAt: new Date(now).toISOString(),
        lastTouchAt: new Date(now).toISOString(),
        state: 'active',
        source: 'agent',
      },
      now,
    );
    this.records.push(record);
    // 旧说法退场：状态改成 superseded，不进注入块，但正文保留。
    // 只认真正存在的记录，不替不存在的 id 编造关系。
    const replaced = [];
    for (const id of targets) {
      if (id === record.id) continue;
      const old = this.get(id);
      if (!old || old.state === 'superseded') continue;
      old.supersededBy = record.id;
      old.supersededAt = record.createdAt;
      // 旧说法从「新说法成立的那一刻」起失效。
      old.validTo = old.validTo ?? record.validFrom;
      old.state = 'superseded';
      replaced.push(id);
    }
    if (!replaced.length) record.supersedes = [];
    await this.persist();
    await this.store.event('remember', { id: record.id, type: record.type, supersedes: replaced });
    return full(record, now);
  }

  async review(id, grade = 'recall') {
    const record = this.get(id);
    if (!record) return null;
    const now = Date.now();
    const before = strength(record, now);
    applyReview(record, grade, now);
    addActivation(record, now);
    settleState(record, now);
    const after = strength(record, now);
    await this.persist();
    await this.store.event('review', { id, grade, before, after });
    return { ...full(record, now), before, after, span: humanSpan(stabilityOf(record)) };
  }

  /**
   * 把三天以上没再被提起、本身又不重要的零散对话收成一条概括。
   * 可以反复跑：已经收过的记录带 mergedInto，不会再被选中。
   *
   * 收拢不等于重记一遍：新记录继承这组里最早的时间、最后一次被提起的时间、
   * 平均强度，所以它不会因为「刚生成」而突然变清晰。
   */
  async consolidate({ dryRun = false, ...options } = {}) {
    const now = Date.now();
    const plans = planConsolidation(this.records, { now, ...options });
    const covered = plans.reduce((n, p) => n + p.records.length, 0);
    if (!plans.length) return { groups: 0, covered: 0, dryRun: Boolean(dryRun) };
    if (dryRun) {
      return {
        dryRun: true,
        groups: plans.length,
        covered,
        preview: plans.slice(0, 5).map((p) => ({ day: p.day, count: p.records.length, text: p.text })),
      };
    }

    const dropIds = new Set();
    for (const plan of plans) {
      const id = `d-${randomUUID().slice(0, 8)}`;
      const list = plan.records;
      const [, mm, dd] = plan.day.split('-');
      const importance = Math.round(
        list.reduce((n, r) => n + Number(r.importance ?? 50), 0) / list.length,
      );
      const emotional = Math.max(...list.map((r) => Number(r.emotional ?? 0)));
      // 强度沿用这组原来的水平，不用新类型自己的基线，
      // 否则合并一下分数就从「快忘了」跳回「记得很清楚」。
      const stability = Math.max(
        0.05,
        list.reduce((n, r) => n + Number(stabilityOf(r) || 0), 0) / list.length,
      );
      const createdAt = list.reduce((min, r) => {
        const v = String(r.createdAt ?? '');
        return !v ? min : !min || v < min ? v : min;
      }, '');
      const lastTouchAt = list.reduce((max, r) => {
        const v = String(r.lastTouchAt ?? '');
        return !v ? max : !max || v > max ? v : max;
      }, '');
      const tags = [...new Set(list.flatMap((r) => (Array.isArray(r.tags) ? r.tags : [])))].slice(0, 8);
      this.records.push(
        normalizeRecord(
          {
            id,
            // 合并后仍是原来的类型：日常并出来的还是日常，琐碎并出来的还是琐碎。
            // 这样它在类型筛选里不会凭空变成「合并」，只是多了一个 merged 标记。
            type: plan.type,
            title: `${Number(mm)}月${Number(dd)}日`,
            text: plan.text,
            importance,
            emotional,
            stability,
            tags,
            // 时间线沿用原来的，不刷新成「现在」
            createdAt: createdAt || new Date(now).toISOString(),
            lastTouchAt: lastTouchAt || new Date(now).toISOString(),
            speaker: majority(list, 'speaker'),
            // 分组时已经按「天 + 在哪说的」切开了，这里直接沿用，不再取多数票。
            channel: plan.channel || majority(list, 'channel'),
            state: 'active',
            source: 'consolidate',
            merged: true,
            mergedCount: list.length,
          },
          now,
        ),
      );
      for (const record of list) dropIds.add(record.id);
    }
    // 合并完，原来的碎话就从库里拿掉 —— 它们已经被完整地写进那段对话里了。
    if (dropIds.size) this.records = this.records.filter((record) => !dropIds.has(record.id));

    await this.persist();
    await this.store.event('consolidate', { groups: plans.length, covered, removed: dropIds.size });
    return { groups: plans.length, covered, dryRun: false };
  }

  /**
   * 把桥接写进来的对话流水收进记忆库。
   *
   * 这是「琐碎也要留痕」的落点：她没主动记的往来，当天也会留一条极低强度的流水。
   * 平时进不了提示词，只有被关键词碰到才会浮出来——人也是这样，说不出细节，
   * 但一提就「好像有这么回事」。
   */
  async ingestFlow() {
    const file = path.join(this.dir, 'inbox.jsonl');
    let raw = '';
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      return { ingested: 0, days: 0 };
    }

    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return { ingested: 0, days: 0 };

    const groups = new Map();
    for (const line of lines) {
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      const text = String(item?.text ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      if (!text) continue;
      const at = Number(item?.at) || Date.parse(String(item?.at ?? '')) || Date.now();
      const day = localDay(at);
      // 同一天里，不同私聊、不同群是各说各的：混成一条会读成一整场对话。
      const key = String(item?.key ?? '').trim();
      const bucket = `${day}|${key}`;
      if (!groups.has(bucket)) groups.set(bucket, { day, key, list: [] });
      groups.get(bucket).list.push({
        at,
        text,
        speaker: String(item?.speaker ?? ''),
        channel: String(item?.channel ?? ''),
        quote: String(item?.quote ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80),
      });
    }

    if (!groups.size) {
      await fs.writeFile(file, '', 'utf8');
      return { ingested: 0, days: 0 };
    }

    const now = Date.now();
    let ingested = 0;
    let days = 0;

    for (const [, group] of groups) {
      const { day, key, list } = group;
      list.sort((a, b) => a.at - b.at);
      const rendered = list.map((entry) => {
        const d = new Date(entry.at);
        const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const who = speakerName({ speaker: entry.speaker });
        // 引用了谁的哪句话写进括号里，否则隔了几条之后「对啊」这种回应对不上号。
        const quoted = entry.quote ? `（回 ${entry.quote}）` : '';
        return `${clock} ${who ? `${who}${quoted}：` : quoted}${entry.text}`;
      });
      const [, month, date] = day.split('-');
      const header = `${Number(month)}月${Number(date)}日`;
      const where = flowKeyLabel(key);
      const idSuffix = key ? `-${key.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';

      const existing = this.records.find(
        (r) => r.source === 'flow' && r.flowDay === day && String(r.flowKey ?? '') === key,
      );
      if (existing) {
        // 同一天分几次收：把新到的行接在后面，别覆盖早上已经收过的。
        const body = String(existing.text ?? '').split('\n');
        const tail = body.length > 1 ? body.slice(1) : [];
        existing.text = `${body[0] || header}\n${[...tail, ...rendered].join('\n')}`;
        existing.lastTouchAt = new Date(now).toISOString();
        existing.flowLines = (Number(existing.flowLines) || 0) + rendered.length;
      } else {
        this.records.push(
          normalizeRecord(
            {
              id: `flow-${day}${idSuffix}`,
              text: `${header}\n${rendered.join('\n')}`,
              title: where ? `${header} · ${where}` : `${header} 流水`,
              // 流水是自己的类型，不跟「一次性」混在一起：它由桥接自动攒，
              // 没有「谁说的 / 转述 / 心情」这些需要人填的东西。
              type: 'flow',
              importance: 22,
              emotional: 0,
              stability: 1.5,
              createdAt: new Date(list[0].at).toISOString(),
              lastTouchAt: new Date(now).toISOString(),
              state: 'active',
              source: 'flow',
              // 一条流水里往往混着好几个人，谁说的已经写在每一行里了；
              // 整体归属只在口径一致时才给，免得把「群友说的」记成「主人说的」。
              speaker: majority(list, 'speaker'),
              channel: majority(list, 'channel'),
              flowDay: day,
              flowKey: key,
              flowLines: rendered.length,
            },
            now,
          ),
        );
      }
      ingested += rendered.length;
      days += 1;
    }

    await this.persist();
    await this.store.event('flow', { ingested, days });
    await fs.writeFile(file, '', 'utf8');
    return { ingested, days };
  }

  /** 结构化事实：不衰减，永远在注入块里。 */
  async fact({ label, value }) {
    const now = Date.now();
    const key = String(label ?? '').trim();
    const val = String(value ?? '').trim();
    if (!key || !val) return null;
    const existing = this.records.find((r) => r.type === 'fact' && r.factLabel === key && r.state !== 'archived');
    if (existing) {
      existing.text = `${key}：${val}`;
      existing.factValue = val;
      existing.lastTouchAt = new Date(now).toISOString();
      await this.persist();
      await this.store.event('fact-update', { id: existing.id, label: key });
      return full(existing, now);
    }
    const record = normalizeRecord(
      {
        id: `f-${randomUUID().slice(0, 8)}`,
        text: `${key}：${val}`,
        type: 'fact',
        factLabel: key,
        factValue: val,
        pinned: true,
        importance: 100,
        createdAt: new Date(now).toISOString(),
        lastTouchAt: new Date(now).toISOString(),
        state: 'active',
        source: 'agent',
      },
      now,
    );
    this.records.push(record);
    await this.persist();
    await this.store.event('fact', { id: record.id, label: key });
    return full(record, now);
  }

  async forget(id) {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    if (this.records.length === before) return false;
    await this.persist();
    await this.store.event('forget', { id });
    return true;
  }

  /**
   * 手动校正一条记忆。只改传进来的字段，其余原样保留。
   * 改文本不动时间线：分数、复习次数、创建时间都不变，避免「编辑一下就变成刚记住的」。
   */
  async update(id, patch = {}) {
    const record = this.get(id);
    if (!record) return null;
    const now = Date.now();
    const allowed = [
      'text',
      'title',
      'type',
      'importance',
      'emotional',
      'tags',
      'speaker',
      'channel',
      'moodSelf',
      'moodOther',
      'voice',
      'pinned',
    ];
    const merged = { ...record };
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      if (key === 'type') {
        if (TYPES[patch.type]) merged.type = patch.type;
        continue;
      }
      if (key === 'importance') {
        merged.importance = Math.min(100, Math.max(0, Number(patch.importance) || 0));
        continue;
      }
      if (key === 'emotional') {
        merged.emotional = Math.min(10, Math.max(0, Number(patch.emotional) || 0));
        continue;
      }
      if (key === 'tags') {
        merged.tags = Array.isArray(patch.tags) ? patch.tags.map(String).slice(0, 20) : merged.tags;
        continue;
      }
      if (key === 'pinned') {
        merged.pinned = patch.pinned === true;
        continue;
      }
      if (key === 'moodSelf' || key === 'moodOther') {
        merged[key] = typeof patch[key] === 'string' ? patch[key].trim().slice(0, 40) : '';
        continue;
      }
      if (key === 'voice') {
        merged.voice = patch.voice === 'quote' ? 'quote' : 'narration';
        continue;
      }
      merged[key] = typeof patch[key] === 'string' ? patch[key].trim() : patch[key];
    }
    // fact 必须钉住；但从 fact 改成别的类型时要跟着松绑，
    // 否则「不会忘」这个标签会一直挂着，衰减也被 pinned 挡住。
    if (merged.type === 'fact') merged.pinned = true;
    else if (!Object.prototype.hasOwnProperty.call(patch, 'pinned')) merged.pinned = false;
    const next = normalizeRecord(merged, now);
    if (!next.text) return null;
    const index = this.records.findIndex((r) => r.id === id);
    if (index < 0) return null;
    this.records[index] = next;
    await this.persist();
    await this.store.event('update', { id, keys: Object.keys(patch) });
    return full(next, now);
  }

  // ── 注入 ────────────────────────────────────────────────────────────────

  block(now = Date.now()) {
    if (!this.loaded) return '';
    return renderBlock(this.records, {
      now,
      maxChars: this.settings.maxChars,
      platform: this.platform,
    });
  }

  /** 不触发复习，只预览注入块 —— 面板用。 */
  preview(now = Date.now()) {
    return {
      text: renderBlock(this.records, { now, maxChars: 100000, platform: this.platform }),
      chars: renderBlock(this.records, {
        now,
        maxChars: this.settings.maxChars,
        platform: this.platform,
      }).length,
    };
  }

  updateSettings(patch = {}) {
    if (Number.isFinite(patch.maxChars)) this.settings.maxChars = Math.max(200, Math.min(8000, patch.maxChars));
    return { ...this.settings };
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────

function lastTouchOf(record) {
  return Math.max(
    Date.parse(record.lastTouchAt ?? record.createdAt ?? 0) || 0,
    Date.parse(record.lastReviewAt ?? 0) || 0,
  );
}

/** 证据类型：这条信息是怎么来的。和事实分开记，推断才有被修正的入口。 */
export const EVIDENCE_VALUES = ['explicit', 'observed', 'inferred', 'external'];

/** 时间统一成 ISO（UTC）：外部填 +08:00 也能比大小，坏值退回 fallback。 */
function isoOr(value, fallback) {
  if (!value) return fallback;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

/** 把外部/旧格式的记录补成当前形状。 */
export function normalizeRecord(item, now = Date.now()) {
  const created = item.createdAt ?? new Date(now).toISOString();
  const record = {
    id: item.id ?? `m-${randomUUID().slice(0, 8)}`,
    text: String(item.text ?? '').trim(),
    title: item.title ?? '',
    type: TYPES[item.type] ? item.type : 'daily',
    importance: Number.isFinite(item.importance) ? item.importance : 60,
    emotional: Number.isFinite(item.emotional) ? item.emotional : 0,
    tags: Array.isArray(item.tags) ? item.tags : [],
    createdAt: created,
    lastTouchAt: item.lastTouchAt ?? item.lastSeenAt ?? created,
    lastReviewAt: item.lastReviewAt ?? null,
    reviewCount: Number.isFinite(item.reviewCount) ? item.reviewCount : 0,
    stability: Number.isFinite(item.stability) ? item.stability : undefined,
    pinned: item.pinned === true,
    state: item.state ?? 'active',
    source: item.source ?? 'import',
    factLabel: item.type === 'fact' ? String(item.factLabel ?? '记得').trim() || '记得' : item.factLabel,
    // 事实类的 value 曾经在迁移时漏写，面板一读就是空的。
    // 读的时候兜底：没有 value 就用 text，没有 label 给个默认，别再让空白传到前端。
    factValue: item.type === 'fact'
      ? String(item.factValue ?? item.text ?? '').trim().slice(0, 200)
      : item.factValue,
    mergedInto: item.mergedInto ?? null,
    covers: Array.isArray(item.covers) ? item.covers.slice(0, 40) : [],
    mergedCount: Number.isFinite(item.mergedCount) ? item.mergedCount : 0,
    // 「这是整理出来的」标记，和类型分开：类型仍是原来那条。
    merged: item.merged === true,
    // 取代关系：新记录记下它取代了谁；旧记录记下被谁取代。
    // 旧记录退出注入块，但正文留在库里，搜索还能翻到原话。
    supersedes: Array.isArray(item.supersedes) ? item.supersedes.map(String).slice(0, 20) : [],
    supersededBy: item.supersededBy ? String(item.supersededBy) : null,
    supersededAt: item.supersededAt ?? null,
    // 证据与有效时间：记下这条是哪来的、从什么时候成立。
    // 旧数据没有这两个字段，按「当事人明确说过、从创建时起成立」处理。
    evidence: EVIDENCE_VALUES.includes(item.evidence) ? item.evidence : 'explicit',
    validFrom: isoOr(item.validFrom, created),
    validTo: isoOr(item.validTo, null),
    // 使用证据：真正被翻到/复习过才加，用来给注入排序做小幅微调，不参与衰减。
    activations: Number.isFinite(item.activations) ? item.activations : 0,
    lastActivatedAt: item.lastActivatedAt ?? null,
    speaker: typeof item.speaker === 'string' ? item.speaker.trim() : '',
    channel: typeof item.channel === 'string' ? item.channel.trim() : '',
    moodSelf: typeof item.moodSelf === 'string' ? item.moodSelf.trim().slice(0, 40) : '',
    moodOther: typeof item.moodOther === 'string' ? item.moodOther.trim().slice(0, 40) : '',
    // 原话还是转述，由记录的人自己标，不靠文本猜。没标的一律当转述。
    voice: item.voice === 'quote' ? 'quote' : 'narration',
    flowDay: typeof item.flowDay === 'string' ? item.flowDay : '',
    flowKey: typeof item.flowKey === 'string' ? item.flowKey : '',
    flowLines: Number.isFinite(item.flowLines) ? item.flowLines : 0,
  };
  if (record.type === 'fact') record.pinned = true;
  return record;
}

function brief(record, now) {
  return {
    id: record.id,
    text: record.text,
    type: record.type,
    strength: Math.round(strength(record, now) * 10) / 10,
    state: record.state ?? 'active',
  };
}

function full(record, now) {
  const score = strength(record, now);
  return {
    id: record.id,
    text: record.text,
    title: record.title,
    type: record.type,
    importance: record.importance,
    emotional: record.emotional,
    tags: record.tags,
    pinned: record.pinned === true,
    // 状态不在库里硬存：settleState 只在 review 时跑，没有每日结算循环，
    // 所以 state 字段常年停在 active。这里按当前分数现推一遍，
    // 面板看到的「还在 / 在变模糊 / 沉睡了」才和注入块用的是同一个口径。
    state: record.state === 'superseded'
      ? 'superseded'
      : record.state === 'merged' ? 'merged' : score < 6 ? 'dormant' : 'active',
    source: record.source,
    createdAt: record.createdAt,
    lastTouchAt: record.lastTouchAt,
    lastReviewAt: record.lastReviewAt,
    reviewCount: record.reviewCount,
    strength: Math.round(score * 10) / 10,
    stability: Math.round(stabilityOf(record) * 10) / 10,
    span: humanSpan(stabilityOf(record)),
    factLabel: record.factLabel,
    factValue: record.factValue,
    mergedInto: record.mergedInto ?? null,
    covers: Array.isArray(record.covers) ? record.covers : [],
    mergedCount: Number(record.mergedCount) || 0,
    merged: record.merged === true,
    supersedes: Array.isArray(record.supersedes) ? record.supersedes : [],
    supersededBy: record.supersededBy ?? null,
    supersededAt: record.supersededAt ?? null,
    // 证据与有效时间：面板和搜索都要能看出「这是她自己说的，还是我推的」。
    evidence: EVIDENCE_VALUES.includes(record.evidence) ? record.evidence : 'explicit',
    validFrom: record.validFrom ?? record.createdAt ?? null,
    validTo: record.validTo ?? null,
    activations: Number(record.activations) || 0,
    lastActivatedAt: record.lastActivatedAt ?? null,
    speaker: record.speaker ?? '',
    channel: record.channel ?? '',
    moodSelf: record.moodSelf ?? '',
    moodOther: record.moodOther ?? '',
    voice: record.voice ?? 'narration',
    flowKey: record.flowKey ?? '',
    who: whoOf(record),
  };
}

export function humanSpan(days) {
  if (!Number.isFinite(days)) return '很久';
  if (days < 1) return '几小时';
  if (days < 45) return `${Math.round(days)} 天`;
  if (days < 365) return `${Math.round(days / 30)} 个月`;
  if (days < 3650) return `${(days / 365).toFixed(1).replace(/\.0$/, '')} 年`;
  return '很多年';
}

export { DAY_MS, TYPES, TYPE_KEYS };
