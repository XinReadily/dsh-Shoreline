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
 * - 同时把桥接运行必需的 npm 依赖（含传递依赖闭包）复制到 bridge/deps/，
 *   让没装过旧版 qq-bridge-own 的机器也能直接启动。启动时 service.js 会把
 *   bridge/deps 链成 bridge/node_modules（junction），所以 git 只跟踪 deps/。
 * - 不复制 config.json / state/ / 日志 / *.bak* / 原 node_modules。
 * - --check 只比较差异，不写文件。
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

// 桥接直接依赖；ws 的可选原生依赖与 sdk 的 peer 依赖不装也能跑
const BRIDGE_DEPS = ['ws', 'js-yaml', 'zod', '@modelcontextprotocol/sdk'];
const SKIP_DEPS = new Set(['bufferutil', 'utf-8-validate', '@cfworker/json-schema']);

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

// ── 依赖闭包 ────────────────────────────────────────────────────────────────
// 从 sourceDir/node_modules 解析直接依赖的传递闭包。pnpm 的包目录是符号链接，
// 用 realpath 取实体再复制。
function depClosure() {
  const seen = new Set();
  const queue = [...BRIDGE_DEPS];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || SKIP_DEPS.has(name)) continue;
    const dir = path.join(sourceDir, 'node_modules', name);
    const pkgFile = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    seen.add(name);
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      for (const dep of Object.keys(pkg.dependencies || {})) queue.push(dep);
    } catch {
      /* 坏包跳过 */
    }
  }
  return [...seen].sort();
}

function copyDepDir(name) {
  const real = fs.realpathSync(path.join(sourceDir, 'node_modules', name));
  const dest = path.join(targetDir, 'deps', name);
  let files = 0;
  let bytes = 0;
  const visit = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const src = path.join(dir, ent.name);
      const nextRel = path.join(rel, ent.name);
      if (ent.isDirectory()) {
        visit(src, nextRel);
      } else {
        const buf = fs.readFileSync(src);
        files += 1;
        bytes += buf.length;
        if (!checkOnly) {
          const to = path.join(dest, nextRel);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.writeFileSync(to, buf);
        }
      }
    }
  };
  visit(real, '');
  return { name, files, bytes };
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

// 5) 桥接运行依赖（ws / js-yaml / zod / @modelcontextprotocol/sdk 及其传递依赖）
//    放在 bridge/deps/，启动时由 service.js 链接成 bridge/node_modules。
let depStats = { packages: 0, files: 0, bytes: 0 };
let depMissing = [];
for (const name of depClosure()) {
  const destPkg = path.join(targetDir, 'deps', name, 'package.json');
  if (checkOnly) {
    if (!fs.existsSync(destPkg)) depMissing.push(name);
    continue;
  }
  const stat = copyDepDir(name);
  depStats.packages += 1;
  depStats.files += stat.files;
  depStats.bytes += stat.bytes;
}

if (checkOnly) {
  const diff = results.filter((r) => !r.same);
  if (diff.length === 0 && depMissing.length === 0) {
    console.log(`bridge/ 与 ${sourceDir} 一致（${results.length} 个文件 + 依赖闭包）`);
  } else {
    if (diff.length) {
      console.log(`bridge/ 有 ${diff.length} 个文件不一致：`);
      for (const d of diff) console.log(`  ${d.rel}`);
    }
    if (depMissing.length) {
      console.log(`bridge/deps 缺 ${depMissing.length} 个包：${depMissing.join(', ')}`);
    }
    process.exit(1);
  }
} else {
  const total = results.reduce((n, r) => n + (r.bytes || 0), 0);
  console.log(`已复制 ${results.length} 个文件到 ${targetDir}（${(total / 1024).toFixed(1)} KB）`);
  console.log(`依赖：${depStats.packages} 个包 / ${depStats.files} 个文件 / ${(depStats.bytes / 1048576).toFixed(1)} MB → bridge/deps/`);
}
