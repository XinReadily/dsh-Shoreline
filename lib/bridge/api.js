// 桥接面板的 HTTP 接口。和 memory/api.js 共用 lib/http.js 的校验外壳。

import { createRouter } from '../http.js';
import { applyUpdate, checkUpdate, readLocalVersion } from '../update.js';

const PREFIX = '/dsh-shoreline/api/bridge';

export function registerBridgeApi(ctx, bridge, log) {
  const router = createRouter(ctx, log);
  const { route, json } = router;

  route('GET', `${PREFIX}/status`, async (req, res) => {
    json(res, 200, { ok: true, bridge: await bridge.status() });
  });

  route('GET', `${PREFIX}/sessions`, async (req, res) => {
    json(res, 200, { ok: true, ...(await bridge.readSessions()) });
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

  // —— 网关：SnowLuma / OpenQQ ——

  route('GET', `${PREFIX}/gateway`, async (req, res) => {
    json(res, 200, await bridge.gatewayStatus());
  });

  route('POST', `${PREFIX}/gateway`, async (req, res, url, body) => {
    const result = bridge.saveGateway(body ?? {});
    json(res, result.ok ? 200 : 500, result);
  });

  route('POST', `${PREFIX}/gateway/install-openqq`, async (req, res, url, body) => {
    try {
      const result = await bridge.installOpenQQ(body ?? {});
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message ?? String(error) });
    }
  });

  route('POST', `${PREFIX}/gateway/start-openqq`, async (req, res) => {
    try {
      const result = await bridge.startOpenQQ();
      json(res, result.ok ? 200 : 500, result);
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message ?? String(error) });
    }
  });

  route('GET', `${PREFIX}/console`, async (req, res) => {
    json(res, 200, bridge.consoleUrl());
  });

  // —— QQ 空间（桥接内置，P4）——
  route('GET', `${PREFIX}/qzone`, async (req, res) => {
    try {
      json(res, 200, { ok: true, data: await bridge.qzoneState() });
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message ?? String(error) });
    }
  });

  route('POST', `${PREFIX}/qzone`, async (req, res, url, body) => {
    const tool = String(body?.tool ?? '').trim();
    try {
      let data;
      if (tool === 'publish') data = await bridge.qzonePublish(body ?? {});
      else if (tool === 'profile') data = await bridge.qzoneProfile(body ?? {});
      else if (tool === 'avatar') data = await bridge.qzoneAvatar(body ?? {});
      else if (tool === 'settings') data = await bridge.qzoneSettings(body?.settings ?? body ?? {});
      else if (tool === 'state') data = await bridge.qzoneState();
      else throw new Error(`未知操作：${tool || '（空）'}`);
      json(res, 200, { ok: true, data });
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message ?? String(error) });
    }
  });

  // —— 插件版本与更新（P5）——
  // 外层 ok 恒为 true：即使去 GitHub 检查失败，也要把本地版本带回面板，
  // 否则前端拿不到 current，只能显示「—」。检查结果放在 checkOk / checkError。
  route('GET', `${PREFIX}/update`, async (req, res, url) => {
    const force = url.searchParams.get('force') === '1';
    const result = await checkUpdate({ force });
    json(res, 200, {
      ...result,
      ok: true,
      checkOk: result.ok !== false,
      checkError: result.ok === false ? String(result.error ?? '') : '',
    });
  });

  route('POST', `${PREFIX}/update`, async (req, res, url, body) => {
    try {
      const result = await applyUpdate(body ?? {});
      json(res, 200, { ...result, current: readLocalVersion() });
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message ?? String(error) });
    }
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
