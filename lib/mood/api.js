// 情感面板的数据接口。和记忆接口共用同一个前缀与校验外壳。

import { createRouter } from '../http.js';

const PREFIX = '/dsh-shoreline/api';

export function registerMoodApi(ctx, service, log) {
  const router = createRouter(ctx, log, { pre: () => service.init() });
  const { route, json } = router;

  route('GET', `${PREFIX}/mood`, async (req, res, url) => {
    const target = String(url?.searchParams?.get('target') ?? '');
    json(res, 200, { ok: true, ...service.snapshot({ target }), meta: service.meta() });
  });

  route('POST', `${PREFIX}/mood/shift`, async (req, res, _url, body) => {
    const raw = body?.changes && typeof body.changes === 'object' ? body.changes : {};
    const changes = {};
    for (const [key, value] of Object.entries(raw)) {
      const n = Number(value);
      if (Number.isFinite(n) && n !== 0) changes[key] = Math.max(-100, Math.min(100, n));
    }
    if (!Object.keys(changes).length) {
      return json(res, 400, { ok: false, error: '没有要改的维度' });
    }
    const snap = await service.shift(changes, {
      target: String(body?.target ?? ''),
      note: String(body?.note ?? ''),
      manual: true,
    });
    json(res, 200, { ok: true, ...snap });
  });

  route('POST', `${PREFIX}/mood/tick`, async (req, res, _url, body) => {
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10) {
      return json(res, 400, { ok: false, error: 'amount 必须是 0–10 之间的正数' });
    }
    const snap = await service.tickFatigue(amount, { roundId: String(body?.roundId ?? '') });
    json(res, 200, { ok: true, ...snap });
  });

  route('POST', `${PREFIX}/mood/reset`, async (req, res) => {
    json(res, 200, { ok: true, ...(await service.reset()) });
  });

  return () => router.dispose();
}
