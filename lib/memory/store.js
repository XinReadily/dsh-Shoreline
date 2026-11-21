// 记忆库存储层 —— 原子写 + 事件日志 + 导出桥接文件。
//
// 为什么是 JSON 而不是数据库：
//   765 条记忆量级下，全量读写只要几毫秒，没有索引需求。
//   JSON 的好处是可以直接 cat 出来看、可以 git、坏了能手改。
//   代价是并发写会互相覆盖，所以这里用「写临时文件 + rename」的原子写，
//   外加一个进程内的串行队列（同一个插件实例不会有并发写）。

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const VERSION = 1;

function defaultState() {
  return { version: VERSION, records: [], factsMigrated: false };
}

async function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

/** 进程内串行化，避免两个工具调用同时改库。 */
function makeLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => {},
      () => {},
    );
    return run;
  };
}

export class Store {
  constructor({ dir, exportPath = null }) {
    this.dir = dir;
    this.file = path.join(dir, 'memories.json');
    this.eventsFile = path.join(dir, 'events.jsonl');
    this.inboxFile = path.join(dir, 'inbox.jsonl');
    this.exportPath = exportPath;
    this.lock = makeLock();
    this.cache = null;
    this.cacheMtime = 0;
  }

  ensureSync() {
    fsSync.mkdirSync(this.dir, { recursive: true });
  }

  async read() {
    try {
      const stat = await fs.stat(this.file);
      if (this.cache && stat.mtimeMs === this.cacheMtime) return this.cache;
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.records)) throw new Error('bad shape');
      this.cache = { ...defaultState(), ...parsed };
      this.cacheMtime = stat.mtimeMs;
      return this.cache;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.cache = defaultState();
        return this.cache;
      }
      // 坏了不要静默覆盖：留个 .broken 副本再重置。
      try {
        await fs.copyFile(this.file, `${this.file}.broken-${Date.now()}`);
      } catch {
        /* ignore */
      }
      this.cache = defaultState();
      return this.cache;
    }
  }

  async write(state) {
    this.ensureSync();
    await atomicWrite(this.file, `${JSON.stringify(state, null, 2)}\n`);
    try {
      const stat = await fs.stat(this.file);
      this.cache = state;
      this.cacheMtime = stat.mtimeMs;
    } catch {
      this.cache = null;
    }
  }

  async all() {
    const state = await this.read();
    return state.records;
  }

  async get(id) {
    const records = await this.all();
    return records.find((r) => r.id === id) ?? null;
  }

  /** 插入或整条替换。 */
  async upsert(record) {
    return this.lock(async () => {
      const state = await this.read();
      const index = state.records.findIndex((r) => r.id === record.id);
      if (index >= 0) state.records[index] = record;
      else state.records.push(record);
      await this.write(state);
      return record;
    });
  }

  async upsertMany(records) {
    return this.lock(async () => {
      const state = await this.read();
      const byId = new Map(state.records.map((r) => [r.id, r]));
      for (const record of records) byId.set(record.id, record);
      state.records = [...byId.values()];
      await this.write(state);
      return records.length;
    });
  }

  async remove(id) {
    return this.lock(async () => {
      const state = await this.read();
      const before = state.records.length;
      state.records = state.records.filter((r) => r.id !== id);
      await this.write(state);
      return before !== state.records.length;
    });
  }

  /** 全量替换（衰减结算、批量迁移用）。 */
  async replaceAll(records) {
    return this.lock(async () => {
      const state = await this.read();
      state.records = records;
      await this.write(state);
      return records.length;
    });
  }

  /** 追加一条事件，用于之后回溯「它为什么变得这么模糊」。 */
  async event(kind, payload = {}) {
    this.ensureSync();
    const line = JSON.stringify({ at: new Date().toISOString(), kind, ...payload });
    await fs.appendFile(this.eventsFile, `${line}\n`, 'utf8');
  }

  /** 读取外部投递的 inbox（一行一条 JSON），读完清空。 */
  async drainInbox() {
    let raw = '';
    try {
      raw = await fs.readFile(this.inboxFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const rows = [];
    for (const line of raw.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      try {
        rows.push(JSON.parse(text));
      } catch {
        /* 跳过坏行 */
      }
    }
    await atomicWrite(this.inboxFile, '');
    return rows;
  }
}

export { VERSION as STORE_VERSION, defaultState };
