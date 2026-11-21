// 记忆注入块的时间标注：相对间隔必须写出来，别让她自己心算成「昨天」。
import { renderBlock } from '../lib/memory/engine.js';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const now = new Date('2026-11-13T07:34:00+08:00').getTime();
const mk = (id, createdAt, text) => ({
  id,
  type: 'emotion',
  text,
  importance: 60,
  emotional: 6,
  pinned: false,
  stability: 60,
  state: 'active',
  tags: [],
  createdAt,
  lastReviewAt: createdAt,
});

const records = [
  mk('a', '2026-11-13T01:00:00+08:00', '今天凌晨说的一句足够长的测试记忆，用来检查今天标注。'),
  mk('b', '2026-11-12T09:04:28+08:00', '昨天下午聊的一句足够长的测试记忆，用来检查昨天标注。'),
  mk('c', '2026-11-08T04:56:29+08:00', '上周日聊的一句足够长的测试记忆，用来检查五天前标注。'),
  mk('d', '2026-10-28T09:00:00+08:00', '半个月前的一句足够长的测试记忆，用来检查周标注。'),
];

const block = renderBlock(records, { now, platform: 'all' });

check('块头有今天锚点', block.includes('今天：11月13日'), block.slice(0, 40));
check('今天标注正确', block.includes('11月13日（今天）'));
check('昨天标注正确', block.includes('11月12日（昨天）'));
check('五天前标注正确', block.includes('11月8日（5天前）'));
check('两周前标注正确', block.includes('10月28日（2周前）'));
check('结尾提醒按相对日期说话', block.includes('别把上周的事说成昨天'));

if (failed) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
