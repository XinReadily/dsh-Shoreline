#!/usr/bin/env node
// B 站信息源（不登录档）—— 同时给 CLI 和 MCP 用。
// 用法：
//   node bili.mjs hot [数量]            热榜
//   node bili.mjs search <关键词> [页]  搜索
//   node bili.mjs video <BV号>          详情
//   node bili.mjs danmaku <BV号> [数量] 弹幕高频句
//   node bili.mjs week                  每周必看
// 约定：函数一律返回**压缩后的纯文本**（不返回原始 JSON），避免把几十 KB 灌进上下文。

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safeFetch } from './http.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const HEADERS = { 'user-agent': UA, referer: 'https://www.bilibili.com/' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  let lastErr = '';
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await safeFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.code !== 0) throw new Error(`code=${body.code} ${body.message || ''}`);
      return body;
    } catch (e) {
      lastErr = e?.message ?? String(e);
      if (i < tries - 1) await sleep(600 * (i + 1));
    }
  }
  throw new Error(`${url} 失败：${lastErr}`);
}

async function getText(url, tries = 3) {
  let lastErr = '';
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await safeFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e?.message ?? String(e);
      if (i < tries - 1) await sleep(600 * (i + 1));
    }
  }
  throw new Error(`${url} 失败：${lastErr}`);
}

const num = (n) => {
  const v = Number(n || 0);
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return String(v);
};

const dur = (s) => {
  if (typeof s === 'string' && s.includes(':')) return s.trim(); // 搜索结果直接给 "3:20"
  const v = Number(s || 0);
  if (!Number.isFinite(v) || v <= 0) return '';
  const m = Math.floor(v / 60);
  const ss = String(v % 60).padStart(2, '0');
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
};

const clean = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function row(i, v, extra = '') {
  const meta = [`${v.owner?.name ?? v.author ?? '?'}`, `${num(v.stat?.view ?? v.play)}播放`];
  const d = dur(v.duration);
  if (d) meta.push(d);
  const cat = v.tname || v.typename;
  if (cat) meta.push(cat);
  const head = `${i}. ${clean(v.title)}\n   ${meta.join(' · ')} · ${v.bvid}`;
  return extra ? `${head}\n   ${extra}` : head;
}

export async function hot(n = 15) {
  // ranking/v2 现在会撞风控（code=-352），主用 popular（综合热门，同样带播放/分区）。
  const size = Math.min(Math.max(n, 1), 50);
  let list = [];
  let from = 'popular';
  try {
    const b = await getJSON(`https://api.bilibili.com/x/web-interface/popular?ps=${size}&pn=1`);
    list = (b.data?.list ?? []).slice(0, n);
  } catch {
    const b = await getJSON('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all');
    list = (b.data?.list ?? []).slice(0, n);
    from = 'ranking';
  }
  const out = [`# B站热门（${from}）${new Date().toLocaleString('zh-CN')}（${list.length} 条）`];
  list.forEach((v, i) => out.push(row(i + 1, v, clean(v.desc).slice(0, 60))));
  return out.join('\n');
}

export async function search(kw, page = 1) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(
    kw
  )}&page=${page}`;
  const b = await getJSON(url);
  const list = (b.data?.result ?? []).slice(0, 20);
  const out = [`# B站搜索「${kw}」第 ${page} 页（${list.length} 条）`];
  list.forEach((v, i) => out.push(row(i + 1, v, clean(v.description).slice(0, 60))));
  return out.join('\n');
}

export async function video(bvid) {
  const b = await getJSON(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  const d = b.data;
  const out = [];
  out.push(`# ${clean(d.title)}  (${d.bvid})`);
  out.push(
    `UP主：${d.owner?.name} ｜ 分区：${d.tname} ｜ 时长：${dur(d.duration)} ｜ 发布：${new Date(
      d.pubdate * 1000
    ).toLocaleString('zh-CN')}`
  );
  out.push(
    `播放 ${num(d.stat?.view)} ｜ 弹幕 ${num(d.stat?.danmaku)} ｜ 点赞 ${num(d.stat?.like)} ｜ 投币 ${num(
      d.stat?.coin
    )} ｜ 收藏 ${num(d.stat?.favorite)} ｜ 评论 ${num(d.stat?.reply)}`
  );
  const desc = clean(d.desc).slice(0, 400);
  if (desc && desc !== '-') out.push(`简介：${desc}`);
  const pages = d.pages ?? [];
  if (pages.length > 1) out.push(`分P：${pages.length} 个，首P cid=${pages[0].cid}`);
  else if (pages[0]) out.push(`cid=${pages[0].cid}`);
  return out.join('\n');
}

export async function danmaku(bvid, topN = 12) {
  const p = await getJSON(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`);
  const cid = p.data?.[0]?.cid;
  if (!cid) throw new Error('拿不到 cid');
  const xml = await getText(`https://comment.bilibili.com/${cid}.xml`);
  const items = [...xml.matchAll(/<d p="[^"]*">([^<]*)<\/d>/g)].map((m) => m[1].trim()).filter(Boolean);
  const counter = new Map();
  for (const t of items) counter.set(t, (counter.get(t) ?? 0) + 1);
  const ranked = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  const out = [`# ${bvid} 弹幕 ${items.length} 条，出现最多的 ${ranked.length} 句：`];
  ranked.forEach(([t, c], i) => out.push(`${i + 1}. ${t}${c > 1 ? `（刷了 ${c} 次）` : ''}`));
  const fresh = items.slice(-8).reverse();
  out.push(`\n# 末尾最新 ${fresh.length} 条：`);
  fresh.forEach((t, i) => out.push(`${i + 1}. ${t}`));
  return out.join('\n');
}

export async function week() {
  const b = await getJSON('https://api.bilibili.com/x/web-interface/popular/series/one?number=1').catch(() => null);
  if (!b?.data?.list?.length) return hot(15);
  const list = b.data.list.slice(0, 15);
  const out = [`# 每周必看（第 ${b.data?.number} 期）`];
  list.forEach((v, i) => out.push(row(i + 1, v, clean(v.desc).slice(0, 60))));
  return out.join('\n');
}

// ---- CLI ----
// 只有被当成脚本直接运行时才进 CLI；被 import（MCP server、别的模块）时保持安静。
const isCLI = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return /(bili\.mjs|bili-feed)$/i.test(entry.replace(/\\/g, '/'));
  }
})();
if (isCLI) {
  const argv = process.argv.slice(2);
  const cmd = (argv[0] || 'hot').toLowerCase();
  try {
    let text;
    if (cmd === 'hot') text = await hot(Number(argv[1]) || 15);
    else if (cmd === 'search') {
      if (!argv[1]) throw new Error('search 需要关键词');
      text = await search(argv[1], Number(argv[2]) || 1);
    } else if (cmd === 'video') {
      if (!argv[1]) throw new Error('video 需要 BV 号');
      text = await video(argv[1]);
    } else if (cmd === 'danmaku') {
      if (!argv[1]) throw new Error('danmaku 需要 BV 号');
      text = await danmaku(argv[1], Number(argv[2]) || 12);
    } else if (cmd === 'week') text = await week();
    else text = '用法：node bili.mjs hot [n] | search <关键词> [页] | video <BV> | danmaku <BV> [n] | week';
    console.log(text);
  } catch (e) {
    console.error(`ERROR ${e?.message ?? e}`);
    process.exitCode = 1;
  }
}