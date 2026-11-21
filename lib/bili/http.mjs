// 强制 IPv4 的 HTTP 客户端。
//
// 为什么不用全局 fetch：这台机器到 B 站的 IPv6 路由不通，但 undici 的 Happy Eyeballs
// 在「IPv6 TCP 连上了、TLS 却挂住」时不会及时回落到 IPv4，于是 fetch 会一直等到超时；
// 而 curl -4 和 https.get({ family: 4 }) 都是 70~160ms 就回来（2026-11-21 实测 8/8 次成功）。
// 所以 B 站相关的请求统一走这里，显式 family: 4。

import http from 'node:http';
import https from 'node:https';

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 20000;

function once(url, opts = {}, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(new Error(`invalid url: ${url}`));
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const signal = opts.signal;
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }

    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: opts.method || 'GET',
        headers: opts.headers || {},
        family: 4,
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
          res.resume();
          once(new URL(location, url).href, { ...opts, method: 'GET', body: undefined, timeout: opts.timeout }, redirectsLeft - 1)
            .then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: res.headers,
            url,
            json: async () => JSON.parse(buf.toString('utf8')),
            text: async () => buf.toString('utf8'),
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            buffer: async () => buf,
          });
        });
        res.on('error', reject);
      },
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => reject(e));
    if (signal) {
      const onAbort = () => req.destroy(new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    if (opts.body !== undefined && opts.body !== null) req.write(opts.body);
    req.end();
  });
}

/**
 * 与 fetch 兼容的最小子集：返回 { ok, status, headers, json(), text(), arrayBuffer() }。
 * 支持 method / headers / body / redirect / timeout / signal。
 */
export function safeFetch(url, opts = {}) {
  if (opts.signal && !opts.timeout) opts.timeout = 0; // 由 signal 控制，不叠 socket 超时
  return once(url, opts);
}

export default safeFetch;
