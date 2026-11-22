import { createRouter } from '../http.js';

const PREFIX = '/dsh-shoreline/api';

export function registerVoiceApi(ctx, service, log) {
  const { route, json, dispose } = createRouter(ctx, log, {
    pre: () => service.init(),
  });

  route('GET', `${PREFIX}/voice`, async (req, res) => {
    json(res, 200, { ok: true, config: service.get(), status: service.status() });
  });

  route('POST', `${PREFIX}/voice`, async (req, res, url, body) => {
    const patch = body && typeof body === 'object' ? body.patch : null;
    if (!patch || typeof patch !== 'object') {
      json(res, 400, { ok: false, error: '缺少要保存的配置' });
      return;
    }
    const saved = await service.save(patch);
    json(res, 200, { ok: true, config: saved, status: service.status() });
  });

  // Edge 语音环境（嵌入式 Python + edge-tts）：先查状态，再一键装。
  route('GET', `${PREFIX}/voice/edge-env`, async (req, res) => {
    json(res, 200, { ok: true, env: service.edgeEnv(), status: service.status() });
  });

  route('POST', `${PREFIX}/voice/edge-env`, async (req, res, url, body) => {
    const force = body?.force === true;
    try {
      const env = await service.installEdgeEnv({ force });
      json(res, env.ok ? 200 : 500, { ok: env.ok, env, status: service.status() });
    } catch (error) {
      log(`[voice] Edge 环境安装失败：${error?.message ?? error}`);
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  });

  // B 站视频转写环境（faster-whisper）：复用同一个 Python，先查状态再一键装。
  route('GET', `${PREFIX}/voice/whisper-env`, async (req, res) => {
    json(res, 200, { ok: true, env: service.whisperEnv(), status: service.status() });
  });

  route('POST', `${PREFIX}/voice/whisper-env`, async (req, res, url, body) => {
    const force = body?.force === true;
    try {
      const env = await service.installWhisperEnv({ force });
      json(res, env.ok ? 200 : 500, { ok: env.ok, env, status: service.status() });
    } catch (error) {
      log(`[voice] 转写环境安装失败：${error?.message ?? error}`);
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  });

  return dispose;
}
