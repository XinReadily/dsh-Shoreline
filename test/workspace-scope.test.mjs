// 提示词注入的作用范围：只有 QQ 桥接那个工作区的会话能拿到记忆与情感块，
// 其他工作区（包括控制台会话）必须什么都不注入。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoreline-scope-'));
const sections = [];

const ctx = {
  logger: { info() {}, warn: (...a) => console.log('[warn]', ...a), error: (...a) => console.log('[error]', ...a) },
  effect(fn) {
    const dispose = fn();
    return () => dispose?.();
  },
  on() {
    return () => {};
  },
  tools: { register() { return () => {}; }, restrict() {}, guard() {} },
  systemPrompt: {
    section() { return () => {}; },
    context(def) {
      sections.push(def);
      return () => {};
    },
  },
  webServer: { register() { return () => {}; } },
  timer: { interval() { return () => {}; } },
};

const mod = await import('../index.js');
await mod.apply(ctx, { dataDir: path.join(tmp, 'mem'), maxChars: 1600, sectionOrder: 850 });
// init 与 seed 是异步的：等它读完再取文本，否则 block() 还是空串。
await new Promise((r) => setTimeout(r, 400));

const byName = (name) => sections.find((s) => s.name === name);
const memory = byName('shoreline-memory');
const mood = byName('shoreline-mood');

check('两个注入块都注册了', Boolean(memory && mood));
check('记忆块可调用', typeof memory?.text === 'function');

const agentAt = (cwd) => ({
  agent: { session: { header: { cwd } } },
  scope: { session: { header: { cwd } } },
});

const qq = memory.text(agentAt(path.join(os.homedir(), '.dsh', 'qq-chat-work')));
const im = memory.text(agentAt(path.join(os.homedir(), '.dsh', 'im')));
const other = memory.text(agentAt('D:\\projects\\demo'));
const tailSlash = memory.text(agentAt(path.join(os.homedir(), '.dsh', 'qq-chat-work') + '\\'));
const missing = memory.text({});

check('QQ 工作区拿到记忆块', typeof qq === 'string' && qq.length > 0, String(qq).slice(0, 40));
check('控制台工作区不注入', im === '', im.slice(0, 40));
check('其他工作区不注入', other === '', other.slice(0, 40));
check('尾斜杠/大小写不影响匹配', tailSlash.length > 0);
check('没有会话信息时不注入', missing === '');
check('情感块同样只在 QQ 工作区', mood.text(agentAt(path.join(os.homedir(), '.dsh', 'qq-chat-work'))).length > 0 && mood.text(agentAt(path.join(os.homedir(), '.dsh', 'im'))) === '');

process.exit(failed === 0 ? 0 : 1);
