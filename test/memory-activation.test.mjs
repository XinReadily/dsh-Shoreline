// 使用证据：只有真的被翻到才算一次，24h 内不重复，最多 3 次，且不碰衰减曲线
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MemoryService } from '../lib/memory/service.js';
import { addActivation, retention } from '../lib/memory/engine.js';

const HOUR = 60 * 60 * 1000;

// 1) 纯函数：24h 内只算一次
const base = { activations: 0, lastActivatedAt: null, createdAt: new Date().toISOString() };
const r1 = addActivation({ ...base }, Date.now());
const r2 = addActivation({ ...r1 }, Date.now() + 1000);
const okWindow = r1.activations === 1 && r2.activations === 1;
console.log('24h 内只算一次:', okWindow, r1.activations, r2.activations);

// 2) 纯函数：隔天再加，封顶 3
const capped = { ...base };
for (let i = 0; i < 5; i += 1) {
  capped.lastActivatedAt = new Date(Date.now() - 30 * HOUR).toISOString();
  addActivation(capped, Date.now());
}
const okCap = capped.activations === 3;
console.log('封顶 3:', okCap, capped.activations);

// 3) 激活不参与衰减曲线：retention 只看 stability / lastTouch
const decayBase = { type: 'opinion', createdAt: new Date(Date.now() - 86400000).toISOString(), stability: 10, activations: 0 };
const withActivation = { ...decayBase, activations: 3 };
const sameRetention = Math.abs(retention(decayBase) - retention(withActivation)) < 1e-12;
console.log('不改变衰减:', sameRetention);

// 4) 经 service.search 的集成：三次搜索只记一次
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shl-activation-'));
const svc = new MemoryService({ dir });
await svc.init();
const rec = await svc.remember({ text: '主人说过想去看海，不隔着屏幕的那种。', type: 'opinion', importance: 80 });
await svc.search('海');
await svc.search('海');
await svc.search('海');
const after = svc.get(rec.id);
const okOnce = after.activations === 1;
console.log('搜索三次记一次:', okOnce, after.activations);

// 5) 把上次激活拨回 25 小时前，再搜一次 → 2
after.lastActivatedAt = new Date(Date.now() - 25 * HOUR).toISOString();
await svc.search('海');
const okNext = svc.get(rec.id).activations === 2;
console.log('隔天再加一次:', okNext, svc.get(rec.id).activations);

const ok = okWindow && okCap && sameRetention && okOnce && okNext;
console.log(ok ? 'PASS' : 'FAIL');
await fs.rm(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
