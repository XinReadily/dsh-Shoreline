// 情感状态的存取层：一份 JSON，读的时候现结算（按半衰期回落），写的时候原子落盘。
// 不跑定时器 —— 状态只随时间衰减，读的那一刻算一遍就等价于一直在跑。

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  DIMENSIONS,
  DIM_KEYS,
  STATE_VERSION,
  applyShift,
  closenessTo,
  createState,
  decayState,
  migrateLegacy,
  normalizeTarget,
  renderMood,
  summarize,
  tickFatigue as applyFatigueTick,
} from './engine.js';

export const DEFAULT_MOOD_DIR = path.join(os.homedir(), '.dsh', 'shoreline', 'mood');

export class MoodService {
  constructor({ dir, target = '', ownerTarget = '' } = {}) {
    this.dir = dir ? path.resolve(dir) : DEFAULT_MOOD_DIR;
    this.file = path.join(this.dir, 'state.json');
    this.target = target;
    // 「主人」是谁。不给 target 推亲密时落到他身上，而不是另开一个「默认」——
    // 之前两处分开存，面板上就变成「默认」和「某个 QQ 号」两个人。
    this.ownerTarget = ownerTarget ? normalizeTarget(ownerTarget) : '';
    this.state = createState();
    this.loaded = false;
  }

  /** 空 target 一律归到主人；没有主人信息时退回默认桶。 */
  resolveTarget(raw) {
    const key = normalizeTarget(raw);
    if (key === 'default' && this.ownerTarget) return this.ownerTarget;
    return key;
  }

  async init() {
    if (this.loaded) return this;
    let dirty = false;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const values = { ...createState().values, ...(parsed?.values ?? {}) };
      // 旧的「伤心」换成「委屈」：同一个位置、同一段半衰期，只是更具体。
      // 判断要看落盘里有没有这个键——createState() 已经把新键填成默认值了，
      // 拿合并后的对象去判断会永远「已经有值」，老数据就白搬了。
      if (parsed?.values?.sadness !== undefined && parsed?.values?.grievance === undefined) {
        values.grievance = parsed.values.sadness;
        dirty = true;
      }
      delete values.sadness;
      // 「兴致」试过一版，念着别扭，退回「开心」：base 30，高是高兴、低是没劲。
      if (parsed?.values?.interest !== undefined) {
        if (parsed?.values?.joy === undefined) values.joy = parsed.values.interest;
        delete values.interest;
        dirty = true;
      }
      delete values.anger;
      const closeness = { ...(parsed?.closeness ?? {}) };
      const angerBy = { ...(parsed?.angerBy ?? {}) };
      // 旧的「默认」桶并进主人：两处本来记的就是同一个人。
      if (closeness.default !== undefined && this.ownerTarget && this.ownerTarget !== 'default') {
        const prev = Number(closeness[this.ownerTarget]);
        closeness[this.ownerTarget] = Number.isFinite(prev)
          ? Math.max(prev, Number(closeness.default) || 0)
          : Number(closeness.default);
        delete closeness.default;
        dirty = true;
      }
      // 老数据里生气还是全局一个数：搬到主人头上——那时候的气基本都是冲主人来的。
      const oldAnger = Number(parsed?.values?.anger);
      if (Number.isFinite(oldAnger) && this.ownerTarget) {
        angerBy[this.ownerTarget] = Math.max(Number(angerBy[this.ownerTarget]) || 0, oldAnger);
        dirty = true;
      }
      const loaded = {
        at: Number(parsed?.at) || Date.now(),
        version: Number(parsed?.version) || 0,
        values,
        closeness,
        angerBy,
        history: Array.isArray(parsed?.history) ? parsed.history.slice(-30) : [],
      };
      // 老状态只迁一次并立刻落盘。少了这一步，每次 decay 都会把已经迁过的值
      // 当成旧语义再迁一遍，五个维度会被反复压扁——「五项值自己变了」就是这么来的。
      if (loaded.version !== STATE_VERSION) {
        this.state = migrateLegacy(loaded);
        dirty = true;
      } else {
        this.state = loaded;
      }
    } catch {
      this.state = createState();
    }
    this.loaded = true;
    if (dirty) {
      try {
        await this.persist();
      } catch {
        // 迁移失败不影响读取，下次再试
      }
    }
    return this;
  }

  async persist() {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  /** 结算到此刻但不落盘：读路径用这个。 */
  live() {
    return decayState(this.state, Date.now(), { ownerTarget: this.ownerTarget });
  }

  /** 推动状态并落盘。 */
  async shift(changes = {}, { target = '', note = '', manual = false } = {}) {
    await this.init();
    const now = Date.now();
    const key = this.resolveTarget(target || this.target);
    this.state = applyShift(this.state, changes, { now, target: key, note, ownerTarget: this.ownerTarget, manual });
    await this.persist();
    return this.snapshot({ target: key });
  }

  /**
   * 被动疲倦：桥接每成功投递一轮唤醒调一次。同一轮（roundId）只记一次，
   * 避免重试/重复投递把疲劳刷上去。不经过倍率，也不吃递减。
   */
  async tickFatigue(amount, { roundId = '' } = {}) {
    await this.init();
    const id = String(roundId || '');
    if (id && this.state.lastTickRound === id) return this.snapshot({});
    this.state = applyFatigueTick(this.state, amount, { now: Date.now() });
    if (id) this.state.lastTickRound = id;
    await this.persist();
    return this.snapshot({});
  }

  /** 归零到日常值。 */
  async reset() {
    await this.init();
    this.state = createState(Date.now());
    await this.persist();
    return this.snapshot({});
  }

  /** 注入用：一段第一人称处境，没明显偏移时是空串。 */
  block(target = '') {
    return renderMood(this.live(), { target: this.resolveTarget(target || this.target) });
  }

  /** 面板用：五维 + 亲密度 + 最近几次推动。 */
  snapshot({ target = '' } = {}) {
    const snap = summarize(this.state, { target: this.resolveTarget(target || this.target), now: Date.now() });
    // 主人那一格换个叫法，别只显示一串 QQ 号。
    if (this.ownerTarget) {
      snap.targets = snap.targets.map((item) =>
        item.key === this.ownerTarget ? { ...item, label: `主人（QQ ${this.ownerTarget.slice(3)}）` } : item,
      );
    }
    return snap;
  }

  /** 某个对象的亲密度。 */
  closeness(target = '') {
    return closenessTo(this.live(), this.resolveTarget(target || this.target));
  }

  meta() {
    return DIM_KEYS.map((key) => ({
      key,
      label: DIMENSIONS[key].label,
      base: DIMENSIONS[key].base,
      halfLifeHours: DIMENSIONS[key].halfLifeHours,
      color: DIMENSIONS[key].color,
      perTarget: Boolean(DIMENSIONS[key].perTarget),
    }));
  }
}

export { DIMENSIONS, DIM_KEYS };
