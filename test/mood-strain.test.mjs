// 委屈磨关系：30~60 走软规则（每窗口扣一点、封底 45），60 以上交给 G60-I 硬联动，两段不叠加。
import assert from 'node:assert/strict';
import {
  createState, applyShift, closenessTo,
} from '../lib/mood/engine.js';

const TARGET = 'qq:1';
const MIN = 60 * 1000;
const base = Date.parse('2026-11-14T12:00:00+08:00');

function make(g, i = 60) {
  const s = createState(base - MIN);
  s.values.grievance = g;
  s.closeness[TARGET] = i;
  return s;
}

function dropOnce(g) {
  const s = make(g);
  const before = closenessTo(s, TARGET);
  const next = applyShift(s, {}, { now: base, target: TARGET, ownerTarget: TARGET });
  return before - closenessTo(next, TARGET);
}

// 1) 30~60 之间会磨，但单次幅度有限
const d45 = dropOnce(45);
const d59 = dropOnce(59.9);
assert.ok(d45 > 0, '委屈 45 时应当开始磨关系');
assert.ok(d59 > d45, '委屈越重，单次扣得越多');
assert.ok(d59 < 2.5, `单次扣幅不应过大，实际 ${d59}`);

// 2) 60 前后不跳变：59.9 与 60.1 的单次扣幅差不到一倍
const d60 = dropOnce(60.1);
assert.ok(d60 > 0, '过 60 后由 G60-I 接手');
assert.ok(d60 / d59 < 1.8, `60 前后单次扣幅应平滑衔接：59.9→${d59}，60.1→${d60}`);

// 3) 封底 45：委屈一直 45 时磨到 45 附近就停；已经低于 45 时不再补扣
{
  let s = make(45, 50);
  let now = base;
  for (let i = 0; i < 10; i += 1) {
    now += 30 * MIN;
    s.values.grievance = 45; // 模拟委屈一直压着不散
    s = applyShift(s, {}, { now, target: TARGET, ownerTarget: TARGET });
  }
  const v = closenessTo(s, TARGET);
  assert.ok(v >= 43.5 && v < 46, `应磨到 45 附近（衰减另算），实际 ${v}`);
}
{
  const s = make(45, 44);
  const next = applyShift(s, {}, { now: base, target: TARGET, ownerTarget: TARGET });
  assert.ok(closenessTo(next, TARGET) >= 43.9, '亲密已低于 45 时，软规则不应继续扣');
}

// 4) 60 以上不受 45 封底限制（走硬联动）
{
  let s = make(65, 60);
  let now = base;
  for (let i = 0; i < 40; i += 1) {
    now += 30 * MIN;
    s.values.grievance = 65;
    s = applyShift(s, {}, { now, target: TARGET, ownerTarget: TARGET });
  }
  const v = closenessTo(s, TARGET);
  assert.ok(v < 45, `委屈 65 时亲密应能跌破 45，实际 ${v}`);
}

// 5) 委屈低于 30 完全不磨
{
  const s = make(20, 60);
  const before = closenessTo(s, TARGET);
  const next = applyShift(s, {}, { now: base, target: TARGET, ownerTarget: TARGET });
  assert.equal(closenessTo(next, TARGET), before, '委屈 20 时不应动亲密');
}

console.log('PASS  委屈磨关系（30~60 软规则、60 以上硬联动、封底 45）');
