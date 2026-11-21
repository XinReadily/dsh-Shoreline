// 被动疲倦：每轮累积 +1.5、深夜 +3（2026-11-20 起按原值的 75%），不经过倍率、不吃递减。
import { createState, decayState, tickFatigue } from '../lib/mood/engine.js';

const H = 3600 * 1000;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

const t0 = Date.parse('2026-11-14T12:00:00+08:00');
let s = createState(t0);
check('从日常值 10 起', near(s.values.fatigue, 10), String(s.values.fatigue));

s = tickFatigue(s, 1.5, { now: t0 + 1000 });
check('白天一轮 +1.5', near(s.values.fatigue, 11.5), String(s.values.fatigue));

s = tickFatigue(s, 3, { now: t0 + 2000 });
check('深夜一轮 +3', near(s.values.fatigue, 14.5), String(s.values.fatigue));

s = tickFatigue(s, 0, { now: t0 + 3000 });
s = tickFatigue(s, -5, { now: t0 + 4000 });
check('0 和负数不改状态', near(s.values.fatigue, 14.5), String(s.values.fatigue));

// 6 小时半衰期：先掉一半再累加，验证 tick 是「先结算再推」。
const later = t0 + 6 * H;
const decayed = decayState(s, later);
const expectedBefore = 10 + (14.5 - 10) * 0.5;
check('6 小时后先衰减到 12.25', near(decayed.values.fatigue, expectedBefore, 0.2), String(decayed.values.fatigue));
const afterTick = tickFatigue(decayed, 1.5, { now: later + 1000 });
check('衰减后一轮 +1.5（不是从旧值直接加）', near(afterTick.values.fatigue, expectedBefore + 1.5, 0.3), String(afterTick.values.fatigue));

// 连续多轮不封顶（上限只到维度 100）。
let many = createState(t0);
for (let i = 0; i < 40; i++) many = tickFatigue(many, 3, { now: t0 + i * 60000 });
check('40 轮深夜累积到 100（维度上限）', near(many.values.fatigue, 100), String(many.values.fatigue));

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
