// 更新模块的纯逻辑测试：版本比较、跳过规则、本地版本读取、tar 解析。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compareVersions, isPrunablePath, parseTarEntries, pickUpdateRef, readLocalVersion, shouldSkipUpdatePath } from '../lib/update.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
};

function tarHeader(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');
  h.write('0000000\0', 116, 8, 'ascii');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  h.write('00000000000\0', 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  return h;
}

function makeTar(entries) {
  const chunks = [];
  for (const { name, content } of entries) {
    const data = Buffer.from(content, 'utf8');
    chunks.push(tarHeader(name, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

test('版本比较：相等', () => assert.equal(compareVersions('0.10.2', '0.10.2'), 0));
test('版本比较：补丁号更大', () => assert.equal(compareVersions('0.10.3', '0.10.2'), 1));
test('版本比较：主版本更大', () => assert.equal(compareVersions('1.0.0', '0.99.9'), 1));
test('版本比较：小版本更小', () => assert.equal(compareVersions('0.9.9', '0.10.0'), -1));
test('版本比较：忽略 v 前缀', () => assert.equal(compareVersions('v0.10.2', '0.10.2'), 0));
test('版本比较：缺位补 0', () => assert.equal(compareVersions('0.10', '0.10.0'), 0));
test('本地版本能读到语义化版本', () => {
  const v = readLocalVersion();
  assert.match(v, /^\d+\.\d+\.\d+/);
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  assert.equal(v, pkg.version);
});
test('更新 ref：release 用带 v 的原始 tag', () => {
  assert.equal(pickUpdateRef({ kind: 'release', tag: 'v0.12.0', latest: '0.12.0' }), 'v0.12.0');
});
test('更新 ref：commit 走 main', () => {
  assert.equal(pickUpdateRef({ kind: 'commit', latest: '0.11.1' }), 'main');
});
test('更新 ref：显式 ref 优先，且空串不算', () => {
  assert.equal(pickUpdateRef({ kind: 'release', tag: 'v0.12.0' }, 'v0.11.9'), 'v0.11.9');
  assert.equal(pickUpdateRef({ kind: 'release', tag: 'v0.12.0' }, '  '), 'v0.12.0');
});
test('跳过用户配置与真实提示词', () => {
  assert.equal(shouldSkipUpdatePath('presets/qq-chat-v2.patch.yml'), true);
  assert.equal(shouldSkipUpdatePath('bridge/config.json'), true);
  assert.equal(shouldSkipUpdatePath('bridge/state/sessions.json'), true);
  assert.equal(shouldSkipUpdatePath('node_modules/x/index.js'), true);
  assert.equal(shouldSkipUpdatePath('.git/HEAD'), true);
});
test('跳过备份文件', () => {  assert.equal(shouldSkipUpdatePath('client.js.bak-before-split'), true);
  assert.equal(shouldSkipUpdatePath('lib/bridge/service.js.bak-20260101'), true);
});
test('清理范围：只动代码目录里的代码文件', () => {
  assert.equal(isPrunablePath('client/old-panel.js'), true);
  assert.equal(isPrunablePath('lib/bridge/old.mjs'), true);
  assert.equal(isPrunablePath('test/old.test.mjs'), true);
  assert.equal(isPrunablePath('presets/old.patch.yml'), false);
  assert.equal(isPrunablePath('seed/memories.json'), false);
  assert.equal(isPrunablePath('README.md'), false);
  assert.equal(isPrunablePath('client.js.bak-before-split'), false);
  assert.equal(isPrunablePath(''), false);
});
test('正常代码文件不跳过', () => {
  assert.equal(shouldSkipUpdatePath('lib/memory/engine.js'), false);
  assert.equal(shouldSkipUpdatePath('client/20-memory.js'), false);
  assert.equal(shouldSkipUpdatePath('bridge/src/bridge.js'), false);
  assert.equal(shouldSkipUpdatePath('README.md'), false);
});
test('tar 解析：读出文件与内容', () => {
  const tar = makeTar([
    { name: 'repo-main/package.json', content: '{"name":"x"}' },
    { name: 'repo-main/lib/a.js', content: 'export const a = 1;\n' },
  ]);
  const entries = parseTarEntries(tar);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'repo-main/package.json');
  assert.equal(entries[0].data.toString('utf8'), '{"name":"x"}');
  assert.equal(entries[1].name, 'repo-main/lib/a.js');
});
test('tar 解析：gzip 解压后同样能读', () => {
  const tar = makeTar([{ name: 'x-main/README.md', content: '# hi\n' }]);
  const entries = parseTarEntries(zlib.gunzipSync(zlib.gzipSync(tar)));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.toString('utf8'), '# hi\n');
});

console.log(`\n${passed} 项全部通过`);
