// 网关适配：OpenQQ 安装探测、zip 解压、网关状态与配置保存。
// 全部在临时目录里跑，不碰真实 OpenQQ 与真实桥接配置。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isOpenQQInstalled,
  readOpenQQHome,
  readZipEntries,
  unzipTo,
  flattenSingleRoot,
} from '../lib/bridge/openqq.js';
import { BridgeService } from '../lib/bridge/service.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shl-gateway-'));
const cleanup = () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清不掉就算了 */ }
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 只用「存储」方式（method 0）拼一个合法 zip，够验证解析与解压。 */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

async function main() {
  // 1. 未安装时 isOpenQQInstalled 为 false
  const home = path.join(tmp, 'OpenQQ');
  check('未安装时 isOpenQQInstalled=false', () => {
    assert.equal(isOpenQQInstalled(home), false);
  });

  // 2. 放了 src/main.mjs 就算装过
  check('有 src/main.mjs 即视为已安装', () => {
    fs.mkdirSync(path.join(home, 'src'), { recursive: true });
    fs.writeFileSync(path.join(home, 'src', 'main.mjs'), '// stub\n', 'utf8');
    assert.equal(isOpenQQInstalled(home), true);
  });

  // 3. 读 config/openqq.json
  check('readOpenQQHome 读出端口与 token', () => {
    fs.mkdirSync(path.join(home, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'config', 'openqq.json'),
      JSON.stringify({
        version: 1,
        webPort: 17861,
        accessToken: 'tk-test',
        ws: { enabled: true, host: '127.0.0.1', port: 3002 },
        http: { enabled: false, host: '127.0.0.1', port: 5700 },
      }),
      'utf8',
    );
    const conf = readOpenQQHome(home);
    assert.equal(conf.accessToken, 'tk-test');
    assert.equal(conf.wsPort, 3002);
    assert.equal(conf.httpEnabled, false);
    assert.equal(conf.webPort, 17861);
  });

  // 4. 解析并解压 zip
  check('readZipEntries + unzipTo 解出文件内容', () => {
    const zipBuf = makeZip([
      { name: 'openqq-v0.4.0-win-x64/src/main.mjs', data: 'console.log(1)\n' },
      { name: 'openqq-v0.4.0-win-x64/config/openqq.json', data: '{"version":1}\n' },
    ]);
    const entries = readZipEntries(zipBuf);
    assert.equal(entries.length, 2);
    const zipPath = path.join(tmp, 'openqq.zip');
    fs.writeFileSync(zipPath, zipBuf);
    const dest = path.join(tmp, 'unzipped');
    fs.mkdirSync(dest, { recursive: true });
    const count = unzipTo(zipPath, dest);
    assert.equal(count, 2);
    const text = fs.readFileSync(path.join(dest, 'openqq-v0.4.0-win-x64', 'src', 'main.mjs'), 'utf8');
    assert.equal(text, 'console.log(1)\n');
  });

  // 5. 单根目录提平
  check('flattenSingleRoot 把顶层目录内容提上来', () => {
    const dest = path.join(tmp, 'flat');
    fs.mkdirSync(path.join(dest, 'only', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'only', 'sub', 'a.txt'), 'x', 'utf8');
    flattenSingleRoot(dest);
    assert.equal(fs.existsSync(path.join(dest, 'only')), false);
    assert.equal(fs.readFileSync(path.join(dest, 'sub', 'a.txt'), 'utf8'), 'x');
  });

  // 6. gatewayStatus：没装 OpenQQ 时给出提示，active=null
  const root = path.join(tmp, 'bridge-root');
  fs.mkdirSync(root, { recursive: true });
  const example = path.join(path.resolve('.', 'bridge'), 'config.example.json');
  fs.copyFileSync(example, path.join(root, 'config.json'));
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  // 指向一个肯定没在监听的端口，免得本机真开着 SnowLuma 影响断言
  cfg.snowluma = { ...(cfg.snowluma ?? {}), wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
  cfg.gateway = { kind: 'auto', openqqHome: path.join(tmp, 'nowhere') };
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  const svc = new BridgeService({ root, nodeExe: process.execPath });
  const status = await svc.gatewayStatus();
  check('gatewayStatus 报告 OpenQQ 未安装且无激活网关', () => {
    assert.equal(status.ok, true);
    assert.equal(status.openqq.installed, false);
    assert.equal(status.active, null);
    assert.equal(status.home, path.join(tmp, 'nowhere'));
    assert.ok(status.hint);
  });

  // 7. saveGateway 只改 gateway 段并留备份
  check('saveGateway 只动 gateway 并留备份', () => {
    const before = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    const result = svc.saveGateway({ kind: 'openqq', openqqHome: '  D:\\QQ\\OpenQQ  ' });
    assert.equal(result.ok, true);
    assert.equal(result.requiresRestart, true);
    const after = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(after.gateway.kind, 'openqq');
    assert.equal(after.gateway.openqqHome, 'D:\\QQ\\OpenQQ');
    assert.equal(after.ownerQQ, before.ownerQQ);
    assert.equal(after.consolePort, before.consolePort);
    const backups = fs.readdirSync(root).filter((f) => f.includes('.bak-before-gateway-'));
    assert.equal(backups.length, 1);
  });

  // 8. 非法 kind 被忽略
  check('非法 kind 不改动', () => {
    svc.saveGateway({ kind: 'whatever' });
    const after = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(after.gateway.kind, 'openqq');
  });

  console.log(`gateway.test.mjs: ${passed} checks passed`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
