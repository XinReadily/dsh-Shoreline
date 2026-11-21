// Shoreline 面板的 HTTP 接口。
//
// 为什么不用 RPC：DSH 的 Client 侧 Service 只有 layout / locale / sessions / slots /
// theme / timer / uiWorkspace / workspaces，没有直连 Host 的通道。控制面板要读记忆库，
// 只能由 Host 用 webServer 开一条同源路由，Client 用 fetch 取。SurfCore 也是这么做的
// （/dsh-surfcore/api），这里沿用同样的形状，换成 /dsh-shoreline/api。

import { humanSpan } from './service.js';
import { createRouter } from '../http.js';

const PREFIX = '/dsh-shoreline/api';

export function registerApi(ctx, service, log) {
  const router = createRouter(ctx, log, { pre: () => service.init() });
  const { route, json } = router;

  route('GET', `${PREFIX}/state`, async (req, res) => {
    json(res, 200, { ok: true, stats: service.stats(), version: '0.1.0' });
  });

  route('GET', `${PREFIX}/memories`, async (req, res, url) => {
    const query = url.searchParams;
    const result = service.list({
      query: query.get('q') ?? '',
      type: query.get('type') ?? '',
      state: query.get('state') ?? '',
      merged: query.get('merged') === '1',
      hideFlow: query.get('hideFlow') === '1',
      limit: clampInt(query.get('limit'), 1, 200, 60),
      offset: clampInt(query.get('offset'), 0, 100000, 0),
    });
    json(res, 200, { ok: true, ...result });
  });

  route('GET', `${PREFIX}/prompt`, async (req, res, url) => {
    const limit = clampInt(url.searchParams.get('maxChars'), 200, 8000, service.settings.maxChars);
    const preview = service.preview();
    const trimmed =
      preview.text.length > limit ? `${preview.text.slice(0, limit)}\n…（已截断，共 ${preview.text.length} 字）` : preview.text;
    json(res, 200, { ok: true, text: trimmed, fullChars: preview.text.length, maxChars: limit });
  });

  route('GET', `${PREFIX}/types`, async (req, res) => {
    json(res, 200, { ok: true, types: Object.keys(service.stats().byType) });
  });

  route('POST', `${PREFIX}/search`, async (req, res, _url, body) => {
    const hits = await service.search(String(body?.query ?? ''), clampInt(body?.limit, 1, 12, 5));
    json(res, 200, { ok: true, items: hits });
  });

  route('POST', `${PREFIX}/review`, async (req, res, _url, body) => {
    const result = await service.review(String(body?.id ?? ''), String(body?.grade ?? 'recall'));
    if (!result) return json(res, 404, { ok: false, error: '没有这条记忆' });
    json(res, 200, { ok: true, record: result });
  });

  route('POST', `${PREFIX}/remember`, async (req, res, _url, body) => {
    const text = String(body?.text ?? '').trim();
    if (!text) return json(res, 400, { ok: false, error: '内容不能为空' });
    const record = await service.remember({
      text,
      title: String(body?.title ?? ''),
      type: String(body?.type ?? 'daily'),
      importance: clampInt(body?.importance, 0, 100, 60),
      emotional: clampInt(body?.emotional, 0, 10, 0),
      tags: Array.isArray(body?.tags) ? body.tags.map(String) : [],
      speaker: String(body?.speaker ?? ''),
      channel: String(body?.channel ?? ''),
      moodSelf: String(body?.moodSelf ?? ''),
      moodOther: String(body?.moodOther ?? ''),
      voice: String(body?.voice ?? 'narration'),
    });
    json(res, 200, { ok: true, record });
  });

  route('POST', `${PREFIX}/flow`, async (req, res) => {
    const result = await service.ingestFlow();
    json(res, 200, { ok: true, ...result });
  });

  route('POST', `${PREFIX}/update`, async (req, res, _url, body) => {
    const id = String(body?.id ?? '');
    if (!id) return json(res, 400, { ok: false, error: '缺少 id' });
    const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {};
    const record = await service.update(id, patch);
    if (!record) return json(res, 404, { ok: false, error: '没有这条记忆，或者改完内容为空' });
    json(res, 200, { ok: true, record });
  });

  route('POST', `${PREFIX}/fact`, async (req, res, _url, body) => {
    const record = await service.fact({ label: body?.label, value: body?.value });
    if (!record) return json(res, 400, { ok: false, error: '类别和内容都要填' });
    json(res, 200, { ok: true, record });
  });

  route('POST', `${PREFIX}/forget`, async (req, res, _url, body) => {
    const removed = await service.forget(String(body?.id ?? ''));
    json(res, removed ? 200 : 404, { ok: removed, error: removed ? undefined : '没有这条记忆' });
  });

  route('POST', `${PREFIX}/settings`, async (req, res, _url, body) => {
    const settings = service.updateSettings({ maxChars: Number(body?.maxChars) });
    json(res, 200, { ok: true, settings });
  });

  route('POST', `${PREFIX}/consolidate`, async (req, res, _url, body) => {
    const result = await service.consolidate({ dryRun: body?.dryRun === true });
    json(res, 200, { ok: true, ...result });
  });

  return () => router.dispose();
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export { PREFIX, humanSpan };
