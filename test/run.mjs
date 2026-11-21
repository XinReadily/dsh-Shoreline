// 跑 test/ 下所有 *.test.mjs，逐个进程隔离，汇总退出码。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (!files.length) {
  console.log('test/ 下没有 *.test.mjs');
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const file = path.join(here, name);
  console.log(`\n=== ${name} ===`);
  const run = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (run.status !== 0) {
    failed += 1;
    console.log(`--- ${name} 失败（exit ${run.status}）`);
  }
}

if (failed) {
  console.log(`\n${failed} / ${files.length} 个测试文件失败`);
  process.exit(1);
}
console.log(`\n全部通过（${files.length} 个测试文件）`);
