// 用假的 ctx 跑一遍 apply，提前抓运行时错误（真装进 DSH 后一轮才发现太亏）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoreline-sim-'));
const calls = { tools: [], sections: [], routes: [] };

const ctx = {
  logger: { info() {}, warn: (...a) => console.log('[warn]', ...a), error: (...a) => console.log('[error]', ...a) },
  effect(fn) {
    const dispose = fn();
    return () => dispose?.();
  },
  on() {
    return () => {};
  },
  tools: {
    register(def) {
      calls.tools.push(def);
      return () => {};
    },
    restrict() {},
    guard() {},
  },
  systemPrompt: {
    section(sec) {
      calls.sections.push(sec);
      return () => {};
    },
    // shoreline 现在用 context() 注入（user 侧，不打断 system prompt 前缀缓存），
    // 但两者形状相同，这里一起收，测试照样能拿到文本。
    context(ctxDef) {
      calls.sections.push(ctxDef);
      return () => {};
    },
  },
  webServer: {
    register(route) {
      calls.routes.push(route);
      return () => {};
    },
  },
  timer: {
    interval(fn, ms) {
      return () => {};
    },
  },
};

const mod = await import('../index.js');
await mod.apply(ctx, { dataDir: path.join(tmp, 'mem'), maxChars: 1600, sectionOrder: 850 });

console.log('tools:', calls.tools.map((t) => t.name).join(', '));
console.log('sections:', calls.sections.map((s) => `${s.name}@${s.order}`).join(', '));
console.log('routes:', calls.routes.map((r) => `${r.kind} ${r.path}`).join(', '));

for (const t of calls.tools) {
  if (!t.parameters || typeof t.parameters !== 'object') console.log('!! 缺 parameters:', t.name);
  if (!t.output?.schema) console.log('!! 缺 output.schema:', t.name);
  if (typeof t.execute !== 'function') console.log('!! 缺 execute:', t.name);
}

// 跑一次真实调用，确认输出渲染不炸
const search = calls.tools.find((t) => t.name === 'memory_search');
if (search) {
  const r = await search.execute({ query: '香菜' }, {});
  const blocks = search.output.render({ query: '香菜' }, r);
  console.log('memory_search 命中:', r.hits?.length ?? 'n/a');
  console.log('渲染首块:', JSON.stringify(blocks[0]).slice(0, 160));
}

const section = calls.sections[0];
if (section) {
  const text = typeof section.text === 'function' ? section.text({}) : section.text;
  console.log('注入块前 200 字:', String(text).slice(0, 200).replace(/\n/g, ' | '));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('host-sim 通过');
