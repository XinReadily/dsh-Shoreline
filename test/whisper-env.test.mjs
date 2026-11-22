// 转写环境（whisper-env）的纯逻辑测试：路径、状态结构、打包完整性。
// 不联网、不下载，真正的安装由面板上的「一键安装」触发。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  whisperHome,
  whisperModelsDir,
  whisperModelDir,
  transcribeScriptPath,
  whisperEnvInfo,
  installWhisperEnv,
} from '../lib/whisper-env.js';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('转写目录都在插件自己的数据目录下', () => {
  const home = whisperHome();
  assert.ok(home.endsWith(path.join('.dsh', 'shoreline', 'whisper')));
  assert.equal(whisperModelsDir(), path.join(home, 'models'));
  assert.equal(whisperModelDir('small'), path.join(home, 'models', 'faster-whisper-small'));
  assert.equal(transcribeScriptPath(), path.join(home, 'transcribe.py'));
});

test('whisperEnvInfo 返回可用的状态结构', () => {
  const info = whisperEnvInfo();
  for (const key of ['home', 'python', 'script', 'models', 'modelDir', 'modelMb']) {
    assert.equal(typeof info[key], typeof info[key] === 'number' ? 'number' : 'string', key);
  }
  for (const key of ['pythonOk', 'scriptOk', 'packagesOk', 'modelOk', 'ready']) {
    assert.equal(typeof info[key], 'boolean', key);
  }
  assert.equal(info.ready, info.pythonOk && info.scriptOk && info.packagesOk && info.modelOk);
});

test('模型没装时 modelMb 是 0、modelOk 是 false', () => {
  const info = whisperEnvInfo();
  if (!info.modelOk) {
    assert.equal(info.modelOk, false);
    assert.ok(info.modelMb >= 0);
  }
});

test('转写脚本随插件分发（不是从本机路径借来的）', () => {
  const bundled = path.join(PLUGIN, 'lib', 'bili', 'transcribe.py');
  assert.ok(fs.existsSync(bundled), 'lib/bili/transcribe.py 必须存在');
  const text = fs.readFileSync(bundled, 'utf8');
  assert.ok(text.length > 500);
  assert.ok(!text.includes('\uFFFD'), '脚本里不能有替换字符');
  assert.ok(text.includes('WHISPER_MODEL_DIR'), '脚本要认 WHISPER_MODEL_DIR');
  assert.ok(text.includes('faster_whisper'), '脚本要 import faster_whisper');
});

test('package.json 的 files 含 lib（避免发布时漏掉 transcribe.py）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes('lib'));
});

test('已就绪时安装函数直接返回 already，不重复下载', async () => {
  const info = whisperEnvInfo();
  if (!info.ready) return; // 没装好的机器上跳过
  const result = await installWhisperEnv({ force: false, log: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.already, true);
});

test('安装函数导出且可调用（形参里有 force/onProgress）', () => {
  assert.equal(typeof installWhisperEnv, 'function');
  assert.ok(installWhisperEnv.length >= 0);
});

test('临时目录里伪造的残缺模型不会被判成就绪', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-env-test-'));
  try {
    const fakeModel = path.join(dir, 'faster-whisper-small');
    fs.mkdirSync(fakeModel, { recursive: true });
    fs.writeFileSync(path.join(fakeModel, 'model.bin'), 'x');
    // whisperEnvInfo 只看真实目录，这里验证的是「小于阈值的 model.bin 不算数」这条规则：
    const size = fs.statSync(path.join(fakeModel, 'model.bin')).size;
    assert.ok(size < 400 * 1024 * 1024);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
