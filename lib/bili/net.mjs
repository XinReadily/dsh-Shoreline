import https from 'node:https';
import dns from 'node:dns/promises';
import { safeFetch } from './http.mjs';

// B 站域名在本机会被解析到不可达的 IP（如 175.4.62.129），undici 只试第一个就超时。
// 所以这里自己做一遍解析：先用阿里 DoH 拿一组 IP，逐个用 https.request 直连，
// 第一个连通的胜出，结果缓存起来，同一进程内不再重复探测。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ipCache = new Map();
const TIMEOUT = 12000;

async function resolveIps(host) {
  if (ipCache.has(host)) return ipCache.get(host);
  const out = [];
  try {
    const res = await safeFetch(`https://dns.alidns.com/resolve?name=${host}&type=A`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    for (const a of j.Answer || []) if (a.type === 1) out.push(a.data);
  } catch {}
  try {
    for (const ip of await dns.resolve4(host)) if (!out.includes(ip)) out.push(ip);
  } catch {}
  ipCache.set(host, out);
  return out;
}

function requestOnce(url, ip, { headers, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: ip,
      servername: u.host,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        host: u.host,
        referer: 'https://www.bilibili.com/',
        'user-agent': UA,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      timeout: TIMEOUT,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export async function biliUrl(url, opts = {}) {
  const host = new URL(url).host;
  const ips = await resolveIps(host);
  let lastErr = null;
  for (const ip of ips) {
    try {
      return await requestOnce(url, ip, opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`解析不到 ${host} 的可达地址`);
}

export async function biliJson(url, opts = {}) {
  const r = await biliUrl(url, opts);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.buffer.toString('utf8'));
}

export async function biliDownload(url, outFile, { onProgress } = {}) {
  const host = new URL(url).host;
  const ips = await resolveIps(host);
  let lastErr = null;
  for (const ip of ips) {
    try {
      const fs = await import('node:fs');
      const res = await new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
          host: ip,
          servername: u.host,
          port: 443,
          path: u.pathname + u.search,
          method: 'GET',
          headers: { host: u.host, referer: 'https://www.bilibili.com/', 'user-agent': UA },
          timeout: 120000,
        }, resolve);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end();
      });
      if (res.statusCode !== 200) {
        res.resume();
        throw new Error(`HTTP ${res.statusCode}`);
      }
      const total = Number(res.headers['content-length'] || 0);
      const out = fs.createWriteStream(outFile);
      let got = 0;
      for await (const chunk of res) {
        out.write(chunk);
        got += chunk.length;
        if (onProgress) onProgress(got, total);
      }
      await new Promise((r) => out.end(r));
      return { bytes: got, total };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`下载失败：${url}`);
}
