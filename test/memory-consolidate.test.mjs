// 临时验证：合并只并同类型同一天，合并产物保留原类型 + merged 标记
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MemoryService } from '../lib/memory/service.js';
import { planConsolidation } from '../lib/memory/engine.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shl-mem-test-'));
const svc = new MemoryService({ dir });
await svc.init();

const at = new Date(Date.now() - 150 * 86400000).toISOString();
const rec = (id, type, channel, i) => ({
  id,
  type,
  text: `这是第${i}条测试记忆，内容够长能过八字的门槛。`,
  importance: 50,
  emotional: 0,
  createdAt: at,
  lastTouchAt: at,
  state: 'active',
  source: 'agent',
  channel,
  voice: 'narration',
  speaker: '',
  pinned: false,
});

svc.records = [
  rec('d1', 'daily', 'private', 1),
  rec('d2', 'daily', 'private', 2),
  rec('d3', 'daily', 'private', 3),
  rec('d4', 'daily', 'private', 4),
  rec('e1', 'ephemeral', 'private', 5),
  rec('e2', 'ephemeral', 'private', 6),
  rec('e3', 'ephemeral', 'private', 7),
  rec('g1', 'daily', 'group', 8),
  rec('g2', 'daily', 'group', 9),
];

const plans = planConsolidation(svc.records, { now: Date.now() });
const summary = plans.map((p) => `${p.type}/${p.channel}/${p.records.length}`);
console.log('plans:', summary);
const okPlans =
  plans.length === 3 &&
  plans.some((p) => p.type === 'daily' && p.channel === 'private' && p.records.length === 4) &&
  plans.some((p) => p.type === 'ephemeral' && p.channel === 'private' && p.records.length === 3) &&
  plans.some((p) => p.type === 'daily' && p.channel === 'group' && p.records.length === 2);
console.log('分桶正确:', okPlans);

const result = await svc.consolidate();
console.log('consolidate:', result);

const merged = svc.records.filter((r) => r.merged === true);
console.log('产物:', merged.map((r) => `${r.type}/${r.channel}/${r.mergedCount}`));
const okType = merged.length === 3 && merged.filter((r) => r.type === 'daily').length === 2 && merged.filter((r) => r.type === 'ephemeral').length === 1;
console.log('产物保留原类型:', okType);

const listedDailyMerged = svc.list({ type: 'daily', merged: true, limit: 50 }).items;
console.log('类型+合并叠加:', listedDailyMerged.map((r) => `${r.type}/${r.merged}`));
const okList = listedDailyMerged.length === 2 && listedDailyMerged.every((r) => r.type === 'daily' && r.merged === true);
console.log('叠加筛选正确:', okList);

const allMerged = svc.list({ merged: true, limit: 50 }).items;
console.log('只看合并后:', allMerged.length);
console.log('stats.mergedGroups:', svc.stats().mergedGroups);

const ok = okPlans && okType && okList && allMerged.length === 3 && svc.stats().mergedGroups === 3;
console.log(ok ? 'PASS' : 'FAIL');
await fs.rm(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
