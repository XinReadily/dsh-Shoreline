// mood engine v2 单测：迁移、倍率、范围、联动闸、递减、回归。
import {
  applyShift,
  createState,
  decayState,
  multipliers,
  normalizedValue,
  summarize,
} from '../lib/mood/engine.js';

const H = 3600 * 1000;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}
const near = (a, b, eps = 0.2) => Math.abs(a - b) <= eps;

// 1. 旧状态迁移
{
  const legacy = {
    at: Date.now(),
    values: { fatigue: 21.6, closeness: 50, anger: 10, grievance: 9, joy: 30.8 },
    closeness: { 'qq:10001': 90.5 },
    angerBy: { 'qq:10001': 10 },
    history: [],
  };
  const live = decayState(legacy, legacy.at);
  check('迁移带回 version 2', live.version === 2);
  check('旧亲密 90.5 → 82.9 左右', near(live.closeness['qq:10001'], 82.9, 0.5), String(live.closeness['qq:10001']));
  check('旧开心 30.8 → 约 11', near(live.values.joy, 11, 0.5), String(live.values.joy));
  check('旧疲倦 21.6 → 约 11.8', near(live.values.fatigue, 11.8, 0.5), String(live.values.fatigue));
}

// 2. 倍率与模拟一致
{
  const s = createState(Date.now());
  s.values = { fatigue: 90, anger: 10, grievance: 90, joy: 20 };
  s.closeness = { 'qq:1': 50 };
  s.angerBy = { 'qq:1': 95 };
  const m = multipliers(s, { target: 'qq:1' });
  check('极端堆叠 m_I=0.50', near(m.closeness, 0.5, 0.01), String(m.closeness));
  check('极端堆叠 m_H=0.50', near(m.joy, 0.5, 0.01), String(m.joy));
  check('极端堆叠 m_F≈1.39', near(m.fatigue, 1.39, 0.02), String(m.fatigue));
  check('极端堆叠 m_A≈1.55', near(m.anger, 1.55, 0.02), String(m.anger));
  check('极端堆叠 m_G≈1.53', near(m.grievance, 1.53, 0.02), String(m.grievance));
  check('归一化 100 → 1', normalizedValue('closeness', 100) === 1);
  check('归一化 -100 → -1', normalizedValue('joy', -100) === -1);
}

// 3. 范围夹住
{
  const t0 = Date.now();
  let s = createState(t0);
  s = applyShift(s, { closeness: -500, joy: -500 }, { now: t0 + 1, target: 'qq:1' });
  check('亲密不会低于 -100', s.closeness['qq:1'] === -100, String(s.closeness['qq:1']));
  check('开心不会低于 -100', s.values.joy === -100, String(s.values.joy));
}

// 4. 联动闸：30 分钟内第二次不触发联动
{
  const t0 = Date.now();
  let s = createState(t0);
  s = applyShift(s, { closeness: 60 }, { now: t0 + 1, target: 'qq:1' });
  const linkAt1 = s.linkAt;
  s = applyShift(s, { grievance: 40 }, { now: t0 + 5 * 60 * 1000, target: 'qq:1' });
  check('5 分钟内不重复联动', s.linkAt === linkAt1, `${linkAt1} -> ${s.linkAt}`);
  s = applyShift(s, { grievance: 40 }, { now: t0 + 31 * 60 * 1000, target: 'qq:1' });
  check('31 分钟后触发联动', s.linkAt > linkAt1, String(s.linkAt));
}

// 5. 联动方向：高怒气会拉低亲密、高亲密会拉低委屈
{
  const t0 = Date.now();
  let s = createState(t0);
  s.values.grievance = 80;
  s.closeness['qq:1'] = 80;
  s.values.anger = 80;
  const before = { I: s.closeness['qq:1'], G: s.values.grievance };
  s = applyShift(s, { fatigue: 5 }, { now: t0 + 1000, target: 'qq:1' });
  check('高怒气/委屈下亲密被拉低', s.closeness['qq:1'] < before.I, `${before.I} -> ${s.closeness['qq:1']}`);
}

