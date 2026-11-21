// 证据与有效时间：这条是哪来的、什么时候成立、旧说法从哪一刻失效
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MemoryService, normalizeRecord } from '../lib/memory/service.js';
import { renderBlock } from '../lib/memory/engine.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shl-evidence-'));
const svc = new MemoryService({ dir });
await svc.init();

// 1. 不填 evidence 就是 explicit（当事人明确说过）
const plain = await svc.remember({ text: '主人说他不吃香菜。', type: 'fact', factLabel: '不吃', factValue: '香菜' });
const okDefault = plain.evidence === 'explicit' && Boolean(plain.validFrom) && plain.validTo === null;
console.log('默认 explicit:', okDefault, plain.evidence, plain.validFrom, plain.validTo);

// 2. 显式写 inferred，注入块里要能认出来（fact 走单独一行，这里用 opinion）
const guess = await svc.remember({
  text: '我猜主人最近在忙考试，回消息都短了一截。',
  type: 'opinion',
  evidence: 'inferred',
  importance: 70,
});
const block = renderBlock(svc.records, { now: Date.now(), maxChars: 4000 });
const okMark = block.includes('〔推断〕') && block.includes('在忙考试');
console.log('推断标记:', okMark, guess.evidence);

// 3. 外部来源
const ext = await svc.remember({ text: 'B 站上一个视频说 RVC 32k 只要 8GB 显存。', type: 'video', evidence: 'external' });
console.log('外部来源:', ext.evidence === 'external');

// 4. 取代时旧记录 validTo = 新记录的 validFrom
const from = '2026-11-20T10:00:00+08:00';
const fresh = await svc.remember({
  text: '主人现在能吃香菜了，说没那么讨厌了。',
  type: 'fact',
  factLabel: '不吃',
  factValue: '（没有了，现在能吃）',
  supersedes: [plain.id],
  validFrom: from,
});
const oldRaw = svc.get(plain.id);
const okValid = oldRaw.validTo === new Date(from).toISOString();
console.log('取代写 validTo:', okValid, oldRaw.validTo, fresh.validFrom);

// 5. 旧数据（没有 evidence/validFrom/validTo）按 explicit + createdAt 兼容
const legacy = normalizeRecord({ id: 'm-legacy01', text: '旧格式的一条记录。', type: 'daily', createdAt: '2026-01-01T00:00:00.000Z' });
const okLegacy =
  legacy.evidence === 'explicit' &&
  legacy.validFrom === '2026-01-01T00:00:00.000Z' &&
  legacy.validTo === null;
console.log('旧数据兼容:', okLegacy, legacy.evidence, legacy.validFrom, legacy.validTo);

// 6. 未知 evidence 值要被夹回 explicit，不能把脏值写进库
const dirty = await svc.remember({ text: '一条 evidence 填错值的记录，应该被夹回 explicit。', type: 'daily', evidence: 'hearsay' });
console.log('脏值夹回:', dirty.evidence === 'explicit', dirty.evidence);

const ok = okDefault && okMark && ext.evidence === 'external' && okValid && okLegacy && dirty.evidence === 'explicit';
console.log(ok ? 'PASS' : 'FAIL');
await fs.rm(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
