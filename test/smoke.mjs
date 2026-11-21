// 离线冒烟：不启动 DSH，直接跑 MemoryService，确认算法、存储、注入块三条线都通。
// 用临时目录，不碰 ~/.dsh/shoreline 的正式库。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { MemoryService } from '../lib/memory/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shoreline-smoke-'));
const service = new MemoryService({
  dir,
  seedPath: path.join(here, '..', 'seed', 'memories.json'),
  maxChars: 1600,
});

await service.init();
const stats = service.stats();
console.log('总条数:', stats.total);
console.log('类型分布:', stats.byType);
console.log('活跃/模糊/沉睡:', stats.active, stats.fading, stats.dormant);

const hits = service.list({ query: '香菜', limit: 3 });
console.log('\n搜索「香菜」:', hits.total, '条');
for (const item of hits.items) console.log(' -', item.strength, item.text.slice(0, 30));

const block = service.block();
console.log('\n注入块', block.length, '字：');
console.log(block);

const added = await service.remember({ text: '测试：今天试了一下新的记忆插件', type: 'daily' });
const reviewed = await service.review(added.id, 'recall');
console.log('\n新增后回想:', reviewed.strength, '分，约能撑', reviewed.span);

await fs.rm(dir, { recursive: true, force: true });
console.log('\n冒烟通过（临时库已清理）');