// 6. 同日递减：连续触发同一条件，第二次幅度更小
{
  const t0 = Date.now();
  let s = createState(t0);
  s.values.joy = 80;
  const at = (now) => {
    s = decayState(s, now);
    s.values.grievance = 80; // 维持触发条件
    const prevJoy = s.values.joy;
    s = applyShift(s, { fatigue: 1 }, { now, target: 'qq:1' });
    return prevJoy - s.values.joy;
  };
  const d1 = at(t0 + 1000);
  const d2 = at(t0 + 31 * 60 * 1000);
  check('第二次联动幅度更小', d2 < d1, `${d1.toFixed(2)} -> ${d2.toFixed(2)}`);
}

// 7. 静置回归：推高后 7 天回到日常值附近
{
  const t0 = Date.now();
  let s = createState(t0);
  s.values.fatigue = 70;
  s.values.joy = 70;
  s.closeness['qq:1'] = 80;
  s.angerBy['qq:1'] = 60;
  s.values.grievance = 50;
  s = decayState(s, t0 + 7 * 24 * H);
  check('7 天后疲倦≈10', near(s.values.fatigue, 10, 1), String(s.values.fatigue));
  check('7 天后开心≈10', near(s.values.joy, 10, 2), String(s.values.joy));
  check('7 天后怒气≈10', near(s.angerBy['qq:1'], 10, 1), String(s.angerBy['qq:1']));
  check('7 天后委屈≈10', near(s.values.grievance, 10, 1), String(s.values.grievance));
  check('7 天后亲密仍高于 10（半衰期 120h）', s.closeness['qq:1'] > 10, String(s.closeness['qq:1']));
}

// 8. 连夸 20 次：亲密涨但有上限
{
  const t0 = Date.now();
  let s = createState(t0);
  for (let i = 0; i < 20; i++) {
    s = applyShift(s, { closeness: 8, joy: 10 }, { now: t0 + i * 5 * 60 * 1000, target: 'qq:1' });
  }
  check('连夸后亲密在 60~95 之间', s.closeness['qq:1'] >= 60 && s.closeness['qq:1'] <= 95, String(s.closeness['qq:1']));
  check('连夸后开心没顶到 100', s.values.joy < 100, String(s.values.joy));
}

// 9. summarize 带 range 和倍率
{
  const s = createState(Date.now());
  const snap = summarize(s, { target: 'qq:1' });
  check('快照带 range', Array.isArray(snap.dimensions[0].range));
  check('快照带倍率', typeof snap.multipliers.closeness === 'number');
}

// 10. 旧状态 values.closeness 不参与（亲密只看 map）
{
  const legacy = {
    at: Date.now(),
    values: { fatigue: 20, closeness: 50, anger: 10, grievance: 10, joy: 30 },
    closeness: {},
    angerBy: {},
    history: [],
  };
  const live = decayState(legacy, legacy.at);
  const snap = summarize(live, { target: 'qq:1' });
  check('没有对象记录时从日常值 10 起', near(snap.closeness, 10, 0.5), String(snap.closeness));
}

// 11. 手动调整不受递减增益影响
{
  const t0 = Date.now();
  let manual = createState(t0);
  for (let i = 0; i < 3; i++) {
    manual = applyShift(manual, { fatigue: 2 }, { now: t0 + i * 1000, target: 'qq:1', manual: true });
  }
  check('手动三次 +2 就是 +6', near(manual.values.fatigue, 16, 0.2), String(manual.values.fatigue));

  let tool = createState(t0);
  for (let i = 0; i < 3; i++) {
    tool = applyShift(tool, { fatigue: 2 }, { now: t0 + i * 1000, target: 'qq:1' });
  }
  check('工具推三次 +2 会打折', tool.values.fatigue < 16, String(tool.values.fatigue));
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
