// 老状态（没有 version）只应迁移一次：init 之后要落盘 version=2，
// 再次加载或反复读取都不能把已经迁过的值当旧语义再压一遍。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { MoodService } from '../lib/mood/service.js';
import { STATE_VERSION, closenessTo } from '../lib/mood/engine.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mood-migrate-'));
const now = Date.now();
const legacy = {
  at: now,
  values: { fatigue: 4.6, closeness: 50, grievance: 8.3, joy: 26.7, anger: 10 },
  closeness: { 'qq:1': 81.1 },
  angerBy: { 'qq:1': 10 },
  history: [],
};
await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(legacy), 'utf8');

const service = new MoodService({ dir, target: 'qq:1', ownerTarget: 'qq:1' });
await service.init();

assert.equal(service.state.version, STATE_VERSION, '加载老状态后应带上 version=2');
const afterFirst = closenessTo(service.state, 'qq:1');
assert.ok(Math.abs(afterFirst - 66) < 1.5, `旧语义 81.1 应迁到新语义 66 附近，实际 ${afterFirst}`);

// 落盘后必须是 version=2，第二次加载不能再迁一遍
const saved = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
assert.equal(saved.version, STATE_VERSION, '迁移后应立即落盘 version=2');

const service2 = new MoodService({ dir, target: 'qq:1', ownerTarget: 'qq:1' });
await service2.init();
const afterSecond = closenessTo(service2.state, 'qq:1');
assert.ok(Math.abs(afterSecond - afterFirst) < 0.2, `第二次加载不应再迁移：${afterFirst} → ${afterSecond}`);

// 反复读取（面板每次刷新都会走 live）也不能自己往下掉
let last = afterSecond;
for (let i = 0; i < 5; i += 1) {
  const v = closenessTo(service2.live(), 'qq:1');
  assert.ok(Math.abs(v - last) < 0.2, `重复读取不应改变值：${last} → ${v}`);
  last = v;
}

await fs.rm(dir, { recursive: true, force: true });
console.log('PASS  老状态只迁移一次（version=2 落盘，重复加载/读取不再压值）');
