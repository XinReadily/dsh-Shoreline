#!/usr/bin/env node
/**
 * 把桥接源码 vendored 进插件：<plugin>/bridge/
 *
 * 用法：
 *   node scripts/vendor-bridge.mjs [--source <qq-bridge-own 目录>] [--check]
 *
 * 说明：
 * - 复制运行所需文件：src/*.js、scripts/build-agent-preset-patches.mjs、dsh/（预设源）、
 *   plugins/qq-agent-presets/（preset patch 与守卫），以及 package.json、config.example.json、
 *   LICENSE、NOTICE.md、README.md。
 * - 不复制 config.json / state/ / 日志 / *.bak* / node_modules。
 * - --check 只比较差异，不写文件。
 * - 桥接依赖由 lib/bridge/service.js 的 ensureDeps() 在首次启动时复用旧安装（junction）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');
const targetDir = path.join(pluginRoot, 'bridge');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const sourceIdx = args.indexOf('--source');
const sourceDir = sourceIdx >= 0 && args[sourceIdx + 1]
  ? path.resolve(args[sourceIdx + 1])
  : path.join(process.env.USERPROFILE || process.env.HOME || '', 'qq-bridge-own');

const SKIP_NAMES = new Set(['node_modules', 'state', 'config.json', '.git']);

function readDir(p) {
  return fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }) : [];
}

function walk(relDir) {
  const out = [];
  const visit = (abs, rel) => {
    for (const ent of readDir(abs)) {
      if (SKIP_NAMES.has(ent.name) || ent.name.includes('.bak')) continue;
      const nextRel = path.join(rel, ent.name);
      if (ent.isDirectory()) visit(path.join(abs, ent.name), nextRel);
      else out.push(nextRel);
    }
  };
  visit(path.join(sourceDir, relDir), relDir);
  return out;
}

function copyFile(rel) {
  const from = path.join(sourceDir, rel);
  const to = path.join(targetDir, rel);
  const buf = fs.readFileSync(from);
  if (checkOnly) {
    const same = fs.existsSync(to) && fs.readFileSync(to).equals(buf);
    return { rel, same, bytes: buf.length };
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  return { rel, bytes: buf.length };
}

if (!fs.existsSync(sourceDir)) {
  console.error(`找不到桥接源码目录：${sourceDir}`);
  process.exit(1);
}

const results = [];

// 1) 桥接源码（src 递归，收 .js / .mjs，跳过备份）
for (const rel of walk('src')) {
  if (!/\.(m?js)$/.test(rel) || rel.includes('.bak')) continue;
  results.push(copyFile(rel));
}

// 2) bridge.js 顶层 import 的 preset 生成器（缺了桥接起不来）
results.push(copyFile(path.join('scripts', 'build-agent-preset-patches.mjs')));

// 3) 预设源 + 生成物（内置预设，用户不装 qq-agent-presets 也能跑）
for (const rel of [...walk('dsh'), ...walk(path.join('plugins', 'qq-agent-presets'))]) {
  results.push(copyFile(rel));
}

// 3.5) 本地控制台页面（缺了控制台只会回「控制台页面缺失」）
for (const rel of walk('public')) {
  results.push(copyFile(rel));
}

// 4) 项目元数据
for (const rel of ['package.json', 'config.example.json', 'LICENSE', 'NOTICE.md', 'README.md']) {
  if (!fs.existsSync(path.join(sourceDir, rel))) continue;
  results.push(copyFile(rel));
}

if (checkOnly) {
  const diff = results.filter((r) => !r.same);
  if (diff.length === 0) {
    console.log(`bridge/ 与 ${sourceDir} 一致（${results.length} 个文件）`);
  } else {
    console.log(`bridge/ 有 ${diff.length} 个文件不一致：`);
    for (const d of diff) console.log(`  ${d.rel}`);
    process.exit(1);
  }
} else {
  const total = results.reduce((n, r) => n + (r.bytes || 0), 0);
  console.log(`已复制 ${results.length} 个文件到 ${targetDir}（${(total / 1024).toFixed(1)} KB）`);
}
