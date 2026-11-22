import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  pickWheel,
  pickWheelFromHtml,
  pickSdistFromHtml,
  compareVersions,
  wheelEntries,
  tarEntries,
  extractSdist,
  pythonHome,
  pythonExe,
  ttsScriptPath,
  edgeEnvInfo,
} from '../lib/python-env.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
};

// 造一个最小 zip（存储法），用来验证 wheel 解包与 .data 拍平。
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // method 0
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc（解析不校验）
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // method 0
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(Buffer.concat([local, nameBuf, data]));
    offset += 30 + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

test('pickWheel 优先取 cp311-win_amd64', () => {
  const wheel = pickWheel([
    { filename: 'pkg-1.0-py3-none-any.whl', url: 'a' },
    { filename: 'pkg-1.0-cp311-cp311-win_amd64.whl', url: 'b' },
  ]);
  assert.equal(wheel.url, 'b');
});

test('pickWheel 回退纯 Python 轮子', () => {
  const wheel = pickWheel([{ filename: 'pkg-1.0-py3-none-any.whl', url: 'a' }]);
  assert.equal(wheel.url, 'a');
});

test('pickWheel 没有可用轮子返回 null', () => {
  assert.equal(pickWheel([{ filename: 'pkg-1.0.tar.gz', url: 'a' }]), null);
  assert.equal(pickWheel([]), null);
});

test('compareVersions 处理语义版本', () => {
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('0.5', '0.5.4'), -1);
  assert.equal(compareVersions('3.14.5', '3.14.5'), 0);
});

test('pickWheelFromHtml 从 simple 索引挑最高版本', () => {
  const html = `
    <a href="../../packages/a/aiohttp-3.9.0-cp311-cp311-win_amd64.whl#sha256=1">a</a>
    <a href="../../packages/b/aiohttp-3.14.5-cp311-cp311-win_amd64.whl#sha256=2">b</a>
    <a href="../../packages/c/aiohttp-3.14.5.tar.gz#sha256=3">c</a>
    <a href="../../packages/d/aiohttp-3.14.5-py3-none-any.whl#sha256=4">d</a>
  `;
  const hit = pickWheelFromHtml(html);
  assert.equal(hit.filename, 'aiohttp-3.14.5-cp311-cp311-win_amd64.whl');
  assert.equal(hit.score, 3);
});

test('pickWheelFromHtml 空页面返回 null', () => {
  assert.equal(pickWheelFromHtml('<html></html>'), null);
});

test('wheelEntries 解出文件并拍平 .data/platlib', () => {
  const tmp = path.join(os.tmpdir(), `shl-wheel-${process.pid}-${Date.now()}.whl`);
  const zip = makeZip({
    'pkg/__init__.py': 'x = 1\n',
    'pkg-1.0.data/platlib/pkg/_ext.py': 'y = 2\n',
    'pkg-1.0.dist-info/METADATA': 'Name: pkg\n',
  });
  fs.writeFileSync(tmp, zip);
  try {
    const entries = wheelEntries(tmp);
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['pkg-1.0.dist-info/METADATA', 'pkg/__init__.py', 'pkg/_ext.py']);
    const meta = entries.find((e) => e.name.endsWith('METADATA'));
    assert.equal(meta.data.toString('utf8').trim(), 'Name: pkg');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('wheelEntries 能解 deflate 条目', () => {
  const tmp = path.join(os.tmpdir(), `shl-wheel-d-${process.pid}-${Date.now()}.whl`);
  const name = 'pkg/a.py';
  const content = 'z = 3\n';
  // 用 zlib.deflateRawSync 造一个 method=8 的条目：复用 makeZip 太麻烦，手动拼。
  const nameBuf = Buffer.from(name, 'utf8');
  const comp = zlib.deflateRawSync(Buffer.from(content, 'utf8'));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt16LE(nameBuf.length, 26);
  const data = Buffer.concat([local, nameBuf, comp]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(Buffer.byteLength(content), 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cd = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(data.length, 16);
  fs.writeFileSync(tmp, Buffer.concat([data, cd, eocd]));
  try {
    const entries = wheelEntries(tmp);
    assert.equal(entries.length, 1);
    assert.equal(zlib.inflateRawSync(entries[0].data).toString('utf8'), content);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('路径都在用户目录下', () => {
  const home = os.homedir().toLowerCase();
  assert.equal(pythonHome().toLowerCase(), path.join(home, '.dsh', 'shoreline', 'python').toLowerCase());
  assert.ok(pythonExe().toLowerCase().startsWith(home));
  assert.ok(ttsScriptPath().toLowerCase().endsWith('tts.py'));
});

test('edgeEnvInfo 结构完整', () => {
  const info = edgeEnvInfo();
  for (const key of ['home', 'python', 'script', 'installed', 'ready', 'edgeTtsOk', 'sizeBytes']) {
    assert.ok(key in info, `缺少字段 ${key}`);
  }
  assert.equal(typeof info.ready, 'boolean');
  assert.equal(typeof info.sizeBytes, 'number');
});

test('pickSdistFromHtml 取最高版本的源码包', () => {
  const hit = pickSdistFromHtml('<a href="zhconv-1.4.2.tar.gz">a</a><a href="zhconv-1.4.3.tar.gz">b</a>');
  assert.equal(hit.filename, 'zhconv-1.4.3.tar.gz');
  assert.equal(hit.version, '1.4.3');
  assert.equal(pickSdistFromHtml('<a href="x-1.0-py3-none-any.whl">w</a>'), null);
});

test('extractSdist 只摊出包模块，不带 setup.py / tests', () => {
  const header = (name, size) => {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    return h;
  };
  const file = (name, content) => {
    const body = Buffer.from(content, 'utf8');
    const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
    return Buffer.concat([header(name, body.length), body, pad]);
  };
  const tar = Buffer.concat([
    file('zhconv-1.4.3/setup.py', 'from setuptools import setup'),
    file('zhconv-1.4.3/zhconv.py', 'def convert(t, *a): return t'),
    file('zhconv-1.4.3/tests/test_x.py', 'pass'),
    Buffer.alloc(1024),
  ]);
  const gzPath = path.join(os.tmpdir(), `shl-sdist-${process.pid}-${Date.now()}.tar.gz`);
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'shl-site-'));
  fs.writeFileSync(gzPath, zlib.gzipSync(tar));
  try {
    const names = tarEntries(tar).map((e) => e.name);
    assert.deepEqual(names, ['zhconv-1.4.3/setup.py', 'zhconv-1.4.3/zhconv.py', 'zhconv-1.4.3/tests/test_x.py']);
    assert.equal(extractSdist(gzPath, site, 'zhconv'), 1);
    assert.ok(fs.existsSync(path.join(site, 'zhconv.py')));
    assert.ok(!fs.existsSync(path.join(site, 'setup.py')));
  } finally {
    fs.rmSync(gzPath, { force: true });
    fs.rmSync(site, { recursive: true, force: true });
  }
});
