// 通用 OneBot 网关发现：SnowLuma 与 OpenQQ 都是 OneBot v11，
// 差别只在「从哪儿读端点与令牌」以及「HTTP 服务是否开启」。
//
// SnowLuma：按账号分文件 config/onebot_<QQ号>.json，HTTP/WS 两套 token 且不同。
// OpenQQ ：单一 config/openqq.json，一个 accessToken 同时用于正向 WS 与（可选的）HTTP，
//           默认 ws 3001、web 17860、HTTP 服务默认关闭（端口 5700 是示例值）。
//
// 这里只做「读配置 + 探端口」，不改任何用户的配置文件。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

/** OpenQQ 主目录的常见位置（配置在 <home>/config/openqq.json）。 */
export function openQQHomeCandidates({ cfg = null } = {}) {
  const out = [];
  const push = (p) => { if (p && !out.includes(p)) out.push(p); };
  const gw = cfg?.gateway ?? {};
  if (gw.openqqHome) push(String(gw.openqqHome));
  if (process.env.OPENQQ_HOME) push(process.env.OPENQQ_HOME);
  const home = process.env.USERPROFILE || process.env.HOME || '';
  for (const name of ['OpenQQ', 'openqq', 'OpenQQ-main']) {
    if (home) push(path.join(home, name));
  }
  for (const root of ['C:', 'D:', 'E:']) push(`${root}${path.sep}OpenQQ`);
  return out;
}

/**
 * 读 OpenQQ 的 config/openqq.json。
 * 返回 { file, accessToken, ws:{host,port,url}|null, http:{host,port,url}|null, webPort } 或 null。
 */
export function readOpenQQConfig(homeDir) {
  try {
    const file = path.join(String(homeDir), 'config', 'openqq.json');
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const j = JSON.parse(text);
    const ws = j?.ws ?? {};
    const http = j?.http ?? {};
    const host = (o) => String(o?.host || '127.0.0.1');
    const wsPort = Number(ws?.port) || 3001;
    const httpPort = Number(http?.port) || 5700;
    return {
      file,
      accessToken: String(j?.accessToken ?? ''),
      ws: ws?.enabled === false
        ? null
        : { host: host(ws), port: wsPort, url: `ws://${host(ws)}:${wsPort}` },
      http: http?.enabled === true
        ? { host: host(http), port: httpPort, url: `http://${host(http)}:${httpPort}` }
        : null,
      webPort: Number(j?.webPort) || 17860
    };
  } catch {
    return null;
  }
}

/** TCP 探活：端口在监听就返回 true。 */
export function portOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** 从 ws://host:port 里取 host/port。 */
export function parseWsUrl(url) {
  try {
    const u = new URL(String(url));
    const port = Number(u.port) || (u.protocol === 'wss:' ? 443 : 80);
    return { host: u.hostname, port };
  } catch {
    return null;
  }
}

/**
 * 发现 OpenQQ：先看配置目录，再看它配置里的 ws 端口是否真的在监听。
 * 返回 { ok, home, wsUrl, httpUrl, accessToken, webPort } 或 { ok:false, tried }。
 */
export async function discoverOpenQQ({ cfg = null, timeoutMs = 1500 } = {}) {
  const tried = [];
  for (const home of openQQHomeCandidates({ cfg })) {
    const conf = readOpenQQConfig(home);
    if (!conf) continue;
    if (!conf.ws) {
      tried.push({ home, ok: false, reason: 'ws 未启用' });
      continue;
    }
    const open = await portOpen(conf.ws.host, conf.ws.port, timeoutMs);
    tried.push({ home, wsUrl: conf.ws.url, open });
    if (!open) continue;
    return {
      ok: true,
      kind: 'openqq',
      home,
      file: conf.file,
      wsUrl: conf.ws.url,
      httpUrl: conf.http?.url ?? null,
      accessToken: conf.accessToken,
      webPort: conf.webPort,
      tried
    };
  }
  return { ok: false, kind: 'openqq', tried };
}
