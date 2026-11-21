// Host 侧 HTTP 路由的公共外壳。
//
// DSH 的 Client 没有直连 Host 的 RPC 通道（Client Service 只有 layout/locale/
// sessions/slots/theme/timer/uiWorkspace/workspaces），面板要数据只能由 Host 用
// webServer 开同源路由。这里把「回环 + 同源 + 方法 + connection 校验 + JSON 解析」
// 这一串重复逻辑收在一处，memory 和 bridge 两条 API 共用，避免两份实现慢慢跑偏。
//
// 校验顺序是刻意固定的：先认来源（是不是本机、是不是自己人），再看方法，最后才
// 读 body —— 反过来的话，一个不认识的来源能通过构造超大 body 拖着我们干活。

const MAX_BODY = 256 * 1024;

export function createRouter(ctx, log, { pre } = {}) {
  const disposers = [];
  // 同一个 path 只注册一次：DSH 的 webServer 按 path 去重，GET/POST 分两条注册
  // 时后一条会被吞掉，于是 POST 会落到 GET 的处理函数上、回一句「只支持 GET」。
  const byPath = new Map();

  function json(res, status, value) {
    if (res.writableEnded) return;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(value));
  }

  function isLoopback(req) {
    const address = req.socket?.remoteAddress ?? '';
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error('请求体过大');
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    const text = Buffer.concat(chunks).toString('utf8');
    return text.trim() ? JSON.parse(text) : {};
  }

  function route(method, path, handler) {
    const verb = String(method || 'GET').toUpperCase();
    let entry = byPath.get(path);
    if (!entry) {
      entry = { handlers: new Map() };
      byPath.set(path, entry);
      const self = entry;
      disposers.push(
        ctx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            try {
              if (!isLoopback(req)) return json(res, 403, { ok: false, error: '只接受本机回环访问' });
              const actual = String(req.method || 'GET').toUpperCase();
              if (actual !== 'GET' && !sameOrigin(req)) {
                return json(res, 403, { ok: false, error: '跨站请求被拒绝' });
              }
              const fn = self.handlers.get(actual);
              if (!fn) {
                const allowed = [...self.handlers.keys()].join(' 或 ');
                return json(res, 405, { ok: false, error: `只支持 ${allowed}` });
              }
              const conn = ctx.get('connection');
              // 桥接每轮唤醒的被动疲倦接口没有浏览器会话，靠「回环 + 专用路径 + 专用头」放行；
              // 本机进程本来就能读写这些文件，多一道浏览器会话校验只会让它在插件里失灵。
              const isBridgeTick =
                String(req.url || '').split('?')[0] === '/dsh-shoreline/api/mood/tick' &&
                String(req.headers['x-shoreline-tick'] || '') === '1';
              if (conn && !isBridgeTick && typeof conn.requestRejection === 'function') {
                const rejected = conn.requestRejection(req);
                if (rejected) {
                  return json(res, typeof rejected === 'number' ? rejected : 403, {
                    ok: false,
                    error: '未通过连接校验',
                  });
                }
              }
              if (pre) await pre();
              const url = new URL(req.url, 'http://127.0.0.1');
              const body = actual === 'GET' ? null : await readJson(req);
              await fn(req, res, url, body);
            } catch (error) {
              log('API 失败：', error?.message ?? error);
              try {
                json(res, 500, { ok: false, error: String(error?.message ?? error) });
              } catch {
                /* 响应已发出 */
              }
            }
          },
        }),
      );
    }
    if (entry.handlers.has(verb)) throw new Error(`路由重复注册：${verb} ${path}`);
    entry.handlers.set(verb, handler);
  }

  return {
    route,
    json,
    dispose() {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* 卸载时忽略 */
        }
      }
    },
  };
}

export { MAX_BODY };
