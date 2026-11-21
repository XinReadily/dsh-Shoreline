// 把 client/*.js 片段按文件名顺序拼回 client.js。
// 客户端入口必须是单文件 bundle，所以源码分片段、构建产物仍是单文件。
// 用法：node scripts/build-client.mjs [--check]
//   --check 只比较，不写文件；片段与 client.js 不一致时 exit 1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dir = path.join(root, 'client');
const out = path.join(root, 'client.js');
const check = process.argv.includes('--check');

const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith('.js'))
  .sort();

if (!files.length) {
  console.error('client/ 下没有片段');
  process.exit(1);
}

const text = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');

if (check) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current === text) {
    console.log(`client.js 与 ${files.length} 个片段一致`);
    process.exit(0);
  }
  console.error(`client.js 与片段不一致，运行 node scripts/build-client.mjs 重新生成`);
  process.exit(1);
}

fs.writeFileSync(out, text, 'utf8');
console.log(`client.js <- ${files.length} 个片段，${text.split('\n').length} 行`);
