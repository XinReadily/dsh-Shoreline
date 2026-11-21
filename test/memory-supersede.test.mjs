// 取代：新说法让旧说法退场（不再进注入块），但原文仍能搜到
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MemoryService } from '../lib/memory/service.js';
import { renderBlock } from '../lib/memory/engine.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shl-supersede-'));
const svc = new MemoryService({ dir });
await svc.init();

const old = await svc.remember({ text: '主人讨厌香菜，闻到就皱眉头。', type: 'opinion', importance: 70 });
const fresh = await svc.remember({
  text: '主人现在能吃香菜了，说没那么讨厌了。',
  type: 'opinion',
  importance: 70,
  supersedes: [old.id],
});

const oldRaw = svc.get(old.id);
const okRelation =
  fresh.supersedes.includes(old.id) &&
  oldRaw.state === 'superseded' &&
  oldRaw.supersededBy === fresh.id;
console.log('关系:', okRelation, fresh.supersedes, oldRaw.state, oldRaw.supersededBy);

const block = renderBlock(svc.records, { now: Date.now(), maxChars: 4000 });
const okBlock = block.includes('现在能吃香菜') && !block.includes('讨厌香菜');
console.log('注入块:', okBlock);

const hits = await svc.search('香菜', 10);
const okSearch = hits.length === 2 && hits[0].id === fresh.id && hits[1].supersededBy === fresh.id;
console.log('搜索顺序:', okSearch, hits.map((h) => `${h.id}${h.supersededBy ? '(旧)' : ''}`));

const normal = svc.list({ limit: 50 }).items;
const onlyOld = svc.list({ state: 'superseded', limit: 50 }).items;
const okList =
  normal.length === 1 &&
  normal[0].id === fresh.id &&
  onlyOld.length === 1 &&
  onlyOld[0].id === old.id;
console.log('列表:', okList, normal.length, onlyOld.length);

// 不存在的 id 不该编造关系
const ghost = await svc.remember({
  text: '一条没有旧说法的测试记录，长度也够了。',
  type: 'opinion',
  supersedes: ['m-not-exist'],
});
const okGhost = Array.isArray(ghost.supersedes) && ghost.supersedes.length === 0;
console.log('空取代不编造:', okGhost);

const ok = okRelation && okBlock && okSearch && okList && okGhost;
console.log(ok ? 'PASS' : 'FAIL');
await fs.rm(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
