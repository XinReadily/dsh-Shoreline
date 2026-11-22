// 内置桥接：根目录解析、首次生成配置、依赖检查。
// 不启动真实进程，只测纯文件逻辑。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BridgeService, EMBEDDED_ROOT, resolveBridgeRoot } from '../lib/bridge/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shoreline-bridge-'));

function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(tmp, 'root-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'bridge.js'), '// stub\n', 'utf8');
  fs.copyFileSync(
    path.join(pluginRoot, 'bridge', 'config.example.json'),
    path.join(root, 'config.example.json'),
  );
  return root;
}

let pass = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  pass += 1;
};

// 1) 显式路径优先
const explicit = makeTmpRoot();
ok(resolveBridgeRoot({ bridgeRoot: explicit }) === explicit, '显式 bridgeRoot 生效');

// 2) embedded 强制用插件自带
ok(resolveBridgeRoot({ embedded: true }) === EMBEDDED_ROOT, 'embedded 指向插件 bridge/');
ok(fs.existsSync(path.join(EMBEDDED_ROOT, 'src', 'bridge.js')), '插件 bridge/ 里有桥接入口');
ok(fs.existsSync(path.join(EMBEDDED_ROOT, 'src', 'lib', 'sticker-limits.mjs')), 'src/lib 子目录一起 vendored');
ok(fs.existsSync(path.join(EMBEDDED_ROOT, 'scripts', 'build-agent-preset-patches.mjs')), 'preset 生成器一起 vendored');
ok(fs.existsSync(path.join(EMBEDDED_ROOT, 'public', 'console.html')), '内置控制台页面一起 vendored');
ok(fs.existsSync(path.join(EMBEDDED_ROOT, 'dsh', 'agent-presets', 'qq-chat-v2', 'agent.cordis.yml')), '预设源一起 vendored');

// 3) 首次运行生成配置：随机口令、默认工作区、默认预设
const root = makeTmpRoot();
const svc = new BridgeService({ root });
const before = fs.existsSync(svc.configPath);
const created = svc.ensureConfig();
ok(!before, '生成前没有 config.json');
ok(created.created === true, 'ensureConfig 报告已生成');
const cfg = JSON.parse(fs.readFileSync(svc.configPath, 'utf8'));
ok(/^[0-9a-f]{32}$/.test(cfg.consoleToken), 'consoleToken 是 32 位十六进制');
ok(cfg.consolePort === 3100, 'consolePort 默认 3100');
ok(cfg.agentPreset === 'qq-chat', '一期 agentPreset 保持 qq-chat');
ok(cfg.socialV2?.agentPreset === 'qq-chat-v2', '二期 socialV2.agentPreset 默认 qq-chat-v2');
ok(cfg.sessionCwd.endsWith(path.join('.dsh', 'qq-chat-work')), 'sessionCwd 默认 ~/.dsh/qq-chat-work');
ok(cfg.snowluma.wsUrl === 'ws://127.0.0.1:3001', 'snowluma wsUrl 默认');

// 4) 再次调用不覆盖已有配置
const again = svc.ensureConfig();
ok(again.created === false, '已有配置时不重复生成');
ok(JSON.parse(fs.readFileSync(svc.configPath, 'utf8')).consoleToken === cfg.consoleToken, '口令保持不变');

// 5) 缺依赖时明确报错（临时目录没有 node_modules，也不是内置根）
const deps = svc.ensureDeps();
ok(deps.ok === false, '缺依赖时 ensureDeps 返回失败');
ok(Array.isArray(deps.missing) && deps.missing.length > 0, '列出缺失的依赖');
ok(typeof deps.hint === 'string' && deps.hint.length > 0, '给出可操作的提示');

// 6) status() 在配置缺失时也能自动生成，不抛错
const root2 = makeTmpRoot();
const svc2 = new BridgeService({ root: root2 });
ok(!fs.existsSync(svc2.configPath), 'status 前没有配置');
await svc2.status();
ok(fs.existsSync(svc2.configPath), 'status() 自动生成配置');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`bridge-embedded: ${pass} 项通过`);
