// 桥接面板的 HTTP 接口。和 memory/api.js 共用 lib/http.js 的校验外壳。

import { createRouter } from '../http.js';

const PREFIX = '/dsh-shoreline/api/bridge';

export function registerBridgeApi(ctx, bridge, log) {
  const router = createRouter(ctx, log);
  const { route, json } = router;

  route('GET', `${PREFIX}/status`, async (req, res) => {
    json(res, 200, { ok: true, bridge: await bridge.status() });
  });

  route('GET', `${PREFIX}/sessions`, async (req, res) => {
    json(res, 200, { ok: true, ...bridge.readSessions() });
  });

  route('GET', `${PREFIX}/logs`, async (req, res, url) => {
    const file = url.searchParams.get('file') ?? 'bridge';
    const lines = clampInt(url.searchParams.get('lines'), 1, 1000, 200);
    json(res, 200, { ok: true, ...bridge.readTail(file, lines) });
  });

  route('GET', `${PREFIX}/log-files`, async (req, res) => {
    json(res, 200, { ok: true, files: bridge.listLogs() });
  });

  route('POST', `${PREFIX}/start`, async (req, res) => {
    const result = await bridge.start();
    json(res, result.ok ? 200 : 500, result);
  });

  route('POST', `${PREFIX}/stop`, async (req, res) => {
    const result = await bridge.stop();
    json(res, result.ok ? 200 : 500, result);
  });

  route('POST', `${PREFIX}/restart`, async (req, res) => {
    const result = await bridge.restart();
    json(res, result.ok ? 200 : 500, result);
  });

  route('GET', `${PREFIX}/snowluma`, async (req, res) => {
    json(res, 200, { ok: true, snowluma: await bridge.snowLumaStatus() });
  });

  route('POST', `${PREFIX}/snowluma/start`, async (req, res) => {
    const result = await bridge.startSnowLuma();
    json(res, result.ok ? 200 : 500, result);
  });

  route('GET', `${PREFIX}/console`, async (req, res) => {
    json(res, 200, bridge.consoleUrl());
  });

  route('GET', `${PREFIX}/settings`, async (req, res) => {
    json(res, 200, bridge.readPanelConfig());
  });

  route('POST', `${PREFIX}/settings`, async (req, res, url, body) => {
    const result = bridge.savePanelConfig(body ?? {});
    json(res, result.ok ? 200 : 500, result);
  });

  return () => router.dispose();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
