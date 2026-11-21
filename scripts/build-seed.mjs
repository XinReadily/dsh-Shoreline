// 从 SurfCore 的 memory-card.json 生成冷启动种子库。
//
// 旧卡里 501 条 kind=owner 其实是逐句聊天记录（平均 15 字，大量「行」「对啊」），
// recallCount 是被动注入计数而不是主动回忆 —— 直接折算会让每条都变成超长期记忆。
// 所以这里按质量分流：值得留的照类型迁移，碎片降成 ephemeral，几个小时后自然淡掉。

import fs from 'node:fs';
import path from 'node:path';
import { migrateRecord, TYPES } from '../lib/memory/engine.js';

const SRC = 'C:/Users/<user>/.dsh/surfcore/characters/<character>/memory/memory-card.json';
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'seed');
const OUT = path.join(OUT_DIR, 'memories.json');

const card = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const records = card.records ?? [];

const stats = { total: records.length, kept: 0, dropped: 0, demoted: 0, byType: {} };
const seeded = [];

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

for (const old of records) {
  const text = normalize(old.text || old.title);
  if (!text || text.length < 6) {
    stats.dropped += 1;
    continue;
  }
  // 旧卡里被动注入刷出来的 recallCount 不能当真实复习次数用。
  const recall = Math.min(Number(old.recallCount) || 0, 8);
  const record = migrateRecord(
    {
      ...old,
      text: text.slice(0, 2000),
      title: normalize(old.title).slice(0, 200),
      createdAt: old.createdAt,
      lastSeenAt: old.lastSeenAt,
      recallCount: recall,
    },
    Date.now(),
  );
  // 迁移后重算：不用 1.35^recall，改成温和的 1.08^recall，避免虚假长期记忆。
  record.stability = 0;
  record.platform = old.scope === 'shared' ? 'all' : String(old.scope || 'qq');

  // 聊天碎片：短、重要度低、没有标签支撑 —— 降成一次性记忆。
  const fragment = record.type === 'daily' && text.length < 18 && Number(old.importance) < 62;
  if (fragment) {
    record.type = 'ephemeral';
    record.importance = Math.min(record.importance, 35);
    stats.demoted += 1;
  }

  // 旧卡的 anchor / pinned 是人工判断过的，值得信。
  if (old.pinned === true || old.anchor === true) record.pinned = true;

  // 旧卡的 isInitial 只是「初次对话的前 N 条」，不代表「最初的日子」这层含义。
  // 真正值得抬成 first 的只有 firstMet / firstMeet / tags 里的 first-met。
  const isTrueFirst =
    old.firstMet === true ||
    old.kind === 'firstMeet' ||
    (Array.isArray(old.tags) && old.tags.includes('first-met'));
  if (isTrueFirst) {
    record.type = 'first';
    record.importance = Math.max(record.importance, 90);
  } else if (old.isInitial === true && text.length >= 24) {
    // 初始窗口里有内容的，抬一点权重，但不改类型。
    record.importance = Math.max(record.importance, 65);
  }

  record.migratedFrom = 'surfcore-memory-card';
  record.legacyId = old.id;
  stats.byType[record.type] = (stats.byType[record.type] ?? 0) + 1;
  stats.kept += 1;
  seeded.push(record);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// 顶层 facts 是旧卡里最干净的部分：结构化、人工确认过、不衰减。
// 有重复条目（「不吃/讨厌：香菜」和「不吃：香菜」），按 label+value 去重。
const seenFacts = new Set();
let factCount = 0;
for (const fact of card.facts ?? []) {
  const label = normalize(fact.label || fact.key);
  const value = normalize(fact.value);
  if (!label || !value) continue;
  const dedupe = value.replace(/\s+/g, '');
  if (seenFacts.has(dedupe)) continue;
  seenFacts.add(dedupe);
  factCount += 1;
  seeded.push({
    id: `fact_${String(fact.id ?? factCount).replace(/^fact_/, '')}`,
    type: 'fact',
    title: label,
    text: value,
    factLabel: label,
    platform: 'all',
    importance: 95,
    emotional: 0,
    pinned: true,
    noDecay: true,
    stability: 0,
    createdAt: fact.createdAt ?? new Date().toISOString(),
    lastReviewAt: null,
    reviewCount: 0,
    state: 'active',
    tags: [],
    migratedFrom: 'surfcore-facts',
  });
}
stats.facts = factCount;

fs.writeFileSync(
  OUT,
  `${JSON.stringify({ version: 1, seededAt: new Date().toISOString(), source: SRC, records: seeded }, null, 2)}\n`,
  'utf8',
);

console.log('原始条数：', stats.total);
console.log('保留：', stats.kept, ' 丢弃：', stats.dropped, ' 降级为一次性：', stats.demoted);
console.log('事实条数：', stats.facts);
console.log('类型分布：', stats.byType);
console.log('输出：', OUT, fs.statSync(OUT).size, 'bytes');
