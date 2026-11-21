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

  return dispose;
}
