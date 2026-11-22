/**
 * Shoreline —— 客户端半边：DSH 设置里的「Shoreline」面板。
 *
 * 一期只装记忆：总览、检索、单条强度、回想/忘掉、注入块预览。
 * 二期这里会长出「桥接」和「人格」两个页签，所以顶层用 tabs 结构占好位置。
 *
 * 数据流：本组件 ⇄ /dsh-shoreline/api/*（同源 fetch）⇄ 宿主进程的记忆库文件。
 * Client 侧没有直连 Host 的 Service 通道，这是唯一可行路径（SurfCore 同款）。
 */
window.__ModuleLoader__.load({
  id: 'shoreline',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const { createElement: h, useCallback, useEffect, useMemo, useState } = React;

    const API = '/dsh-shoreline/api';
    const CSS_TAG = 'shoreline/panel.css';

    const TYPE_LABEL = {
      identity: '身份与关系',
      first: '最初的日子',
      promise: '约定',
      fact: '事实',
      emotion: '情绪事件',
      opinion: '偏好与观点',
      slang: '圈子梗',
      digest: '合并',
      flow: '流水',
      daily: '日常',
      ephemeral: '琐碎',
    };

    const CSS = `
.shl-app{max-width:1060px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:rgba(127,127,127,.04);box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden}
.shl-head{padding:18px 20px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(46,196,182,.08))}
.shl-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
.shl-title{margin:0;font-size:19px;font-weight:600;line-height:28px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.shl-sub{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.shl-tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;background:rgba(127,127,127,.025)}
.shl-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:8px 10px 9px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;border-radius:6px 6px 0 0}
.shl-tab:hover{background:rgba(127,127,127,.08);color:var(--dsw-alias-label-primary)}
.shl-tab.on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.shl-tab[disabled]{opacity:.42;cursor:default}
.shl-body{padding:16px 20px 18px;max-height:min(68vh,760px);overflow:auto}
.shl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.shl-stat{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:rgba(127,127,127,.03);min-width:0;overflow:hidden}
.shl-stat b{display:flex;align-items:center;gap:6px;font-size:22px;line-height:28px;font-weight:650;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shl-stat b.long{font-size:13px;line-height:20px;letter-spacing:.01em;font-weight:600}
.shl-stat span{color:var(--dsw-alias-label-tertiary);font-size:11.5px;display:block;margin-top:2px}
.shl-chips{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 10px}
.shl-chip{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:11.5px;line-height:18px;background:transparent;color:var(--dsw-alias-label-secondary)}
.shl-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.shl-chip.on{border-color:var(--dsw-alias-brand-primary);background:rgba(31,111,235,.14);color:var(--dsw-alias-label-primary)}
.shl-chip em{font-style:normal;opacity:.6;margin-left:4px}
.shl-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 12px}
.shl-input{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;min-height:29px;padding:3px 9px;min-width:240px;outline:none;font-family:inherit;flex:1}
.shl-input:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.shl-btn{background:#2f6fed;color:#fff;border:none;border-radius:6px;font-size:12.5px;min-height:29px;padding:0 12px;cursor:pointer;white-space:nowrap}
.shl-btn:disabled{opacity:.5;cursor:default}
.shl-btn:hover:not(:disabled){background:#2a63d4}
.shl-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.shl-btn2:hover:not(:disabled){background:rgba(127,127,127,.08)}
.shl-list{display:flex;flex-direction:column;gap:8px;max-height:min(52vh,520px);overflow-y:auto;padding-right:6px;overscroll-behavior:contain}
.shl-list::-webkit-scrollbar{width:8px}
.shl-list::-webkit-scrollbar-thumb{background:rgba(127,127,127,.26);border-radius:99px}
.shl-list::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.42)}
.shl-list::-webkit-scrollbar-track{background:transparent}
.shl-item{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;gap:12px;align-items:flex-start;background:rgba(127,127,127,.02)}
.shl-item:hover{background:rgba(127,127,127,.05)}
.shl-meter{width:5px;border-radius:99px;background:rgba(127,127,127,.16);align-self:stretch;position:relative;overflow:hidden;flex:0 0 auto}
.shl-meter i{position:absolute;left:0;right:0;bottom:0;border-radius:99px}
.shl-main{flex:1;min-width:0}
.shl-text{font-size:12.8px;line-height:19px;word-break:break-word;white-space:pre-wrap}
.shl-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:5px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.shl-badge{display:inline-block;font-size:10.5px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary)}
.shl-badge.ok{background:rgba(47,191,113,.16);color:#2fbf71}
.shl-badge.warn{background:rgba(255,176,32,.16);color:#b97800}
.shl-badge.dim{background:rgba(127,127,127,.10);color:var(--dsw-alias-label-tertiary)}
.shl-ops{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.shl-empty{padding:26px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
.shl-prompt{margin-top:16px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px}
.shl-prompt summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.shl-pre{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:300px;overflow:auto;margin-top:10px}
.shl-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px}
.shl-ok{color:#2fbf71;font-size:12px;margin-top:8px}
.shl-form>.shl-subh,.shl-form>.shl-note,.shl-form>.shl-chips{grid-column:1/-1}
.shl-subh{margin:14px 0 2px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:.02em;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.shl-chips-sub{margin:-4px 0 10px}
.shl-chip-sub{border-style:dashed}
.shl-chip-sub.on{border-style:solid}
.shl-cap{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.shl-cap .shl-btn+.shl-btn{margin-left:4px}
.shl-cap-l{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.shl-cap-i{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;min-height:29px;padding:3px 9px;width:88px;outline:none;font-family:inherit;-moz-appearance:textfield}
.shl-cap-i:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.shl-cap-i::-webkit-outer-spin-button,.shl-cap-i::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.shl-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin-top:8px}
.shl-section{margin-top:18px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-l2)}
.shl-h4{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.shl-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;line-height:18px;align-items:baseline}
.shl-kv>span{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.shl-kv>b{color:var(--dsw-alias-label-primary);font-weight:500;word-break:break-all}
.shl-pre-tall{max-height:320px;font-size:11px;line-height:16px}
.shl-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 14px;align-items:start}
.shl-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.shl-field span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.shl-field input,.shl-field select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;min-height:28px;padding:3px 8px;outline:none;font-family:inherit;width:100%;min-width:0;box-sizing:border-box;text-overflow:ellipsis}
.shl-field input:focus-visible,.shl-field select:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.shl-field em{font-style:normal;color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px;word-break:break-word}
.shl-switch{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);min-height:28px}
.shl-link{color:var(--dsw-alias-brand-primary);cursor:pointer;font-size:12px;background:none;border:none;padding:0;text-decoration:none;margin-left:10px}
.shl-pick{user-select:all;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;background:rgba(127,127,127,.06);border-radius:6px;padding:6px 8px}
.shl-pick a{color:var(--dsw-alias-brand-primary);text-decoration:underline}
.shl-strong{color:var(--dsw-alias-label-secondary);font-weight:600}
.shl-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:middle;background:rgba(127,127,127,.45)}
.shl-dot.on{background:#2fbf71;box-shadow:0 0 0 3px rgba(47,191,113,.18)}
.shl-dot.off{background:#e0483e;box-shadow:0 0 0 3px rgba(224,72,62,.16)}
.shl-dot.warn{background:#ffb020;box-shadow:0 0 0 3px rgba(255,176,32,.16)}
.shl-weights{display:flex;flex-direction:column;gap:5px;margin-top:8px}
.shl-weight{display:grid;grid-template-columns:54px 1fr 36px;gap:8px;align-items:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.shl-weight .track{height:6px;border-radius:999px;background:rgba(127,127,127,.14);overflow:hidden}
.shl-weight .track i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);opacity:.7}
.shl-weight b{font-weight:500;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums}
.shl-how{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;background:rgba(127,127,127,.03);font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.shl-how ol{margin:6px 0 0;padding-left:18px}
.shl-how ul{margin:6px 0 0;padding-left:18px}
.shl-how li{margin:3px 0}
.shl-how em{font-style:normal;color:var(--dsw-alias-brand-primary)}
.shl-how h5{margin:14px 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);letter-spacing:.02em}
.shl-how p{margin:4px 0 0}
.shl-goal{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;font-size:11.5px;line-height:17px;display:flex;flex-direction:column;gap:3px}
.shl-goal .row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.shl-goal b{font-weight:600;color:var(--dsw-alias-label-primary);font-size:12px}
.shl-goal i{font-style:normal;color:var(--dsw-alias-label-tertiary)}
.shl-goals{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.shl-item.shl-sleeping{opacity:.72}
.shl-item.shl-sleeping .shl-meter i{filter:saturate(.15)}
.shl-item.shl-editing{align-items:stretch;padding:12px 14px}
.shl-item.shl-editing .shl-main{gap:8px}
.shl-edit-text{width:100%;box-sizing:border-box;resize:vertical;min-height:72px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:rgba(127,127,127,.06);color:inherit;font:inherit}
.shl-edit-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.shl-edit-row label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.shl-edit-row input,.shl-edit-row select{padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:rgba(127,127,127,.06);color:inherit;font:inherit;min-width:0}
.shl-edit-row input[type=number]{width:78px}
.shl-who{color:var(--dsw-alias-brand-primary);font-size:11px}
.shl-mood{color:var(--dsw-alias-label-secondary);font-size:11px;font-style:italic}
/* B 站页签：原生组件，全部用主题变量，换皮肤自动跟随。 */
.shl-bili-ws{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 10px;margin-top:8px}
.shl-bili-path{color:var(--dsw-alias-label-tertiary);font-size:11px;word-break:break-all;margin-left:6px}
.shl-bili-sess{margin-left:14px;font-size:12px}
.shl-bili-sess code{color:var(--dsw-alias-label-tertiary);font-size:10.5px;margin-left:6px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.shl-bili-scroll{max-height:min(46vh,460px);overflow-y:auto;padding-right:6px;overscroll-behavior:contain}
.shl-bili-scroll::-webkit-scrollbar{width:8px}
.shl-bili-scroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,.26);border-radius:99px}
.shl-bili-scroll::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.42)}
.shl-bili-scroll::-webkit-scrollbar-track{background:transparent}
.shl-bili-day{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;margin-bottom:8px;background:rgba(127,127,127,.02);overflow:hidden}
.shl-bili-day>summary{list-style:none;cursor:pointer;padding:8px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px}
.shl-bili-day>summary::-webkit-details-marker{display:none}
.shl-bili-day>summary::before{content:'▸';display:inline-block;transition:transform .15s;color:var(--dsw-alias-label-tertiary)}
.shl-bili-day[open]>summary::before{content:'▾'}
.shl-bili-day>summary:hover{background:rgba(127,127,127,.06)}
.shl-bili-day>.shl-bili-daybody{padding:0 8px 8px}
.shl-bili-item{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px;margin-bottom:8px;background:rgba(127,127,127,.02)}
.shl-bili-cover{width:108px;min-width:108px;max-width:108px;height:61px;object-fit:cover;border-radius:6px;flex:0 0 108px;background:rgba(127,127,127,.1)}
.shl-bili-frames{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.shl-bili-frames img{height:54px;border-radius:5px;display:block}
.shl-bili-logs{max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:9px}
.shl-bili-logs table{width:100%;border-collapse:collapse;font-size:11.5px}
.shl-bili-logs th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);text-align:left;padding:7px 8px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.shl-bili-logs td{padding:6px 8px;border-top:1px solid var(--dsw-alias-border-l1);vertical-align:top;word-break:break-word}
.shl-bili-ok{color:var(--dsw-alias-state-success-primary)}
.shl-bili-bad{color:var(--dsw-alias-state-error-primary)}
/* 情感页签：五边形雷达 + 维度条 */
.shl-mood-top{display:grid;grid-template-columns:auto minmax(0,440px);gap:18px;align-items:center;margin-bottom:6px}
.shl-mood-chart{display:flex;align-items:center;justify-content:center}
.shl-radar{width:176px;height:176px;display:block}
.shl-mood-bars{display:flex;flex-direction:column;gap:6px;min-width:0}
.shl-mood-bar{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center}
.shl-mood-barhead{grid-column:1 / -1;display:flex;gap:8px;align-items:baseline;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.shl-mood-barhead b{font-size:12.5px;color:var(--dsw-alias-label-primary);font-weight:600}
.shl-mood-barhead em{font-style:normal;margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.shl-mood-track{height:7px;border-radius:99px;background:rgba(127,127,127,.16);overflow:hidden}
.shl-mood-track i{display:block;height:100%;border-radius:99px;transition:width .25s ease}
.shl-mood-ops{display:flex;gap:4px}
.shl-mood-ops .shl-btn{padding:0 8px;min-height:22px;font-size:11px}
.shl-mood-scroll{max-height:min(30vh,300px);overflow-y:auto;padding-right:6px;overscroll-behavior:contain}
.shl-mood-scroll::-webkit-scrollbar{width:8px}
.shl-mood-scroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,.26);border-radius:99px}
.shl-mood-scroll::-webkit-scrollbar-track{background:transparent}
.shl-mood-row{display:flex;gap:10px;align-items:baseline;padding:5px 0;border-bottom:1px dashed var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.shl-mood-row:last-child{border-bottom:0}
.shl-mood-targets{margin:10px 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 12px;background:rgba(127,127,127,.02)}
.shl-mood-targets>summary{list-style:none;cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.shl-mood-targets>summary::-webkit-details-marker{display:none}
.shl-mood-targets>summary::before{content:'▸';margin-right:6px;color:var(--dsw-alias-label-tertiary)}
.shl-mood-targets[open]>summary::before{content:'▾'}
.shl-mood-targetlist{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.shl-mood-target{display:flex;flex-direction:column;gap:3px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.shl-mood-target:last-child{border-bottom:none}
.shl-mood-target.on{color:var(--dsw-alias-label-primary)}
.shl-mood-tname{font-size:11px;font-weight:600}
.shl-mood-targetrow{display:grid;grid-template-columns:28px minmax(0,1fr) 44px;gap:8px;align-items:center}
.shl-mood-tkey{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.shl-mood-tname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shl-mood-tbar{height:6px;border-radius:99px;background:rgba(127,127,127,.16);overflow:hidden}
.shl-mood-tbar i{display:block;height:100%;border-radius:99px}
.shl-mood-tval{text-align:right;font-variant-numeric:tabular-nums}
.shl-mood-changes{color:var(--dsw-alias-brand-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.shl-mood-note{color:var(--dsw-alias-label-tertiary);margin-left:auto;text-align:right;word-break:break-word}
`;

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === 'undefined') return;
        // 只判断「有没有」不够：同一个页面里旧 style 还在，改了 CSS 就永远不生效，
        // 只能靠硬刷新——这里顺手比对内容，不一致就换掉。
        let el = document.getElementById(CSS_TAG);
        if (!el) {
          el = document.createElement('style');
          el.id = CSS_TAG;
          document.head.appendChild(el);
        }
        if (el.textContent !== CSS) el.textContent = CSS;
      }, []);
    }

    async function api(path, init) {
      const res = await fetch(`${API}${path}`, {
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        ...init,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      return data;
    }

    function strengthColor(score) {
      if (score >= 80) return '#2fbf71';
      if (score >= 55) return '#2f6fed';
      if (score >= 30) return '#ffb020';
      if (score >= 12) return '#f08a3c';
      return '#8a8f98';
    }

    function clarityText(score) {
      if (score >= 80) return '清晰';
      if (score >= 55) return '还记得';
      if (score >= 30) return '有点模糊';
      if (score >= 12) return '快忘了';
      return '想不起来';
    }

    function fmtWhen(iso) {
      if (!iso) return '';
      const t = Date.parse(iso);
      if (!Number.isFinite(t)) return '';
      const d = new Date(t);
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    }

    function Stat({ value, label, tone }) {
      const text = String(value ?? '—');
      // 音色 ID、实例名这类长串按小一号排，不然会把卡片撑破
      const long = text.length > 10;
      return h(
        'div',
        { className: 'shl-stat', title: text },
        h('b', { className: long ? 'long' : undefined }, tone ? h('span', { className: `shl-dot ${tone}` }) : null, text),
        h('span', null, label),
      );
    }

    function toneOf(flag) {
      return flag ? 'on' : 'off';
    }

    const SPEAKER_OPTIONS = [
      ['', '不确定'],
      ['owner', '主人'],
      ['self', '我'],
      ['group', '群友'],
    ];
    const CHANNEL_OPTIONS = [
      ['', '不确定'],
      ['private', '私聊'],
      ['group', '群聊'],
      ['bili', 'B站'],
    ];

    function flowKeyText(key) {
      const value = String(key || '');
      const matched = value.match(/^(private|group):(\d+)$/);
      if (matched) return matched[1] === 'group' ? `群 ${matched[2]}` : `私聊 ${matched[2]}`;
      return value;
    }

    function speakerKind(value) {      const s = String(value || '');
      if (s === 'owner' || s === 'self') return s;
      if (s.startsWith('group:')) return 'group';
      return '';
    }

    function Item({ item, onReview, onForget, onSave, busy }) {
      const score = Math.max(2, Math.min(100, Number(item.strength) || 0));
      const sleeping = item.state === 'dormant';
      // 流水是桥接自动攒的原话，没有「谁说的 / 转述 / 情感」这些要人填的东西，
      // 编辑时只留正文。
      const isFlow = item.source === 'flow';
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);

      const setField = (key, value) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

      const openEdit = () => {
        const kind = speakerKind(item.speaker);
        setDraft({
          text: item.text || '',
          type: item.type || 'daily',
          importance: item.importance ?? 60,
          emotional: item.emotional ?? 0,
          speaker: kind,
          groupName: kind === 'group' ? String(item.speaker).slice(6) : '',
          channel: item.channel || '',
          moodSelf: item.moodSelf || '',
          moodOther: item.moodOther || '',
          voice: item.voice === 'quote' ? 'quote' : 'narration',
        });
        setEditing(true);
      };

      const save = async () => {
        if (!draft || saving) return;
        const text = String(draft.text || '').trim();
        if (!text) return;
        setSaving(true);
        try {
          await onSave(item.id, {
            text,
            type: draft.type,
            importance: Number(draft.importance) || 0,
            emotional: Number(draft.emotional) || 0,
            speaker:
              draft.speaker === 'group'
                ? `group:${String(draft.groupName || '').trim() || '别人'}`
                : draft.speaker,
            channel: draft.channel,
            moodSelf: String(draft.moodSelf || '').trim(),
            moodOther: String(draft.moodOther || '').trim(),
            voice: draft.voice === 'quote' ? 'quote' : 'narration',
          });
          setEditing(false);
        } finally {
          setSaving(false);
        }
      };

      if (editing) {
        return h(
          'div',
          { className: 'shl-item shl-editing' },
          h(
            'div',
            { className: 'shl-main' },
            h('textarea', {
              className: 'shl-edit-text',
              rows: 4,
              value: draft.text,
              onChange: (e) => setField('text', e.target.value),
            }),
            isFlow
              ? h('div', { className: 'shl-note' }, '流水是桥接自动攒的原话，这里只改文字。')
              : h(
              'div',
              { className: 'shl-edit-row' },
              h(
                'label',
                null,
                '类型',
                h(
                  'select',
                  { value: draft.type, onChange: (e) => setField('type', e.target.value) },
                  Object.keys(TYPE_LABEL).map((key) => h('option', { key, value: key }, TYPE_LABEL[key])),
                ),
              ),
              h(
                'label',
                null,
                '重要度',
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 100,
                  value: draft.importance,
                  onChange: (e) => setField('importance', e.target.value),
                }),
              ),
              h(
                'label',
                null,
                '情绪',
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 10,
                  value: draft.emotional,
                  onChange: (e) => setField('emotional', e.target.value),
                }),
              ),
            ),
            isFlow ? null : h(
              'div',
              { className: 'shl-edit-row' },
              h(
                'label',
                null,
                '谁说的',
                h(
                  'select',
                  { value: draft.speaker, onChange: (e) => setField('speaker', e.target.value) },
                  SPEAKER_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
              ),
              draft.speaker === 'group'
                ? h(
                    'label',
                    null,
                    '群友名',
                    h('input', {
                      value: draft.groupName,
                      placeholder: '群名片或昵称',
                      onChange: (e) => setField('groupName', e.target.value),
                    }),
                  )
                : null,
              h(
                'label',
                null,
                '在哪说的',
                h(
                  'select',
                  { value: draft.channel, onChange: (e) => setField('channel', e.target.value) },
                  CHANNEL_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
              ),
            ),
            isFlow ? null : h(
              'div',
              { className: 'shl-edit-row' },
              h(
                'label',
                null,
                '我那时候的心情',
                h('input', {
                  value: draft.moodSelf,
                  placeholder: '几个字就行，没有就留空',
                  onChange: (e) => setField('moodSelf', e.target.value),
                }),
              ),
              h(
                'label',
                null,
                '对方那时候的心情',
                h('input', {
                  value: draft.moodOther,
                  placeholder: '几个字就行，没有就留空',
                  onChange: (e) => setField('moodOther', e.target.value),
                }),
              ),
              h(
                'label',
                null,
                '这是原话还是转述',
                h(
                  'select',
                  { value: draft.voice, onChange: (e) => setField('voice', e.target.value) },
                  h('option', { value: 'narration' }, '转述（我概括的）'),
                  h('option', { value: 'quote' }, '原话（一字不差）'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'shl-ops' },
              h('button', { className: 'shl-btn', disabled: saving, onClick: save }, saving ? '保存中…' : '保存'),
              h('button', { className: 'shl-btn shl-btn2', onClick: () => setEditing(false) }, '取消'),
            ),
          ),
        );
      }

      return h(
        'div',
        { className: `shl-item${sleeping ? ' shl-sleeping' : ''}` },
        h('div', { className: 'shl-meter' }, h('i', { style: { height: `${score}%`, background: strengthColor(score) } })),
        h(
          'div',
          { className: 'shl-main' },
          h('div', { className: 'shl-text' }, item.text),
          h(
            'div',
            { className: 'shl-meta' },
            h('span', { className: 'shl-badge' }, TYPE_LABEL[item.type] ?? item.type),
            item.source === 'flow' ? h('span', { className: 'shl-badge dim', title: '桥接记下的原话，按天压成一条；不进提示词，只靠搜索翻' }, '流水') : null,
            item.source === 'flow' && item.flowKey ? h('span', { className: 'shl-badge dim' }, flowKeyText(item.flowKey)) : null,
            item.who ? h('span', { className: 'shl-who' }, item.who) : null,
            item.moodSelf ? h('span', { className: 'shl-mood' }, `我当时：${item.moodSelf}`) : null,
            item.moodOther ? h('span', { className: 'shl-mood' }, `TA：${item.moodOther}`) : null,
            item.mergedCount ? h('span', { className: 'shl-badge dim' }, `并了 ${item.mergedCount} 条`) : null,
            item.evidence === 'inferred'
              ? h('span', { className: 'shl-badge dim', title: '她自己推测出来的，不是谁明确说的；注入时会标「推断」' }, '推断')
              : item.evidence === 'observed'
                ? h('span', { className: 'shl-badge dim', title: '她直接看到/听到的事实' }, '亲眼见')
                : item.evidence === 'external'
                  ? h('span', { className: 'shl-badge dim', title: '从 B 站、网页之类外部来源看到的' }, '外部')
                  : null,
            item.supersededBy
              ? h('span', { className: 'shl-badge dim', title: `已被 ${item.supersededBy} 取代：不再进提示词，原文留档可搜` }, '已被取代')
              : null,
            h(
              'span',
              { className: `shl-badge ${sleeping ? 'dim' : score >= 55 ? 'ok' : score >= 30 ? 'warn' : 'dim'}` },
              sleeping ? `沉睡了 · ${item.strength} 分` : `${item.strength} 分 · ${clarityText(score)}`,
            ),
            item.pinned ? h('span', { className: 'shl-badge ok' }, '不会忘') : null,
            h('span', null, item.lastReviewAt ? `最近想起 ${fmtWhen(item.lastReviewAt)}` : `记于 ${fmtWhen(item.createdAt)}`),
            h('span', null, `约能撑 ${item.span}`),
          ),
        ),
        h(
          'div',
          { className: 'shl-ops' },
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => onReview(item) }, sleeping ? '叫醒它' : '回想一下'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => onForget(item) }, '忘掉'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: openEdit }, '改'),
        ),
      );
    }

    function MemoryBody() {
      useStyleOnce();
      const [stats, setStats] = useState(null);
      const [list, setList] = useState({ total: 0, items: [] });
      const [query, setQuery] = useState('');
      const [type, setType] = useState('');
      const [state, setState] = useState('');
      const [mergedOnly, setMergedOnly] = useState(false);
      const [showFlow, setShowFlow] = useState(false);
      const [maxCharsDraft, setMaxCharsDraft] = useState('1600');
      const [prompt, setPrompt] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');

      const refresh = useCallback(async () => {
        try {
          const [s, l] = await Promise.all([
            api('/state'),
            api(`/memories?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&state=${encodeURIComponent(state)}&merged=${mergedOnly ? '1' : ''}&hideFlow=${showFlow ? '0' : '1'}&limit=80`),
          ]);
          setStats(s.stats);
          setList(l);
          const cur = Number(s?.stats?.settings?.maxChars);
          if (Number.isFinite(cur) && cur > 0) setMaxCharsDraft(String(cur));
          setError('');
        } catch (e) {
          setError(e.message);
        }
      }, [query, type, state, mergedOnly, showFlow]);

      useEffect(() => {
        refresh();
      }, [refresh]);

      const loadPrompt = useCallback(async () => {
        try {
          const data = await api('/prompt');
          setPrompt(data.text || '（当前没有可注入的内容）');
        } catch (e) {
          setPrompt(`读取失败：${e.message}`);
        }
      }, []);

      const act = useCallback(
        async (fn, message) => {
          setBusy(true);
          setOk('');
          setError('');
          try {
            const result = await fn();
            await refresh();
            await loadPrompt();
            setOk(typeof result === 'string' && result ? result : message);
            setTimeout(() => setOk(''), 2600);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        },
        [refresh, loadPrompt],
      );

      const onReview = useCallback(
        (item) => act(() => api('/review', { method: 'POST', body: JSON.stringify({ id: item.id, grade: 'recall' }) }), '回想了一次，记得更牢了。'),
        [act],
      );

      const onForget = useCallback(
        (item) => act(() => api('/forget', { method: 'POST', body: JSON.stringify({ id: item.id }) }), '已从记忆库里抹掉。'),
        [act],
      );

      const onSave = useCallback(
        async (id, patch) => {
          try {
            const data = await api('/update', {
              method: 'POST',
              body: JSON.stringify({ id, patch }),
            });
            if (data.ok === false) throw new Error(data.error || '保存失败');
            await refresh();
            await loadPrompt();
            setOk('改好了，分数和时间线没动。');
            setTimeout(() => setOk(''), 2600);
          } catch (e) {
            setError(String(e?.message ?? e));
          }
        },
        [refresh, loadPrompt],
      );

      // 「合并」不是一种记忆类型，是整理后的产物：从类型条里拿出来单独放一行，
      // 免得看起来像「日常 / 琐碎 / 合并」三选一。合并后仍是原类型，所以类型条照常能筛到它。
      // 「流水」同理：一天一条、内容很长，默认不显示，单独放一个开关在类型条最后。
      const typeChips = useMemo(() => {
        const byType = stats?.byType ?? {};
        const keys = Object.keys(byType).filter((k) => byType[k] > 0 && k !== 'digest' && k !== 'flow');
        return keys.map((key) =>
          h(
            'button',
            {
              key,
              className: `shl-chip${type === key ? ' on' : ''}`,
              onClick: () => setType(type === key ? '' : key),
            },
            TYPE_LABEL[key] ?? key,
            h('em', null, byType[key]),
          ),
        );
      }, [stats, type]);

      const flowCount = stats?.byType?.flow ?? 0;
      const flowChip = h(
        'button',
        {
          className: `shl-chip shl-chip-sub${showFlow ? ' on' : ''}`,
          title: '桥接把说出口的话按天压成一条的流水。内容很长、默认不显示、也从不进提示词，勾上才列出来。',
          onClick: () => setShowFlow(!showFlow),
        },
        '流水',
        flowCount ? h('em', null, flowCount) : null,
      );

      const mergedCount = stats?.mergedGroups ?? 0;
      const mergedChip = mergedCount
        ? h(
            'button',
            {
              className: `shl-chip shl-chip-sub${mergedOnly ? ' on' : ''}`,
              title: '由零散对话并出来的条目。合并后仍是原类型（日常 / 琐碎），所以类型条里也能筛到它；这里只按「是不是整理出来的」筛。',
              onClick: () => setMergedOnly(!mergedOnly),
            },
            '只看合并后的',
            h('em', null, mergedCount),
          )
        : null;

      const stateChip = (key, label) =>
        h(
          'button',
          {
            key,
            className: `shl-chip${state === key ? ' on' : ''}`,
            onClick: () => setState(state === key ? '' : key),
          },
          label,
        );

      return h(
        'div',
        { className: 'shl-body' },
          h(
            'details',
            { className: 'shl-how' },
            h('summary', null, '这套记忆是怎么运作的'),
            h('p', null, '一条记忆不是「记得 / 不记得」两档，而是 0–100 的一个分数，随时间和被想起的次数连续变化。'),
            h('h5', null, '怎么记'),
            h(
              'ol',
              null,
              h('li', null, '按类型定一个初始「能撑多久」：身份与关系最久，日常一个月还剩七成，琐碎小事一周就到三成半。'),
              h('li', null, '分数随时间按幂律往下掉。掉得慢、尾巴长，不是断崖式归零。'),
              h('li', null, '被想起一次分数会回升，回升多少取决于「当时还剩多少」——快忘的时候被想起加得最多，刚说完又提几乎不加。'),
            ),
            h('h5', null, '带上情绪'),
            h(
              'p',
              null,
              '记的时候可以顺带写「我那时候的心情」和「对方那时候的心情」，两个分开。情绪是回忆的钩子：回想一件事，先浮上来的往往是当时的感受。没有就留空，不硬凑。',
            ),
            h('h5', null, '两个来源'),
            h(
              'ul',
              null,
              h('li', null, h('b', null, '她记的'), '：她自己判断后写下来的，是提炼过的意思，带类型和情绪。'),
              h(
                'li',
                null,
                h('b', null, '流水'),
                '：桥接把每条真的说出口的话记个尾巴，按天压成一条。保存的是原话，稳定性固定 1.5 天，',
                h('b', null, '从不进提示词'),
                '，只在搜索时被翻出来——对应「忘得很快，但被提到时还留一点印象」。列表里带「流水」标记。',
              ),
            ),
            h('h5', null, '变淡之后'),
            h(
              'ul',
              null,
              h('li', null, h('b', null, '沉睡'), '：低于 6 分。还在库里、还能搜到，点「叫醒它」就拉回来，不会真删。'),
              h(
                'li',
                null,
                h('b', null, '合并'),
                '：下面几条同时满足才会被并——',
                h('b', null, '至少 3 天'),
                '没再被提起、当前分数已在 ',
                h('b', null, '45 分以下'),
                '、当初的重要度 ',
                h('b', null, '≤65'),
                '、类型是「日常」或「琐碎」、没有被钉住，而且同一天、同一处（群聊 / 私聊 / B站分开算）至少 ',
                h('b', null, '2 条'),
                '。只并同类型、同一天的记录；合并后还是原来的类型（日常并出来仍是日常），只是多一个「合并过」标记，所以它既能在类型里筛到，也能被「只看合并后的」筛出来。一次最多并 15 条，多出来的留到下次。原话都保留，只是合成一条，不再单独占位置。手动点「合并旧话」可以立刻跑一次。每条记录标着「原话 / 转述」，合并时只有标成原话的才写成「主人：……」这样的引语，其余只写正文——不靠猜。',
              ),
            ),
            h('h5', null, '进到提示词里的'),
            h(
              'p',
              null,
              '每次开口前按「强度 × 新鲜度 × 类型权重」挑几条塞进去，最多 1600 字，塞不下的不硬塞。流水永远不进——它只在被提到时才该出现。被塞进提示词也不算复习。',
            ),
            h('p', null, '没进提示词的都还在库里，靠上面的搜索翻。搜到一条会算一次「想起」，那条会记得更久一点。'),
          ),
          h(
            'div',
            { className: 'shl-stats' },
            h(Stat, { value: stats?.total ?? '—', label: '一共记住' }),
            h(Stat, { value: stats?.active ?? '—', label: '还清楚' }),
            h(Stat, { value: stats?.fading ?? '—', label: '正在变模糊' }),
            h(Stat, { value: stats?.dormant ?? '—', label: '已沉睡' }),
            h(Stat, { value: stats ? `${stats.avgStrength}` : '—', label: '平均强度' }),
          ),
          h('div', { className: 'shl-chips' }, typeChips, flowChip),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('input', {
              className: 'shl-input',
              placeholder: '输入关键词搜索记忆...',
              value: query,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') refresh();
              },
            }),
            stateChip('dormant', '只看已沉睡'),
            stateChip('superseded', '只看已取代'),
            mergedChip,
            h('button', { className: 'shl-btn', disabled: busy, onClick: refresh }, busy ? '…' : '搜'),
            h(
              'button',
              {
                className: 'shl-btn shl-btn2',
                disabled: busy,
                title: '把满足条件的零散对话按天并成一段：至少 3 天没提起、分数已低于 45、重要度 ≤65、类型是日常或琐碎、同一天同一渠道同类型、至少 2 条。合并后仍是原类型。流水记录不参与。',
                onClick: () =>
                  act(async () => {
                    const data = await api('/consolidate', { method: 'POST', body: JSON.stringify({}) });
                    if (data.ok === false) throw new Error(data.error || '整理失败');
                    if (!data.groups) return '这会儿没有需要合并的零散对话。';
                    return `并了 ${data.groups} 组，共 ${data.covered} 条零散对话，原来的那些已经并进去、不在列表里了。`;
                  }, ''),
              },
              '合并旧话',
            ),
            h(
              'span',
              { className: 'shl-cap' },
              h('span', { className: 'shl-cap-l' }, '设置提示词的字数上限'),
              h('input', {
                className: 'shl-cap-i',
                type: 'number',
                min: 400,
                max: 8000,
                step: 100,
                value: maxCharsDraft,
                onChange: (e) => setMaxCharsDraft(e.target.value),
              }),
              h('span', { className: 'shl-cap-l' }, '字'),
              h(
                'button',
                {
                  className: 'shl-btn shl-btn2',
                  disabled: busy,
                  onClick: () =>
                    act(async () => {
                      const n = Number(maxCharsDraft);
                      if (!Number.isFinite(n) || n < 400 || n > 8000) throw new Error('范围是 400–8000 字');
                      await api('/settings', { method: 'POST', body: JSON.stringify({ maxChars: n }) });
                      await refresh();
                      return `上限改成 ${n} 字了。`;
                    }, ''),
                },
                '保存',
              ),
              h(
                'button',
                {
                  className: 'shl-btn shl-btn2',
                  disabled: busy,
                  title: '恢复成默认的 1600 字',
                  onClick: () => act(async () => {
                    await api('/settings', { method: 'POST', body: JSON.stringify({ maxChars: 1600 }) });
                    setMaxCharsDraft('1600');
                    await refresh();
                    return '已恢复到默认的 1600 字。';
                  }, ''),
                },
                '重置',
              ),
            ),
          ),
          error ? h('div', { className: 'shl-err' }, error) : null,
          ok ? h('div', { className: 'shl-ok' }, ok) : null,
          h(
            'div',
            { className: 'shl-list' },
            (list.items ?? []).length === 0
              ? h('div', { className: 'shl-empty' }, '这个条件下没有记忆。')
              : list.items.map((item) =>
                  h(Item, { key: item.id, item, onReview, onForget, onSave, busy }),
                ),
          ),
          h(
            'details',
            { className: 'shl-prompt', onToggle: (e) => { if (e.target.open && !prompt) loadPrompt(); } },
            h('summary', null, '看看现在往提示词里塞了什么'),
            h('div', { className: 'shl-pre' }, prompt || '（展开后加载）'),
            h('div', { className: 'shl-note' }, `库里 ${list.total} 条符合条件，注入块最多 ${stats?.settings?.maxChars ?? 1600} 字；超出部分不会硬塞，按强度和新鲜度取舍。`),
          ),
      );
    }

    const TABS = [
      { key: 'memory', label: '记忆', title: '记忆' },
      { key: 'mood', label: '情感/状态', title: '情感/状态' },
      { key: 'voice', label: '语音', title: '语音' },
      { key: 'bridge', label: '桥接/角色', title: '桥接/角色' },
      { key: 'qzone', label: 'QQ 空间', title: 'QQ 空间' },
      { key: 'bili', label: 'B站', title: 'B站' },
      { key: 'purpose', label: '目的引擎', title: '目的引擎' },
      { key: 'fish', label: '防刷屏', title: '防刷屏' },
    ];

    const TABS_SUB = {
      memory: '不是「记得 / 不记得」，而是每件事此刻还剩多少分。翻一次会更牢，搁着会变淡，但不会凭空消失。',
      mood: '不是「她是什么人」，而是「此刻什么状态」。五个维度各有日常值，被一句话推动，没人管就自己回落——记住的是此刻，不是发生过什么。',
      voice: '两件事分开看：听得见（把语音和视频里的话变成文字）、说得像（把文字变成她的声音）。合成在桥接进程里执行，这里只改参数和看状态。',
      bridge: '桥接是独立进程，人格卡由它读。这里只管看得见、点得动：状态、会话、SnowLuma、日志、启停。',
      qzone: '她自己决定要不要发：说说是她自己的话，不是转述聊天。发之前会先看一眼今天发过没有，一天最多两条。',
      bili: '游客态只读：热门、搜索、视频详情、弹幕、每周必看、抽帧、刷过的视频、分享到 QQ。不登录、不点赞、不评论。',
      purpose: '不是关键词触发器：从最近的 QQ 聊天、记忆库里值得提的旧事、人格卡里她是谁，攒出「目标假设」，带归属、置信度和风险，再决定是分享、索取、邀请还是倾诉。',
      fish: '同一批同类 bot 被拉进同一个群时，别一起刷屏。这里调判定阈值、冷却和豁免名单。',
    };

    // 五个维度统一保留一位小数：衰减和牵制都会产生零头，混着整数和小数看着不齐。
    function fmtMood(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return n.toFixed(1);
    }

    /** 显示条按 0~100 的绝对值取比例：初始 10 就是 10%，负值按 0 显示。 */
    function moodFillPercent(dim) {
      return Math.max(0, Math.min(100, Number(dim?.value) || 0));
    }

    function MoodRadar({ dims, size = 176 }) {
      const cx = size / 2;
      const cy = size / 2;
      const radius = size / 2 - 20;
      const n = Math.max(3, dims.length);
      const angleOf = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
      const at = (i, value) => {
        const a = angleOf(i);
        const r = (radius * Math.max(0, Math.min(100, value))) / 100;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      };
      const rings = [20, 40, 60, 80, 100].map((pct) =>
        h('polygon', {
          key: `ring-${pct}`,
          points: dims.map((_, i) => at(i, pct).map((v) => v.toFixed(1)).join(',')).join(' '),
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l2)',
          strokeWidth: pct === 100 ? 1.2 : 0.8,
          opacity: 0.7,
        }),
      );
      const axes = dims.map((_, i) => {
        const [x, y] = at(i, 100);
        return h('line', {
          key: `axis-${i}`,
          x1: cx,
          y1: cy,
          x2: x,
          y2: y,
          stroke: 'var(--dsw-alias-border-l1)',
          strokeWidth: 0.8,
        });
      });
      const shape = dims
        .map((d, i) => at(i, moodFillPercent(d)).map((v) => v.toFixed(1)).join(','))
        .join(' ');
      const dots = dims.map((d, i) => {
        const [x, y] = at(i, moodFillPercent(d));
        return h('circle', { key: `dot-${d.key}`, cx: x, cy: y, r: 3.2, fill: d.color });
      });
      const labels = dims.map((d, i) => {
        const [x, y] = at(i, 110);
        return h(
          'text',
          {
            key: `lab-${d.key}`,
            x,
            y,
            textAnchor: 'middle',
            dominantBaseline: 'middle',
            fontSize: 11,
            fill: 'var(--dsw-alias-label-secondary)',
          },
          `${d.label} ${fmtMood(d.value)}`,
        );
      });
      return h(
        'svg',
        { className: 'shl-radar', viewBox: `-20 -20 ${size + 40} ${size + 40}`, role: 'img' },
        ...rings,
        ...axes,
        h('polygon', {
          key: 'shape',
          points: shape,
          fill: 'rgba(47,111,237,.16)',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: 1.6,
        }),
        ...dots,
        ...labels,
      );
    }

    function MoodBody() {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [target, setTarget] = useState('');

      const load = useCallback(async () => {
        try {
          const query = target ? `?target=${encodeURIComponent(target)}` : '';
          const res = await fetch(`${API}/mood${query}`, { headers: { accept: 'application/json' } });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || '读取失败');
          setData(json);
          setError('');
        } catch (e) {
          setError(`读不到情感状态：${String(e?.message ?? e)}`);
        }
      }, [target]);

      useEffect(() => {
        load();
      }, [load]);

      const nudge = async (key, delta) => {
        if (busy) return;
        setBusy(true);
        try {
          const res = await fetch(`${API}/mood/shift`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changes: { [key]: delta }, target, note: '面板手动调整' }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || '改不动');
          setData(json);
          setError('');
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      if (!data) {
        return h(
          'div',
          { className: 'shl-body' },
          error
            ? h('div', { className: 'shl-err' }, error)
            : h('div', { className: 'shl-empty' }, '正在读取情感状态…'),
        );
      }

      const dims = Array.isArray(data.dimensions) ? data.dimensions : [];
      const history = Array.isArray(data.history) ? data.history : [];
      const targets = Array.isArray(data.targets) ? data.targets : [];
      const closenessColor = dims.find((d) => d.key === 'closeness')?.color ?? 'var(--dsw-alias-brand-primary)';
      const angerColor = dims.find((d) => d.key === 'anger')?.color ?? '#e0483e';
      // 历史里可能留着改名前的老键（sadness），显示成中文，别把英文键甩到脸上。
      const dimLabel = (key) => dims.find((d) => d.key === key)?.label ?? (key === 'sadness' ? '委屈' : key);

      return h(
        'div',
        { className: 'shl-body' },
        error ? h('div', { className: 'shl-err' }, error) : null,
        h(
          'div',
          { className: 'shl-mood-top' },
          h('div', { className: 'shl-mood-chart' }, h(MoodRadar, { dims })),
          h(
            'div',
            { className: 'shl-mood-bars' },
            dims.map((d) =>
              h(
                'div',
                { key: d.key, className: 'shl-mood-bar' },
                h('div', { className: 'shl-mood-barhead' },
                  h('b', null, d.label),
                  h('span', null, `${fmtMood(d.value)} / 100（初始 ${d.base}）`),
                  h('em', null, `半衰期 ${d.halfLifeHours >= 24 ? `${Math.round(d.halfLifeHours / 24)} 天` : `${d.halfLifeHours} 小时`}`),
                ),
                h('div', { className: 'shl-mood-track' },
                  h('i', { style: { width: `${moodFillPercent(d)}%`, background: d.color } }),
                ),
                h('div', { className: 'shl-mood-ops' },
                  h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => nudge(d.key, -2) }, '−2'),
                  h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => nudge(d.key, 2) }, '+2'),
                ),
              ),
            ),
          ),
        ),
        data.multipliers
          ? h('p', { className: 'shl-note' }, `本回合倍率：${dims.map((d) => `${d.label} ×${Number(data.multipliers?.[d.key] ?? 1).toFixed(2)}`).join('  ')}`)
          : null,
        Array.isArray(targets) && targets.length
          ? h(
              'details',
              { className: 'shl-mood-targets' },
              h('summary', null, `分对象看亲密与怒气（${targets.length}）`),
              h(
                'div',
                { className: 'shl-mood-targetlist' },
                targets.map((t) =>
                  h(
                    'div',
                    { key: t.key, className: `shl-mood-target${t.current ? ' on' : ''}` },
                    h('div', { className: 'shl-mood-tname' }, t.label, t.current ? '（当前）' : ''),
                    h(
                      'div',
                      { className: 'shl-mood-targetrow' },
                      h('span', { className: 'shl-mood-tkey' }, '亲密'),
                      h(
                        'span',
                        { className: 'shl-mood-tbar' },
                        h('i', {
                          style: {
                            width: `${Math.max(0, Math.min(100, Number(t.value) || 0))}%`,
                            background: closenessColor,
                          },
                        }),
                      ),
                      h('span', { className: 'shl-mood-tval' }, fmtMood(t.value)),
                    ),
                    h(
                      'div',
                      { className: 'shl-mood-targetrow' },
                      h('span', { className: 'shl-mood-tkey' }, '怒气'),
                      h(
                        'span',
                        { className: 'shl-mood-tbar' },
                        h('i', {
                          style: {
                            width: `${Math.max(0, Math.min(100, Number(t.anger) || 0))}%`,
                            background: angerColor,
                          },
                        }),
                      ),
                      h('span', { className: 'shl-mood-tval' }, fmtMood(t.anger)),
                    ),
                  ),
                ),
              ),
              h('p', { className: 'shl-note' }, '私聊按人算（同一个人在群里也认得出），群聊按群算。亲密度和怒气各存一份：在群里被谁气到，不会算到主人头上（只有三成转成委屈）。没聊过的人不进这张表。'),
            )
          : null,
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '怎么运作的'),
          h(
            'div',
            { className: 'shl-how' },
            h('p', null, '五个维度的日常值都是 10：亲密、开心可以跌到负数（疏远/讨厌、伤心），疲倦、怒气、委屈只在 0–100 之间。偏离多少由她自己推（工具 mood_shift），不推就按半衰期回落。'),
            h(
              'ul',
              null,
              h('li', null, h('b', null, '疲倦'), ' 0–100，日常 10，6 小时半衰期——熬夜会累积，睡一觉回来。每聊一轮自动 +1.5，深夜（23:00–05:00）+3，不设每日上限：真的陪着说话是会累的，不是只有她自己喊累才算。'),
              h('li', null, h('b', null, '亲密'), ' -100~100，日常 10，5 天半衰期。按人分开存：私聊记在那个人身上（认 QQ 号），群聊记在群身上；不指定对象时算在主人身上，不会另开一个「默认」。正数是亲近，负数是疏远、讨厌。', h('br'), h('em', null, '对别人的涨落只算两成——不然群里聊几次，就跟主人一样亲了。')),
              h('li', null, h('b', null, '怒气'), ' 0–100，日常 10，2 小时——真人的气一会儿就散，不该记一整天。按人分开存：在群里被别人气到，不等于对主人也生气。'),
              h('li', null, h('b', null, '委屈'), ' 0–100，日常 10，5 小时——觉得被亏待、被敷衍、明明在意却被轻放，往内收那种；怒气是往外顶，不一样。被哄或者遇上好事会加快回落。'),
              h('li', null, h('b', null, '开心'), ' -100~100，日常 10，4 小时。正数是高兴、话多，负数是没劲、提不起劲。'),
            ),
            h('p', null, h('b', null, '推动之前，先乘它自己的倍率。'), ' 倍率由另外四个维度共同决定：先把每个维度归一化成 n（高于 10 的部分按 (值−10)/90，低于 10 的部分按 (值−10)/110），再代进下面五条式子，结果夹在 0.5~2.0 之间。'),
            h('p', null, h('b', null, '亲密'), ' × (1 − 0.45×n怒气 − 0.30×n委屈 + 0.25×n开心)', h('br'), '⇒ 怒气、委屈越高，越难推近；开心的时候更容易亲近。'),
            h('p', null, h('b', null, '开心'), ' × (1 − 0.35×n疲倦 − 0.30×n怒气 − 0.25×n委屈 + 0.20×n亲密)', h('br'), '⇒ 困的时候开心不起来；生着气笑不出来；跟主人越亲，被哄好得越快。'),
            h('p', null, h('b', null, '疲倦'), ' × (1 − 0.20×n开心 + 0.25×n怒气 + 0.20×n委屈)', h('br'), '⇒ 高兴时越聊越精神；憋着火、受着委屈时更容易累。'),
            h('p', null, h('b', null, '怒气'), ' × (1 + 0.45×n疲倦 + 0.35×n委屈 − 0.25×n开心 − 0.30×n亲密)', h('br'), '⇒ 越累越容易一点就着；委屈会转成火气；开心和亲近能消气。'),
            h('p', null, h('b', null, '委屈'), ' × (1 + 0.30×n疲倦 + 0.40×n怒气 − 0.20×n开心 − 0.20×n亲密)', h('br'), '⇒ 累的时候更容易觉得被亏待；生着气更容易委屈；高兴、亲近时不太会计较。'),
            h('p', null, h('b', null, '阈值联动：'), '某个维度已经偏到一定程度，这一回合会顺手带一下别的维度。'),
            h(
              'ul',
              null,
              h('li', null, '疲倦 ≥ 60 → 开心 −2、怒气 +1（累到没心情）'),
              h('li', null, '怒气 ≥ 60 → 亲密 −2、开心 −1'),
              h('li', null, '委屈 ≥ 60 → 亲密 −2、开心 −1'),
              h('li', null, '开心 ≥ 50 → 疲倦 −1、怒气 −1、委屈 −1'),
              h('li', null, '开心 ≤ −20 → 怒气 +1、委屈 +1、亲密 −1'),
              h('li', null, '亲密 ≥ 75 → 委屈 −1、怒气 −1、开心 +1'),
              h('li', null, '亲密 ≤ −30 → 怒气 +2'),
              h('li', null, '疲倦 ≤ 20 且开心 ≥ 40 → 亲密 +1'),
            ),
            h('p', null, '每回合每个条件最多一次，乘对应维度的倍率，一回合加起来不超过 ±6。频率上按「对话回合」结算：同一段对话里最多每 30 分钟一次；同一条件当天触发越多收益越小（第 k 次 × 0.85^k，最低 0.25，每天重置）。没有这道闸，一天几百个时间步会把 +1 累积成主驱动，所有负面情绪都会被自动磨平。'),
            h(
              'p',
              null,
              '还有一条不是牵制、是换算：对别人生的气不会留在主人头上——按 30% 转成对主人的委屈。气没消失，只是从「往外顶」变成「往里收」。',
            ),
            h(
              'p',
              null,
              '两条长期规则：',
              h('br'),
              '① 递减增益——半小时内连着往同一边推，第二次只算 80%、第三次 64%、第四次 51%，最低 30%。防的是一次争吵里连推五次，一把顶到 90 下不来。',
              h('br'),
              '② 委屈会磨关系——委屈在 30~60 之间时，每个联动窗口（30 分钟）扣一点亲密，越重扣得越多（单次约 0.6~1.6，乘倍率、吃每日递减），掉到 45 就停；委屈到 60 以上转由「委屈 ≥ 60 → 亲密 −2」那条联动接手，两段不叠加。',
            ),
            h('p', null, '注入时只写处境不写数字（「你现在有点困，跟他还挺近的」）；全都贴日常值时只留一行很短的提醒，几乎不占额度。'),
          ),
        ),
        history.length
          ? h(
              'div',
              { className: 'shl-section' },
              h('h4', { className: 'shl-h4' }, '最近几次推动'),
              h(
                'div',
                { className: 'shl-mood-scroll' },
                history
                  .slice()
                  .reverse()
                  .map((row, i) =>
                    h(
                      'div',
                      { key: `${row.at}-${i}`, className: 'shl-mood-row' },
                      h('span', null, fmtWhen(row.at)),
                      h('span', { className: 'shl-mood-changes' }, Object.entries(row.changes || {}).map(([k, v]) => `${dimLabel(k)} ${v > 0 ? '+' : ''}${v}`).join(' ')),
                      h('span', { className: 'shl-mood-note' }, row.note || ''),
                    ),
                  ),
              ),
            )
          : null,
      );
    }

    // B 站面板和其它页签一样是原生组件：颜色直接吃 DSH 的 CSS 变量，换主题自动跟随。
    // 数据仍然向 8788 那个本地服务取（它开了 CORS），不经过 iframe。
    // 「QQ 空间」页签：桥接内置的空间接口（state / publish / profile / avatar / settings）。
    // 面板只负责展示与调用；发布上限、敏感词拦截都在桥接侧把关。
    function qzoneSexCode(value) {
      const text = String(value ?? '').toLowerCase();
      if (text === 'male' || text === '1') return '1';
      if (text === 'female' || text === '2') return '2';
      return '0';
    }

    function qzoneWhen(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n <= 0) return '';
      const d = new Date(n * 1000);
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function QzoneBody() {
      const [data, setData] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');
      const [content, setContent] = useState('');
      const [visibility, setVisibility] = useState('friends');
      const [imageUrls, setImageUrls] = useState('');
      const [nickname, setNickname] = useState('');
      const [signature, setSignature] = useState('');
      const [sex, setSex] = useState('0');
      const [avatarUrl, setAvatarUrl] = useState('');
      const [settings, setSettings] = useState(null);

      const load = async (announce) => {
        try {
          const res = await api('/bridge/qzone');
          const d = res?.data ?? null;
          setData(d);
          if (d?.user) {
            setNickname((prev) => (prev === '' ? String(d.user.nickname ?? '') : prev));
            setSignature((prev) => (prev === '' ? String(d.user.signature ?? '') : prev));
            setSex((prev) => (prev === '0' ? qzoneSexCode(d.user.sex) : prev));
          }
          if (d?.settings) setSettings((prev) => prev ?? d.settings);
          setError('');
          if (announce) setOk(announce);
        } catch (e) {
          setError(String(e?.message ?? e));
        }
      };

      useEffect(() => {
        load();
      }, []);

      const post = async (body, label) => {
        setBusy(true);
        setError('');
        setOk('');
        try {
          const res = await api('/bridge/qzone', { method: 'POST', body: JSON.stringify(body) });
          if (res?.ok === false) throw new Error(res.error || `${label}失败`);
          await load();
          setOk(`${label}完成。`);
          return res?.data ?? null;
        } catch (e) {
          setError(String(e?.message ?? e));
          throw e;
        } finally {
          setBusy(false);
        }
      };

      const doPublish = async (dryRun) => {
        const text = content.trim();
        if (!text) {
          setError('先写点内容再发。');
          return;
        }
        const images = imageUrls
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const out = await post(
          { tool: 'publish', content: text, visibility, images, dryRun },
          dryRun ? '预览' : '发布',
        );
        if (!dryRun && out?.ok && out?.verified) setContent('');
      };

      const saveProfile = async () => {
        const body = { tool: 'profile', sex: Number(sex) };
        if (nickname.trim()) body.nickname = nickname.trim();
        if (signature.trim()) body.signature = signature.trim();
        await post(body, '保存资料');
      };

      const saveAvatar = async () => {
        const image = avatarUrl.trim();
        if (!image) {
          setError('先填一个 http(s) 图片链接。');
          return;
        }
        await post({ tool: 'avatar', image }, '换头像');
      };

      const patchSetting = (key, value) =>
        setSettings((prev) => ({ ...(prev || {}), [key]: value }));

      const saveSettings = async () => {
        if (!settings) return;
        const out = await post({ tool: 'settings', settings }, '保存设置');
        if (out?.settings) setSettings(out.settings);
      };

      if (!data) {
        return h(
          'div',
          { className: 'shl-body' },
          error
            ? h('div', { className: 'shl-error' }, error)
            : h('div', { className: 'shl-note' }, '正在读取 QQ 空间…'),
        );
      }

      const user = data.user || {};
      const moments = Array.isArray(data.moments) ? data.moments : [];
      const todayCount = Number(data.todayCount || 0);
      const dailyLimit = Number(settings?.dailyLimit ?? data.settings?.dailyLimit ?? 2);
      const gateway = data.gateway || {};
      const logs = Array.isArray(data.log) ? data.log : [];

      return h(
        'div',
        { className: 'shl-body' },
        h(
          'div',
          { className: 'shl-stats' },
          h(Stat, { value: String(user.nickname || '—'), label: `QQ ${user.id || '—'}`, tone: 'on' }),
          h(Stat, {
            value: `${todayCount} / ${dailyLimit || '∞'}`,
            label: '今天已发',
            tone: dailyLimit > 0 && todayCount >= dailyLimit ? 'warn' : 'on',
          }),
          h(Stat, { value: String(data.total ?? 0), label: '空间总数', tone: 'on' }),
          h(Stat, {
            value: settings?.dryRun ? '演练中' : '正常',
            label: '发布模式',
            tone: settings?.dryRun ? 'warn' : 'on',
          }),
        ),

        h(
          'div',
          { className: 'shl-toolbar' },
          h('button', { type: 'button', className: 'shl-btn', onClick: () => load(), disabled: busy }, '刷新'),
          ok ? h('span', { className: 'shl-ok' }, ok) : null,
          error ? h('span', { className: 'shl-error' }, error) : null,
        ),

        h(
          PanelGroup,
          {
            title: '发一条说说',
            note: '上限、间隔、敏感词都在桥接侧拦；同样的内容不会重复发。图片只收公开 http(s) 链接。',
          },
          h(
            'div',
            { className: 'shl-field' },
            h('div', { className: 'shl-label' }, '正文'),
            h('textarea', {
              className: 'shl-input shl-textarea',
              rows: 4,
              value: content,
              placeholder: '想说什么…（1~3 句就好）',
              maxLength: Number(settings?.maxChars ?? 600),
              onChange: (e) => setContent(e.target.value),
            }),
            h('div', { className: 'shl-hint' }, `${[...content].length} / ${settings?.maxChars ?? 600} 字`),
          ),
          h(
            Field,
            { label: '谁能看见' },
            h(
              'select',
              {
                className: 'shl-input',
                value: visibility,
                onChange: (e) => setVisibility(e.target.value),
              },
              h('option', { value: 'friends' }, '好友可见'),
              h('option', { value: 'public' }, '所有人可见'),
              h('option', { value: 'self' }, '仅自己可见'),
            ),
          ),
          h(
            Field,
            { label: '图片（可空）', hint: '一行一个 http(s) 链接，最多 9 张。' },
            h('textarea', {
              className: 'shl-input shl-textarea',
              rows: 3,
              value: imageUrls,
              placeholder: 'https://…',
              onChange: (e) => setImageUrls(e.target.value),
            }),
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { type: 'button', className: 'shl-btn', onClick: () => doPublish(true), disabled: busy }, '预览（不发）'),
            h('button', { type: 'button', className: 'shl-btn shl-btn-primary', onClick: () => doPublish(false), disabled: busy }, busy ? '处理中…' : '发布'),
          ),
        ),

        h(
          PanelGroup,
          {
            title: '资料',
            note: '昵称留空 = 不改；签名留空 = 不改。',
          },
          h(
            Field,
            { label: '昵称', hint: '最多 16 字。' },
            h('input', {
              className: 'shl-input',
              value: nickname,
              onChange: (e) => setNickname(e.target.value),
            }),
          ),
          h(
            Field,
            { label: '签名', hint: '最多 80 字。' },
            h('input', {
              className: 'shl-input',
              value: signature,
              onChange: (e) => setSignature(e.target.value),
            }),
          ),
          h(
            Field,
            { label: '性别' },
            h(
              'select',
              { className: 'shl-input', value: sex, onChange: (e) => setSex(e.target.value) },
              h('option', { value: '0' }, '不公开'),
              h('option', { value: '1' }, '男'),
              h('option', { value: '2' }, '女'),
            ),
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { type: 'button', className: 'shl-btn shl-btn-primary', onClick: saveProfile, disabled: busy }, '保存资料'),
          ),
        ),

        h(
          PanelGroup,
          { title: '头像', note: '只收公开 http(s) 图片链接。' },
          h(
            Field,
            { label: '图片地址' },
            h('input', {
              className: 'shl-input',
              value: avatarUrl,
              placeholder: 'https://…',
              onChange: (e) => setAvatarUrl(e.target.value),
            }),
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { type: 'button', className: 'shl-btn shl-btn-primary', onClick: saveAvatar, disabled: busy }, '换头像'),
          ),
        ),

        h(
          PanelGroup,
          {
            title: '设置',
            note: '这些设置存在桥接的 config.json（socialV2.qzone），保存后立刻生效。',
          },
          h(Toggle, {
            label: '启用 QQ 空间功能',
            checked: settings?.enabled !== false,
            onChange: (v) => patchSetting('enabled', v),
          }),
          h(Toggle, {
            label: '允许发说说',
            checked: settings?.allowPublish !== false,
            onChange: (v) => patchSetting('allowPublish', v),
          }),
          h(Toggle, {
            label: '允许改资料（昵称 / 签名 / 性别）',
            checked: settings?.allowProfile !== false,
            onChange: (v) => patchSetting('allowProfile', v),
          }),
          h(Toggle, {
            label: '允许换头像',
            checked: settings?.allowAvatar !== false,
            onChange: (v) => patchSetting('allowAvatar', v),
          }),
          h(Toggle, {
            label: '演练模式（只预览，不真发）',
            checked: settings?.dryRun === true,
            onChange: (v) => patchSetting('dryRun', v),
          }),
          h(
            Field,
            { label: '默认可见范围' },
            h(
              'select',
              {
                className: 'shl-input',
                value: settings?.defaultVisibility || 'friends',
                onChange: (e) => patchSetting('defaultVisibility', e.target.value),
              },
              h('option', { value: 'friends' }, '好友可见'),
              h('option', { value: 'public' }, '所有人可见'),
              h('option', { value: 'self' }, '仅自己可见'),
            ),
          ),
          h(
            Field,
            { label: '每条上限（字）', hint: '50~1000。' },
            h(NumInput, {
              value: Number(settings?.maxChars ?? 600),
              min: 50,
              max: 1000,
              onChange: (v) => patchSetting('maxChars', v),
            }),
          ),
          h(
            Field,
            { label: '每天最多几条', hint: '0 = 不限；按本地自然日（0 点重置）。' },
            h(NumInput, {
              value: Number(settings?.dailyLimit ?? 2),
              min: 0,
              max: 20,
              onChange: (v) => patchSetting('dailyLimit', v),
            }),
          ),
          h(
            Field,
            { label: '每分钟最多几条', hint: '防连发，0 = 不限。' },
            h(NumInput, {
              value: Number(settings?.minuteLimit ?? 2),
              min: 0,
              max: 10,
              onChange: (v) => patchSetting('minuteLimit', v),
            }),
          ),
          h(
            Field,
            { label: '两条之间至少隔几分钟', hint: '0 = 不限间隔（重复内容仍会被挡）。' },
            h(NumInput, {
              value: Number(settings?.cooldownMinutes ?? 0),
              min: 0,
              max: 1440,
              onChange: (v) => patchSetting('cooldownMinutes', v),
            }),
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { type: 'button', className: 'shl-btn shl-btn-primary', onClick: saveSettings, disabled: busy || !settings }, '保存设置'),
          ),
        ),

        h(
          PanelGroup,
          { title: `最近说说（共 ${data.total ?? moments.length} 条）` },
          moments.length
            ? moments.slice(0, 8).map((m, i) =>
                h(
                  'div',
                  { key: m.tid || i, className: 'shl-qzone-post' },
                  h('div', null, String(m.content || '').slice(0, 200)),
                  h(
                    'div',
                    { className: 'shl-hint' },
                    `${qzoneWhen(m.time)}${m.tid ? ` · ${m.tid}` : ''}${m.images ? ` · ${m.images} 张图` : ''}`,
                  ),
                ),
              )
            : h('div', { className: 'shl-empty' }, '还没有说说。'),
        ),

        logs.length
          ? h(
              PanelGroup,
              { title: '最近操作' },
              logs.map((entry, i) =>
                h(
                  'div',
                  { key: i, className: 'shl-hint' },
                  `${new Date(Number(entry.at) || Date.now()).toLocaleString()} · ${entry.tool || '?'} · ${entry.ok ? '成功' : '失败'}${entry.message ? ` · ${entry.message}` : ''}${entry.tid ? ` · ${entry.tid}` : ''}`,
                ),
              ),
            )
          : null,

        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '协议端'),
          h('div', { className: 'shl-note' }, `WebSocket：${gateway.wsUrl || '—'}`),
          h('div', { className: 'shl-note' }, `HTTP：${gateway.httpUrl || '未开启（发语音、拉收藏表情会失败）'}`),
        ),
      );
    }

    const BILI_TIERS = [
      ['frameMicro', '极短', 't ≤ 30 秒'],
      ['frameShort', '短', '30 秒 < t ≤ 3 分'],
      ['frameMedium', '中', '3 分 < t ≤ 6 分'],
      ['frameLong', '长', '6 分 < t ≤ 12 分'],
      ['frameXlong', '超长', 't > 12 分'],
    ];

    function BiliBody() {
      const base = `http://${localHost()}:8788`;
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [busy, setBusy] = useState(false);
      const [frames, setFrames] = useState({});
      // 视频转写（whisper）的配置在 voice.json 的 asr 段，不在 B 站面板的 config 里。
      const [asr, setAsr] = useState(null);
      const [asrSt, setAsrSt] = useState(null);
      const [asrBusy, setAsrBusy] = useState(false);
      const [envBusy, setEnvBusy] = useState(false);
      const [envMsg, setEnvMsg] = useState('');

      const loadAsr = useCallback(async () => {
        try {
          const res = await fetch(`${API}/voice`, { headers: { accept: 'application/json' } });
          const d = await res.json();
          if (d?.ok) {
            setAsr(d.config?.asr ?? {});
            setAsrSt(d.status?.asr ?? null);
          }
        } catch {
          // 转写配置读不到不影响 B 站其它面板
        }
      }, []);

      useEffect(() => {
        loadAsr();
      }, [loadAsr]);

      const patchAsr = (key, value) =>
        setAsr((prev) => ({ ...(prev || {}), [key]: value }));

      const saveAsr = async () => {
        if (asrBusy || !asr) return;
        setAsrBusy(true);
        setError('');
        try {
          const res = await fetch(`${API}/voice`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ patch: { asr } }),
          });
          const d = await res.json();
          if (!d?.ok) throw new Error(d?.error || '保存转写设置失败');
          setAsrSt(d.status?.asr ?? null);
          setNotice('转写设置已保存');
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setAsrBusy(false);
        }
      };

      // 一键装 faster-whisper + small 模型（复用语音那边装好的 Python）。
      const installAsrEnv = async (force = false) => {
        if (envBusy) return;
        setEnvBusy(true);
        setError('');
        setEnvMsg('正在下载并安装…第一次约 500 MB，要等几分钟');
        try {
          const res = await fetch(`${API}/voice/whisper-env`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ force }),
          });
          const d = await res.json();
          setEnvMsg(d?.ok ? '装好了，可以用了' : (d?.error || '安装未完成，看下面的状态'));
          if (d?.status?.asr) setAsrSt(d.status.asr);
          if (d?.ok) setNotice('转写环境已就绪');
        } catch (e) {
          setEnvMsg(String(e?.message ?? e));
        } finally {
          setEnvBusy(false);
        }
      };

      const call = useCallback(async (path, body) => {
        const res = await fetch(
          `${base}${path}`,
          body
            ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            : {},
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        return json;
      }, [base]);

      const load = useCallback(async () => {
        try {
          setError('');
          setData(await call('/api/state'));
        } catch (e) {
          setError(`连不上 B 站面板服务（${base}）：${String(e?.message ?? e)}`);
        }
      }, [call, base]);

      useEffect(() => {
        load();
      }, [load]);

      const save = async (patch) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const res = await call('/api/config', patch);
          setData((prev) => (prev ? { ...prev, config: res.config } : prev));
          setNotice('已保存');
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      if (!data) {
        return h(
          'div',
          { className: 'shl-body' },
          error
            ? h('div', { className: 'shl-err' }, error)
            : h('div', { className: 'shl-empty' }, '正在读取 B 站面板状态…'),
        );
      }

      const cfg = data.config || {};
      const history = Array.isArray(data.history) ? data.history : [];
      const logs = Array.isArray(data.logs) ? data.logs : [];
      const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
      const qqSessions = workspaces.flatMap((ws) => ws.sessions || []);
      const enabledWs = new Set(cfg.enabledWorkspaces || []);
      const enabledSess = new Set(cfg.enabledSessions || []);

      const toggleSession = (item, on) => {
        const next = new Set(enabledSess);
        // 配置里两种写法都认（session-xxx 与 private:xxx/group:xxx），
        // 勾选/取消时两种一起加或一起删，免得同一个会话显示两遍状态。
        const keys = [item.id, item.key].filter(Boolean);
        for (const k of keys) {
          if (on) next.add(k);
          else next.delete(k);
        }
        save({ enabledWorkspaces: [...enabledWs], enabledSessions: [...next] });
      };

      const shareItem = async (item) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          const r = await call('/api/share', {
            bvid: item.bvid,
            target: cfg.shareTarget === 'group' ? 'group' : 'private',
            groupId: cfg.shareGroupId || '',
          });
          setNotice(`已分享：${r.title || item.bvid}`);
        } catch (e) {
          setError(`分享失败：${String(e?.message ?? e)}`);
        } finally {
          setBusy(false);
        }
      };

      const grabFrames = async (item) => {
        if (busy) return;
        setBusy(true);
        setError('');
        setNotice(`正在抽帧：${item.bvid}`);
        try {
          const r = await call('/api/frames', { bvid: item.bvid });
          setFrames((prev) => ({ ...prev, [item.bvid]: r.files || [] }));
          setNotice(`抽了 ${(r.files || []).length} 帧`);
        } catch (e) {
          setError(`抽帧失败：${String(e?.message ?? e)}`);
        } finally {
          setBusy(false);
        }
      };

      const argsText = (row) => {
        if (!row?.args || typeof row.args !== 'object') return '';
        return Object.entries(row.args)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
      };

      const grouped = new Map();
      for (const item of history) {
        const key = String(item.lastSeenAt || '').slice(0, 10) || '未知日期';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(item);
      }

      return h(
        'div',
        { className: 'shl-body' },
        error ? h('div', { className: 'shl-err' }, error) : null,
        notice ? h('div', { className: 'shl-ok' }, notice) : null,
        h(
          'div',
          { className: 'shl-stats' },
          h(Stat, { value: String(history.length), label: '刷过视频' }),
          h(Stat, { value: String(logs.length), label: '最近调用' }),
          h(Stat, { value: `${Number(cfg.frameMedium ?? 20)} 帧`, label: '中等时长默认' }),
        ),
        h(
          'div',
          { className: 'shl-toolbar' },
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: load }, '刷新'),
          h('button', { className: 'shl-btn shl-btn2', onClick: () => openInTab(base) }, '新窗口打开'),
          h('span', { className: 'shl-pick' }, base),
        ),
        h(
          PanelGroup,
          { title: '开关', note: '关掉「启用」后 QQ 里所有 bili_* 工具都会拒绝，历史仍可查看。' },
          h(Toggle, {
            label: '启用 B 站游客态',
            hint: '总开关',
            checked: cfg.enabled !== false,
            onChange: (v) => save({ enabled: v }),
          }),
          h(Toggle, {
            label: '记录刷过的视频',
            hint: '每次看详情/抽帧/分享时写入本地历史',
            checked: cfg.recordHistory !== false,
            onChange: (v) => save({ recordHistory: v }),
          }),
          h(Toggle, {
            label: '允许抽帧',
            hint: '下载 360P 视频并用 ffmpeg 抽帧，耗时较长',
            checked: cfg.allowFrames !== false,
            onChange: (v) => save({ allowFrames: v }),
          }),
          h(Toggle, {
            label: '允许分享到 QQ',
            hint: '封面先下载到本地再发，避免群聊拉远程封面失败',
            checked: cfg.allowShare !== false,
            onChange: (v) => save({ allowShare: v }),
          }),
        ),
        h(
          PanelGroup,
          { title: '分享' },
          h(
            Field,
            { label: '默认目标', hint: '私聊直接发主人；群聊用下面的群号' },
            h(
              'select',
              {
                value: cfg.shareTarget === 'group' ? 'group' : 'private',
                onChange: (e) => save({ shareTarget: e.target.value }),
              },
              h('option', { value: 'private' }, '主人私聊'),
              h('option', { value: 'group' }, '群聊'),
            ),
          ),
          h(
            Field,
            { label: '群号', hint: 'target=group 时使用' },
            h('input', {
              value: cfg.shareGroupId || '',
              placeholder: '123456789',
              onChange: (e) => save({ shareGroupId: e.target.value.trim() }),
            }),
          ),
        ),
        h(
          PanelGroup,
          {
            title: '媒体文件',
            note: '抽帧的 jpg 和临时下载的音频都放这里；视频源文件抽完就删，音频转写完也删，只留能看能听的那几步产物。',
          },
          h(
            Field,
            {
              label: '保存位置',
              hint: '留空就用 D:\\dsh-data\\bili-feed\\media；填绝对路径可指到别的盘',
            },
            h('input', {
              value: cfg.mediaDir || '',
              placeholder: 'D:\\dsh-data\\bili-feed\\media',
              onBlur: (e) => save({ mediaDir: e.target.value.trim() }),
            }),
          ),
        ),
        h(
          PanelGroup,
          {
            title: '抽帧帧数',
            note: '按视频实际时长分档；QQ 里调用 bili_frames 不传 count 时用这里的值，单次最多 40 帧。',
          },
          BILI_TIERS.map(([key, label, hint]) =>
            h(
              Field,
              { key, label, hint },
              h(NumInput, {
                min: 1,
                max: 40,
                value: cfg[key] ?? 20,
                onChange: (v) => save({ [key]: Number(v) }),
              }),
            ),
          ),
        ),
        h(
          PanelGroup,
          {
            title: '视频声音转写',
            note: 'B 站视频没有 CC 字幕时，下载音轨、用本地 faster-whisper 转成文字。不碰 QQ 语音——QQ 那边的语音走 SnowLuma 自带的识别。',
          },
          asrSt
            ? h(
                'div',
                { className: asrSt.ready ? 'shl-note' : 'shl-error' },
                (() => {
                  const missing = [];
                  if (asrSt.pythonOk === false) missing.push('Python');
                  if (asrSt.scriptOk === false) missing.push('转写脚本');
                  if (asrSt.env?.modelOk === false) missing.push('whisper 模型');
                  if (missing.length) {
                    return `✗ 还不能用：缺 ${missing.join('、')}。点下面的「一键安装转写环境」会一起装好（约 500 MB）。没有 CC 字幕的视频会转不了，其余功能不受影响。`;
                  }
                  return asrSt.ffmpegOk === false
                    ? `✓ 已就绪：${asrSt.model || 'small'} 模型。没找到 ffmpeg，会跳过抽音轨、直接让 whisper 解码原文件（慢一点）。`
                    : `✓ 已就绪：${asrSt.model || 'small'} 模型，没有字幕时会自动转写。`;
                })(),
              )
            : h('div', { className: 'shl-note' }, '正在检查转写环境…'),
          h(
            'div',
            { className: 'shl-toolbar' },
            h(
              'button',
              {
                type: 'button',
                className: 'shl-btn shl-btn-primary',
                onClick: () => installAsrEnv(false),
                disabled: envBusy,
              },
              envBusy ? '安装中…' : (asrSt?.ready ? '检查/修复转写环境' : '一键安装转写环境'),
            ),
          ),
          envMsg ? h('div', { className: 'shl-note' }, envMsg) : null,
          h(Toggle, {
            label: '启用本地转写',
            checked: (asr?.enabled !== false),
            onChange: (v) => patchAsr('enabled', v),
          }),
          h(
            Field,
            { label: '模型', hint: 'small 比 base 准不少，慢一倍左右；中文视频用 small。' },
            h('input', {
              className: 'shl-input',
              value: asr?.model || '',
              onChange: (e) => patchAsr('model', e.target.value),
            }),
          ),
          h(
            Field,
            { label: '语言' },
            h('input', {
              className: 'shl-input',
              value: asr?.lang || '',
              onChange: (e) => patchAsr('lang', e.target.value),
            }),
          ),
          h(
            Field,
            {
              label: 'Python 路径',
              hint: asrSt?.pythonOk
                ? '是 faster-whisper 的便携解释器（自带依赖，不用系统 Python）。'
                : '当前找不到。留空 = 用「一键安装」装到 ~/.dsh/shoreline/python 的那份。',
            },
            h('input', {
              className: 'shl-input',
              value: asrSt?.python || asr?.python || '',
              placeholder: 'C:\\Users\\<user>\\.dsh\\shoreline\\python\\python.exe',
              onChange: (e) => patchAsr('python', e.target.value),
            }),
          ),
          h(
            Field,
            {
              label: '转写脚本',
              hint: asrSt?.scriptOk
                ? '真正跑 whisper 的那个 Python 脚本。'
                : '当前找不到。留空 = 用「一键安装」放的那份。',
            },
            h('input', {
              className: 'shl-input',
              value: asrSt?.script || asr?.script || '',
              placeholder: 'D:\\dsh-data\\whisper\\transcribe.py',
              onChange: (e) => patchAsr('script', e.target.value),
            }),
          ),
          h(
            'div',
            { className: 'shl-note' },
            'ffmpeg 用来从视频里抽音轨，必须在 PATH 里（或设 BILI_FFMPEG 环境变量）。',
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h(
              'button',
              { type: 'button', className: 'shl-btn shl-btn-primary', onClick: saveAsr, disabled: asrBusy || !asr },
              asrBusy ? '保存中…' : '保存转写设置',
            ),
          ),
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, 'QQ 会话'),
          h(
            'div',
            { className: 'shl-note' },
            '只列出 QQ 聊天工作区里的会话。勾上 = 明确允许；不勾也默认放行（桥接映射过的 QQ 会话会自动识别）。这里只控制 B 站游客工具。',
          ),
          qqSessions.length
            ? h(
                'div',
                { className: 'shl-bili-scroll' },
                qqSessions.map((s) =>
                  h(
                    'label',
                    { key: s.id, className: 'shl-switch' },
                    h('input', {
                      type: 'checkbox',
                      checked: enabledSess.has(s.id) || Boolean(s.key && enabledSess.has(s.key)),
                      onChange: (e) => toggleSession(s, e.target.checked),
                    }),
                    s.label || String(s.id).slice(0, 8),
                    h('code', null, String(s.id).slice(0, 12)),
                  ),
                ),
              )
            : h('div', { className: 'shl-empty' }, '还没读到 QQ 会话。桥接启动后会自己同步。'),
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, `刷过的视频（${history.length}）`),
          history.length
            ? h(
                'div',
                { className: 'shl-bili-scroll' },
                [...grouped.entries()].map(([day, items], dayIndex) =>
                  h(
                    'details',
                    { key: day, className: 'shl-bili-day', open: dayIndex === 0 },
                    h('summary', null, `${day} · ${items.length} 条`),
                    h(
                      'div',
                      { className: 'shl-bili-daybody' },
                      items.map((item) =>
                        h(
                          'div',
                          { key: `${day}-${item.bvid}`, className: 'shl-bili-item' },
                          item.cover
                            ? h('img', {
                                className: 'shl-bili-cover',
                                src: item.cover,
                                referrerPolicy: 'no-referrer',
                                loading: 'lazy',
                                alt: '',
                              })
                            : null,
                          h(
                            'div',
                            { className: 'shl-main' },
                            h('div', { className: 'shl-text' }, item.title || item.bvid),
                            h(
                              'div',
                              { className: 'shl-meta' },
                              h('span', null, item.author || '?'),
                              h('span', null, `看过 ${item.seenCount || 1} 次`),
                              h('span', null, item.bvid),
                            ),
                            h(
                              'div',
                              { className: 'shl-ops' },
                              h(
                                'button',
                                { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => shareItem(item) },
                                '分享到 QQ',
                              ),
                              h(
                                'button',
                                { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => grabFrames(item) },
                                '抽帧',
                              ),
                              h(
                                'a',
                                { className: 'shl-link', href: item.url, target: '_blank', rel: 'noreferrer' },
                                '打开 B 站',
                              ),
                            ),
                            (frames[item.bvid] || []).length
                              ? h(
                                  'div',
                                  { className: 'shl-bili-frames' },
                                  frames[item.bvid].map((f) =>
                                    h(
                                      'a',
                                      { key: f.url, href: `${base}${f.url}`, target: '_blank', rel: 'noreferrer' },
                                      h('img', { src: `${base}${f.url}`, alt: f.time, title: f.time }),
                                    ),
                                  ),
                                )
                              : null,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : h('div', { className: 'shl-empty' }, '还没有记录。让小汐在 QQ 里刷两个视频就会出现在这里。'),
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, `最近调用（${logs.length}）`),
          h(
            'div',
            { className: 'shl-bili-logs' },
            h(
              'table',
              null,
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  ['时间', '工具', '耗时', '结果', '参数 / 错误'].map((t) => h('th', { key: t }, t)),
                ),
              ),
              h(
                'tbody',
                null,
                logs.length
                  ? logs.map((row, i) =>
                      h(
                        'tr',
                        { key: `${row.ts || i}-${i}` },
                        h('td', null, fmtWhen(row.ts)),
                        h('td', null, row.tool || ''),
                        h('td', null, row.ms != null ? `${row.ms} ms` : ''),
                        h(
                          'td',
                          { className: row.ok === false ? 'shl-bili-bad' : 'shl-bili-ok' },
                          row.ok === false ? '失败' : '成功',
                        ),
                        h('td', null, argsText(row) || row.error || ''),
                      ),
                    )
                  : h('tr', null, h('td', { colSpan: 5, className: 'shl-empty' }, '暂无调用')),
              ),
            ),
          ),
        ),
      );
    }

    function MemoryPanel() {
      const [tab, setTab] = useState('memory');
      return h(
        'div',
        { className: 'shl-app' },
        h(
          'div',
          { className: 'shl-head' },
          h('p', { className: 'shl-kicker' }, 'Shoreline'),
          h('h3', { className: 'shl-title' }, TABS.find((item) => item.key === tab)?.title ?? '记忆'),
          h('p', { className: 'shl-sub' }, TABS_SUB[tab] ?? ''),
        ),
        h(
          'div',
          { className: 'shl-tabs' },
          TABS.map((item) =>
            h(
              'button',
              {
                key: item.key,
                className: `shl-tab${tab === item.key ? ' on' : ''}`,
                disabled: item.disabled,
                title: item.disabled ? item.hint : undefined,
                onClick: item.disabled ? undefined : () => setTab(item.key),
              },
              item.label,
            ),
          ),
        ),
        tab === 'mood'
          ? h(MoodBody)
          : tab === 'voice'
            ? h(VoiceBody)
            : tab === 'bridge'
              ? h(BridgeBody)
              : tab === 'qzone'
                ? h(QzoneBody)
                : tab === 'bili'
                ? h(BiliBody)
                : tab === 'purpose'
                  ? h(PurposeBody)
                  : tab === 'fish'
                    ? h(FishBody)
                    : h(MemoryBody),
      );
    }

    const LOG_LABELS = { bridge: '桥接', activity: '消息活动', supervisor: '守护' };

    // DSH 桌面端把页面装进自建协议里（app://…），这时 location.hostname 是 "app"，
    // 拼出来就是 http://app:3100，打不开。只有真正的 http(s) 页面才信它。
    function localHost() {
      try {
        if (typeof window === 'undefined') return '127.0.0.1';
        const proto = String(window.location?.protocol || '');
        const host = String(window.location?.hostname || '').trim();
        if (proto !== 'http:' && proto !== 'https:') return '127.0.0.1';
        if (!host || host === 'app') return '127.0.0.1';
        if (host === 'localhost') return 'localhost';
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
        if (/^[a-zA-Z0-9.-]+$/.test(host)) return host;
      } catch {
        /* 忽略 */
      }
      return '127.0.0.1';
    }

    function minutesOf(ms) {
      return Math.round(Number(ms ?? 0) / 60000);
    }

    function pct(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return `${Math.round(n * 100)}%`;
    }

    function toMs(minutes) {
      return Math.round(Number(minutes || 0) * 60000);
    }

    function listText(value) {
      return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }

    function splitList(text) {
      return String(text ?? '')
        .split(/[\s,，、]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }

    function toDraft(cfg) {
      if (!cfg) return null;
      const p = cfg.purpose ?? {};
      const f = cfg.fishGuard ?? {};
      return {
        purpose: {
          ...p,
          gapMinMinutes: minutesOf(p.gapMinMs),
          gapMaxMinutes: minutesOf(p.gapMaxMs),
          initialDelayMinutes: minutesOf(p.initialDelayMinMs),
          idleThresholdMinutes: minutesOf(p.idleThresholdMs),
          retryMinutes: minutesOf(p.retryMs),
        },
        fishGuard: {
          ...f,
          windowMinutes: minutesOf(f.windowMs),
          cooldownMinutes: minutesOf(f.cooldownMs),
          groupNestIdsText: listText(f.groupNestIds),
          namePrefixesText: listText(f.namePrefixes),
          nameContainsText: listText(f.nameContains),
          nameSuffixesText: listText(f.nameSuffixes),
          groupNameSuffixesText: listText(f.groupNameSuffixes),
          exemptNamesText: listText(f.exemptNames),
          exemptIdsText: listText(f.exemptIds),
          fishIdsText: listText(f.fishIds),
        },
      };
    }

    function purposePayload(draft) {
      const p = draft?.purpose ?? {};
      return {
        enabled: p.enabled !== false,
        ownerUin: String(p.ownerUin ?? ''),
        gapMinMs: toMs(p.gapMinMinutes),
        gapMaxMs: toMs(p.gapMaxMinutes),
        initialDelayMinMs: toMs(p.initialDelayMinutes),
        dailyMax: Number(p.dailyMax ?? 0),
        activity: Number(p.activity ?? 50),
        plainChance: Number(p.plainChance ?? 0.5),
        quietStart: String(p.quietStart ?? ''),
        quietEnd: String(p.quietEnd ?? ''),
        idleThresholdMs: toMs(p.idleThresholdMinutes),
        materialWindowHours: Number(p.materialWindowHours ?? 72),
        biliWindowDays: Number(p.biliWindowDays ?? 7),
        maxMaterials: Number(p.maxMaterials ?? 36),
        minMaterials: Number(p.minMaterials ?? 2),
        maxCandidates: Number(p.maxCandidates ?? 6),
        retryMs: toMs(p.retryMinutes),
        maxAttempts: Number(p.maxAttempts ?? 3),
        promptMaxChars: Number(p.promptMaxChars ?? 16000),
      };
    }

    function fishPayload(draft) {
      const f = draft?.fishGuard ?? {};
      return {
        enabled: f.enabled !== false,
        windowMs: toMs(f.windowMinutes),
        cooldownMs: toMs(f.cooldownMinutes),
        maxFish: Number(f.maxFish ?? 5),
        maxConsecutiveFish: Number(f.maxConsecutiveFish ?? 5),
        singleFishMaxConsecutive: Number(f.singleFishMaxConsecutive ?? 5),
        maxFishMessages: Number(f.maxFishMessages ?? 8),
        maxFishRatio: Number(f.maxFishRatio ?? 0.6),
        minSample: Number(f.minSample ?? 8),
        minFishSendersForRatio: Number(f.minFishSendersForRatio ?? 2),
        groupNestMaxFish: Number(f.groupNestMaxFish ?? 3),
        groupNestIds: splitList(f.groupNestIdsText),
        namePrefixes: splitList(f.namePrefixesText),
        nameContains: splitList(f.nameContainsText),
        nameSuffixes: splitList(f.nameSuffixesText),
        groupNameSuffixes: splitList(f.groupNameSuffixesText),
        exemptNames: splitList(f.exemptNamesText),
        exemptIds: splitList(f.exemptIdsText),
        fishIds: splitList(f.fishIdsText),
        bypassDirectAddress: f.bypassDirectAddress !== false,
        blockSends: f.blockSends !== false,
      };
    }

    function openInTab(url) {
      try {
        window.open(url, '_blank', 'noopener');
      } catch {
        /* 忽略 */
      }
    }

    // —— 目的引擎 / 防刷屏：两个独立页签，字段对齐桥接的 normalize 配置 ——

    function Field({ label, hint, children }) {
      return h(
        'label',
        { className: 'shl-field' },
        h('span', null, label),
        children,
        hint ? h('em', null, hint) : null,
      );
    }

    function NumInput({ value, onChange, step, min, max }) {
      return h('input', {
        type: 'number',
        step: step ?? 1,
        min,
        max,
        value: value ?? '',
        onChange: (e) => onChange(e.target.value),
      });
    }

    function Toggle({ label, hint, checked, onChange }) {
      return h(
        'label',
        { className: 'shl-switch', title: hint || undefined },
        h('input', { type: 'checkbox', checked: checked !== false, onChange: (e) => onChange(e.target.checked) }),
        label,
      );
    }

    function PanelGroup({ title, note, children }) {
      return h(
        'div',
        { className: 'shl-section' },
        h('h4', { className: 'shl-h4' }, title),
        note ? h('div', { className: 'shl-note' }, note) : null,
        h('div', { className: 'shl-form' }, children),
      );
    }

    function todayText(at) {
      if (!at) return '—';
      try {
        return new Date(Number(at)).toLocaleString('zh-CN', { hour12: false });
      } catch {
        return '—';
      }
    }

    // ── 语音 ────────────────────────────────────────────────────────────────
    // 合成在桥接进程里跑，这里只改配置、看状态。情绪那栏的取值是实测结论：
    // 复刻音色 + emotion 标签会变形，sad 尤甚；慢速反而更像难过。
    // 「语音」页签：合成引擎（Edge / 火山复刻 v1 / v3）。
    // 转写（whisper）是 B 站视频用的，已经挪到「B 站」页，这里不再重复。
    function VoiceBody() {
      const [cfg, setCfg] = useState(null);
      const [st, setSt] = useState(null);
      const [draft, setDraft] = useState(null);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');
      const [busy, setBusy] = useState(false);
      const [envBusy, setEnvBusy] = useState(false);
      const [envMsg, setEnvMsg] = useState('');

      const load = useCallback(async () => {
        setError('');
        try {
          const res = await fetch(`${API}/voice`, { headers: { accept: 'application/json' } });
          const data = await res.json();
          if (!data?.ok) throw new Error(data?.error || '读不到语音配置');
          setCfg(data.config);
          setSt(data.status);
          setDraft(data.config);
        } catch (e) {
          setError(e?.message || '读不到语音配置');
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const patch = useCallback((group, key, value) => {
        setDraft((prev) => {
          if (!prev) return prev;
          if (key === null) return { ...prev, [group]: value };
          return { ...prev, [group]: { ...(prev[group] || {}), [key]: value } };
        });
      }, []);

      const save = useCallback(async () => {
        if (!draft) return;
        setBusy(true);
        setError('');
        setOk('');
        try {
          const pick = (g) => ({ [g]: draft[g] });
          const body = { patch: { ...pick('tts'), ...pick('reserved') } };
          body.patch.tts = {
            ...draft.tts,
            volc: { ...draft.tts.volc },
            edge: { ...draft.tts.edge },
            policy: { ...draft.tts.policy },
          };
          const res = await fetch(`${API}/voice`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!data?.ok) throw new Error(data?.error || '保存失败');
          setCfg(data.config);
          setSt(data.status);
          setDraft(data.config);
          setOk('存好了。合成在桥接侧执行，改完引擎或音色要重启桥接才生效。');
        } catch (e) {
          setError(e?.message || '保存失败');
        } finally {
          setBusy(false);
        }
      }, [draft]);

      const installEnv = useCallback(async (force = false) => {
        setEnvBusy(true);
        setEnvMsg('');
        setError('');
        try {
          const res = await fetch(`${API}/voice/edge-env`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ force }),
          });
          const data = await res.json();
          if (!data?.ok) throw new Error(data?.error || data?.env?.error || '安装失败');
          if (data.config) setCfg(data.config);
          if (data.status) setSt(data.status);
          if (data.config) setDraft(data.config);
          const sizeMb = Math.round((data.env?.sizeBytes ?? 0) / 1024 / 1024);
          setEnvMsg(`装好了：${data.env?.python || ''}（约 ${sizeMb} MB）。重启桥接后 Edge 就能用。`);
        } catch (e) {
          setEnvMsg('');
          setError(e?.message || '安装失败');
        } finally {
          setEnvBusy(false);
        }
      }, []);

      if (!draft) {
        return h(
          'div',
          { className: 'shl-body' },
          error
            ? h('div', { className: 'shl-error' }, error)
            : h('div', { className: 'shl-note' }, '正在读取语音配置…'),
        );
      }

      const tts = draft.tts || {};
      const edge = tts.edge || {};
      const volc = tts.volc || {};
      const policy = tts.policy || {};
      const reserved = draft.reserved || {};
      const enabled = tts.enabled !== false;
      const engineLabel = tts.engine === 'volc' ? '火山复刻' : 'Edge';

      const engineChip = (key, label) =>
        h(
          'button',
          {
            key,
            type: 'button',
            className: `shl-chip${tts.engine === key ? ' shl-chip-on' : ''}`,
            onClick: () => patch('tts', 'engine', key),
          },
          label,
        );

      const emotionChip = (mode, label) =>
        h(
          'button',
          {
            key: mode,
            type: 'button',
            className: `shl-chip${(volc.emotion || 'auto') === mode ? ' shl-chip-on' : ''}`,
            onClick: () => patch('tts', 'volc', { ...volc, emotion: mode }),
          },
          label,
        );

      return h(
        'div',
        { className: 'shl-body' },
        h(
          'div',
          { className: 'shl-stats' },
          h(Stat, {
            value: enabled ? engineLabel : '已关闭',
            label: '当前引擎',
            tone: enabled && (tts.engine === 'edge' || st?.volc?.ready) ? 'on' : 'warn',
          }),
          h(Stat, {
            value: st?.volc?.voiceId || '—',
            label: '复刻音色',
            tone: st?.volc?.ready ? 'on' : 'off',
          }),
        ),

        h(
          'div',
          { className: 'shl-toolbar' },
          h('button', { type: 'button', className: 'shl-btn', onClick: load, disabled: busy }, '重新读取'),
          h('button', { type: 'button', className: 'shl-btn shl-btn-primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存到 voice.json'),
          ok ? h('span', { className: 'shl-ok' }, ok) : null,
          error ? h('span', { className: 'shl-error' }, error) : null,
        ),

        h(
          PanelGroup,
          {
            title: '开关与引擎',
            note: '火山复刻更富有情感；当火山复刻不生效时，默认用 Edge 出声。',
          },
          h(Toggle, {
            label: '语音合成总开关',
            checked: enabled,
            onChange: (v) => patch('tts', 'enabled', v),
          }),
          h(
            'div',
            { className: 'shl-chips' },
            engineChip('edge', 'Edge'),
            engineChip('volc', '火山复刻'),
          ),
          Field({
            label: 'Edge 音色',
            hint: 'Edge 不需要密钥。换成别的 voice_id 也可以，例如 zh-CN-XiaoxiaoNeural。',
            children: h('input', {
              className: 'shl-input',
              value: edge.voice || '',
              onChange: (e) => patch('tts', 'edge', { ...edge, voice: e.target.value }),
            }),
          }),
          h(
            'div',
            { className: 'shl-note' },
            st?.edge?.env?.ready
              ? `Edge 环境：已就绪（Python ${st.edge.env.python || ''}，约 ${Math.round((st.edge.env.sizeBytes || 0) / 1024 / 1024)} MB）`
              : `Edge 环境：未安装。点下面按钮会下载 Windows 嵌入式 Python 3.11 + edge-tts（约 40 MB，落在 ~/.dsh/shoreline/python）。`,
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h(
              'button',
              {
                type: 'button',
                className: 'shl-btn',
                disabled: envBusy || busy,
                onClick: () => installEnv(false),
              },
              envBusy ? '正在安装…' : (st?.edge?.env?.ready ? '重新安装 Edge 环境' : '一键安装 Edge 环境'),
            ),
          ),
          envMsg ? h('div', { className: 'shl-ok' }, envMsg) : null,
          Field({
            label: 'Edge · Python 路径',
            hint: st?.edge?.pythonOk
              ? `已找到 Python（${st.edge.python || ''}）。一键安装后这里会自动填好。`
              : `没找到 Python（当前：${edge.python || '默认路径'}）。可以点上面的「一键安装」，或手动填一个；填好重启桥接。`,
            children: h('input', {
              className: 'shl-input',
              placeholder: 'D:\\python\\python.exe（留空用默认路径）',
              value: edge.python || '',
              onChange: (e) => patch('tts', 'edge', { ...edge, python: e.target.value }),
            }),
          }),
          Field({
            label: 'Edge · tts.py 路径',
            hint: '调用 edge-tts 的脚本。一键安装会把它放进插件的 Python 目录并自动填好；手动装的话自己放一份。',
            children: h('input', {
              className: 'shl-input',
              placeholder: 'D:\\tts\\tts.py（留空用默认路径）',
              value: edge.script || '',
              onChange: (e) => patch('tts', 'edge', { ...edge, script: e.target.value }),
            }),
          }),
        ),

        h(
          PanelGroup,
          {
            title: '火山账号（v1 / v3 共用）',
            note: 'AppID 和音色 ID 两条链路都要；Access Token 在没有 API Key 时也给 v3 当凭据用。',
          },
          Field({
            label: 'AppID',
            hint: '火山控制台里的应用 ID，v1 和 v3 都要放进请求头。',
            children: h('input', {
              className: 'shl-input',
              value: volc.appId || '',
              onChange: (e) => patch('tts', 'volc', { ...volc, appId: e.target.value }),
            }),
          }),
          Field({
            label: 'Access Token',
            hint: 'v1 必需；v3 在没有 API Key 时用它当凭据。',
            children: h('input', {
              className: 'shl-input',
              type: 'password',
              value: volc.token || '',
              onChange: (e) => patch('tts', 'volc', { ...volc, token: e.target.value }),
            }),
          }),
          Field({
            label: '音色 ID',
            hint: '控制台音色库里 S_ 开头的那串；v1 和 v3 共用这一个。',
            children: h('input', {
              className: 'shl-input',
              value: volc.voiceId || '',
              onChange: (e) => patch('tts', 'volc', { ...volc, voiceId: e.target.value }),
            }),
          }),
        ),

        h(
          PanelGroup,
          {
            title: '火山复刻 · v1',
            note: 'v1（集群 volcano_icl）只能用 happy / sad / angry 三个语气标签。没填 API Key 和资源 ID 时走这条。',
          },
          Field({
            label: '集群',
            hint: '复刻音色只认 volcano_icl。',
            children: h('input', {
              className: 'shl-input',
              value: volc.cluster || '',
              onChange: (e) => patch('tts', 'volc', { ...volc, cluster: e.target.value }),
            }),
          }),
          h('div', { className: 'shl-subh' }, '语气'),
          h(
            'div',
            { className: 'shl-chips' },
            emotionChip('auto', '自动（按情感加标签）'),
            emotionChip('none', '不传标签（只调语速）'),
          ),
          h(
            'div',
            { className: 'shl-note' },
            '自动：真高兴时加 happy、气到 30 以上才可能加标签；不传标签：任何情况都不加，只改语速。实测复刻音色叠 sad 标签会变形，所以「不该高兴」时只用慢，标签只在真高兴时轻点一下。',
          ),
          Field({
            label: '开心时的强度',
            hint: '1 最自然；4 已经像在表演，别往上加。只在「自动」模式下用。',
            children: h(NumInput, {
              value: Number(policy.happyScale ?? 1),
              min: 0,
              max: 5,
              onChange: (v) => patch('tts', 'policy', { ...policy, happyScale: v }),
            }),
          }),
          h(Toggle, {
            label: '低落时改用慢速',
            checked: policy.sadUseSlow !== false,
            onChange: (v) => patch('tts', 'policy', { ...policy, sadUseSlow: v }),
          }),
          Field({
            label: '低落的语速倍率',
            hint: '0.92 是实测里最像「有点难过」的值。关掉上面那个开关时，这里不生效。',
            children: h(NumInput, {
              value: Number(policy.sadSpeed ?? 0.92),
              min: 0.7,
              max: 1.2,
              step: 0.01,
              onChange: (v) => patch('tts', 'policy', { ...policy, sadSpeed: v }),
            }),
          }),
        ),

        h(
          PanelGroup,
          {
            title: '火山复刻 · v3',
            note: 'v3（资源 seed-icl-2.0）能带一句心情描述，模型自己判断怎么念。填了 API Key 或资源 ID 就走 v3。注意复刻音色资源必须是 seed-icl-2.0，写成 volc.megatts.voiceclone 会报并发超限——那是「并发版」那条线，配额是 0。',
          },
          Field({
            label: 'API Key',
            hint: '控制台「API Key」页建的。不填也能走 v3，会用 Access Token 鉴权。',
            children: h('input', {
              className: 'shl-input',
              type: 'password',
              value: volc.apiKey || '',
              onChange: (e) => patch('tts', 'volc', { ...volc, apiKey: e.target.value }),
            }),
          }),
          Field({
            label: '资源 ID',
            hint: '字符版声音复刻是 seed-icl-2.0；普通音色是 seed-tts-2.0。',
            children: h('input', {
              className: 'shl-input',
              value: volc.resourceId || '',
              onChange: (e) => patch('tts', 'volc', { ...volc, resourceId: e.target.value }),
            }),
          }),
          Field({
            label: '语速',
            hint: '-50~100，负数更慢。实测 0 / -10 / -20 三档，-10 最自然；再往下只多 1 KB，收益递减。',
            children: h('input', {
              className: 'shl-input',
              type: 'number',
              min: -50,
              max: 100,
              step: 1,
              value: Number.isFinite(Number(volc.speechRate)) ? Number(volc.speechRate) : -10,
              onChange: (e) => patch('tts', 'volc', { ...volc, speechRate: Number(e.target.value) }),
            }),
          }),
          h('div', { className: 'shl-subh' }, '念法怎么定'),
          h(
            'div',
            { className: 'shl-note' },
            'instruction 只来自她自己写的 style：写了就用她的，没写就空着走裸合成，系统不代她挑语气。注意 QQ 合成仍会叠上面的语速档（默认 -10），和火山控制台的裸合成听起来不一样，属正常。',
          ),
          h(Toggle, {
            label: '自然语言指令（instruction）',
            checked: reserved.instruction !== false,
            onChange: (v) => patch('reserved', 'instruction', v),
          }),
          h(Toggle, {
            label: '上下文引用（context_texts，暂未接入）',
            checked: reserved.contextTexts === true,
            onChange: (v) => patch('reserved', 'contextTexts', v),
          }),
        ),

        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '为什么不是「让模型自己读情感」'),
          h(
            'div',
            { className: 'shl-how' },
            h('p', null, '会读。实测同一句话只改措辞、不传任何情绪参数，三条音频的哈希全不一样——它确实会从文字里判断该怎么念。'),
            h('p', null, '但它只看得到这一段文字。同一句「没事，你忙吧」，在撒娇和真生气里是两种念法，而字面一模一样。这时候才需要一个标签（或者一句指令）把真实状态告诉它。'),
            h('p', null, '所以两层配合：文字负责大头，让她真的写带情绪的话；情感值只在文字和状态打架时补一刀。'),
          ),
        ),
      );
    }

    function PurposeBody() {
      const [status, setStatus] = useState(null);
      const [draft, setDraft] = useState(null);
      const [file, setFile] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');

      const load = async () => {
        const fails = [];
        try {
          const s = await api('/bridge/status');
          setStatus(s?.bridge ?? null);
        } catch (e) {
          fails.push(`status ${String(e?.message ?? e)}`);
        }
        try {
          const c = await api('/bridge/settings');
          if (c?.ok === false) throw new Error(c.error || '读取配置失败');
          setDraft(toDraft(c));
          setFile(c.file || '');
        } catch (e) {
          fails.push(`settings ${String(e?.message ?? e)}`);
        }
        setError(fails.length ? `有 ${fails.length} 个接口没取到：${fails.join('；')}` : '');
      };

      useEffect(() => {
        load();
      }, []);

      const P = draft?.purpose ?? {};
      const setP = (key, value) =>
        setDraft((prev) => (prev ? { ...prev, purpose: { ...prev.purpose, [key]: value } } : prev));

      const save = async () => {
        if (!draft) return;
        setBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/settings', {
            method: 'POST',
            body: JSON.stringify({ purpose: purposePayload(draft) }),
          });
          if (data.ok === false) throw new Error(data.error || '保存失败');
          setDraft(toDraft(data));
          setFile(data.file || file);
          setOk(`已写回 ${data.file || 'config.json'}${data.backup ? `（备份 ${String(data.backup).split('\\').pop()}）` : ''}。${data.restartHint || ''}`);
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const st = status?.purpose ?? {};
      const NEED_LABEL = {
        play: '玩',
        learn: '学',
        install: '装',
        connect: '陪',
        care: '关心',
        share: '分享',
        identity: '自我',
        create: '创作',
        consume: '体验',
      };
      // 六种动机：决定这一轮「为什么想开口」，也会给候选加权。
      const MOTIVE_LABEL = {
        longing: '想他',
        waiting: '等回话',
        company: '想让人陪',
        deep: '想认真聊一次',
        angry: '气着',
        whim: '想起一出是一出',
      };
      const BLOCK_LABEL = { avoid: '不想理人（怒气 + 委屈 ≥ 100）', exhausted: '累瘫了（疲倦 ≥ 85）' };
      // 活跃度是配置项：优先显示草稿里的值，保存后立刻跟着变，不用等桥接重启刷新状态。
      const actValue = Number(P.activity ?? st.activity ?? 50);
      const drives = st.drives && typeof st.drives === 'object' ? st.drives : {};
      const driveRows = Object.keys(NEED_LABEL).map((key) => {
        const value = Math.max(0, Math.min(100, Math.round(Number(drives[key] ?? 0) * 100)));
        return h(
          'div',
          { className: 'shl-weight', key },
          h('span', null, NEED_LABEL[key]),
          h('span', { className: 'track' }, h('i', { style: { width: `${value}%` } })),
          h('b', null, String(value)),
        );
      });
      const num = (key, label, hint, extra) =>
        h(
          Field,
          { label, hint },
          h(NumInput, {
            value: P[key],
            onChange: (v) => setP(key, v),
            ...(extra || {}),
          }),
        );

      if (!draft) {
        return h(
          'div',
          { className: 'shl-body' },
          error ? h('div', { className: 'shl-err' }, error) : h('div', { className: 'shl-empty' }, '读取配置中…'),
        );
      }

      return h(
        'div',
        { className: 'shl-body' },
        h(
          'div',
          { className: 'shl-stats' },
          h(Stat, { value: `${st.countToday ?? 0} / ${P.dailyMax ?? 0}`, label: '今天已出发' }),
          h(Stat, { value: st.enabled === false ? '已关闭' : '开着', label: '开关' }),
          h(Stat, { value: st.lastEmotionLabel || '—', label: '上次情绪' }),
          h(Stat, { value: Array.isArray(st.pending) ? String(st.pending.length) : '—', label: '心里惦记着' }),
        ),
        h(
          'div',
          { className: 'shl-kv' },
          h('span', null, '上次出发'),
          h('b', null, todayText(st.lastRunAt || st.lastSentAt)),
          h('span', null, '下次'),
          h('b', null, status?.nextFireText || todayText(st.nextFireAt)),
          h('span', null, '上次目的'),
          h('b', null, st.lastPurpose || '—'),
          h('span', null, '上次说的'),
          h('b', null, st.lastText || '—'),
          st.lastSkip?.reason ? h('span', null, '最近没出发') : null,
          st.lastSkip?.reason
            ? h('b', null, `${st.lastSkip.reason}${st.lastSkip.at ? `（${todayText(st.lastSkip.at)}）` : ''}`)
            : null,
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '此刻在想什么'),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, '活跃度'),
            h('b', null, `${actValue} / 100${actValue === 50 ? '（原样）' : ''}`),
            h('span', null, '此刻的动机'),
            h('b', null, MOTIVE_LABEL[st.motive] || '没判出来（情绪平，或者刚聊过）'),
            h('span', null, '这一轮会不会开口'),
            h(
              'b',
              null,
              st.moodBlocked
                ? `被挡住：${BLOCK_LABEL[st.moodBlockReason] || st.moodBlockReason}`
                : typeof st.moodChance === 'number'
                  ? `按 ${pct(st.moodChance)} 的概率试一次`
                  : '—',
            ),
            st.moodLine ? h('span', null, '她此刻的处境') : null,
            st.moodLine ? h('b', null, st.moodLine) : null,
          ),
          h(
            'p',
            { className: 'shl-note' },
            '动机不是随便挑的：先看心情，再看多久没说话。刚被气到会想「等回话」，亲近又久没聊会想「让人陪」，开心且不累会「想起一出是一出」。挑不出动机时按活跃度决定要不要碰运气。',
          ),
        ),
        h(
          'details',
          { className: 'shl-how' },
          h('summary', null, '它是怎么想出一件事的'),
          h(
            'ol',
            null,
            h('li', null, h('em', null, '攒素材'), '：最近群里和私聊里说过的话、记忆库里值得提的旧事（越久权重越低，两周减半）、人格卡里她是个什么样的人。B 站素材目前还没接。'),
            h('li', null, h('em', null, '抽需要'), '：这件事指向哪种需要——玩、学、装、陪、关心、分享、自我、创作、体验。九种需要各有一个当前「渴度」。'),
            h('li', null, h('em', null, '打情绪'), '：不是认情绪词，而是判断「这件事对我意味着什么」——好奇、兴奋、寂寞、羡慕、担心。同一件事换一种情绪，走向完全不同。'),
            h('li', null, h('em', null, '算权重'), '：候选分数 = 素材权重 × 需要渴度 × 情绪加成 ÷ 重复惩罚。最近说过的方向会被压分，连着说两次压得更狠。'),
            h('li', null, h('em', null, '挑一个'), '：在分数靠前的几个里加权随机，不是永远选最高那个——否则会变成复读机。'),
          ),
          h('h5', null, '心情怎么影响开口'),
          h(
            'ol',
            null,
            h('li', null, h('em', null, '两档硬闸'), '：怒气 + 委屈 ≥ 100 时「不想理人」，疲倦 ≥ 85 时「累瘫了」。这两档不开口，过三四个小时再看。'),
            h('li', null, h('em', null, '六种动机'), '：想他 / 等回话 / 想让人陪 / 想认真聊一次 / 气着 / 想起一出是一出。每种有自己的门槛和概率，会往对应的候选上加权。'),
            h('li', null, h('em', null, '活跃度'), '：最后一道乘法。0–100，50 是原样，调小更懒得开口，调大更容易真发出来。只影响概率，不影响硬闸。'),
            h('li', null, h('em', null, '念头'), '：有时候不是从素材推出来的，而是当下冒出一个念头——想被夸、想他、想安静、想让人陪、想讲点事、想问一句。同类十分钟内只出一次，连着三次没被接住就放弃。'),
          ),
          h('p', null, '「渴度」随时间和被满足而变：说过话会降下去，长时间没人说话会慢慢回升。素材越多、越集中在某个方向，那个方向的目的就越容易占上风。'),
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '当前目的权重'),
          h('div', { className: 'shl-weights' }, driveRows),
          h(
            'div',
            { className: 'shl-note' },
            st.lastEmotionLabel
              ? `上次的情绪是「${st.lastEmotionLabel}」${st.lastEmotionText ? `：${st.lastEmotionText}` : ''}`
              : '还没有记录到情绪。',
          ),
        ),
        (st.goals ?? []).length
          ? h(
              'div',
              { className: 'shl-section' },
              h('h4', { className: 'shl-h4' }, `心里惦记着的方向（${st.goalCount ?? st.goals.length} 个，显示前 5 个）`),
              h(
                'div',
                { className: 'shl-goals' },
                (st.goals ?? []).map((g, i) =>
                  h(
                    'div',
                    { className: 'shl-goal', key: g.id || i },
                    h(
                      'div',
                      { className: 'row' },
                      h('b', null, g.object || g.domain || g.need || '某件事'),
                      h('i', null, g.ownerLabel ? `· ${g.ownerLabel}` : ''),
                      h('span', { className: 'shl-badge' }, g.action || g.intent || ''),
                    ),
                    h(
                      'div',
                      { className: 'row' },
                      h('i', null, `置信 ${pct(g.confidence)} · 价值 ${pct(g.value)} · 风险 ${pct(g.risk)}`),
                    ),
                    g.nextStep ? h('div', { className: 'row' }, h('i', null, g.nextStep)) : null,
                  ),
                ),
              ),
            )
          : null,
        h(
          PanelGroup,
          { title: '节奏与安静', note: '决定「多久找一次」和「什么时候不能找」。' },
          h(Toggle, {
            label: '启用目的机制',
            hint: '关掉后不会主动私聊；手动触发仍可用',
            checked: P.enabled,
            onChange: (v) => setP('enabled', v),
          }),
          num('dailyMax', '每天最多几次', '0 = 不限（仍受 token 额度约束）', { min: 0, max: 24 }),
          num('activity', '活跃度', '0–100，50 是原样。越低越懒得开口，越高越容易真的发出来；害怕打扰就调小，觉得太闷就调大', { min: 0, max: 100 }),
          num('plainChance', '平常心境时开口的概率（0–1）', '默认 0.5。只在「心境平常、判不出动机」时按它掷一次，掷不过就跳过、重抽下次。你刚说完话 1 小时内，这一档直接跳过（不重置计时）；具体动机不受影响。', { min: 0, max: 1, step: 0.05 }),
          num('gapMinMinutes', '两次之间至少（分钟）', '默认 90。开口后，下一次不早于这个数。', { min: 5, max: 1440 }),
          num('gapMaxMinutes', '两次之间最多（分钟）', '默认 240。每次开口后在这两个数之间均匀随机抽，不是固定间隔。', { min: 5, max: 1440 }),
          num('initialDelayMinutes', '启动后先等（分钟）', '重启/换角色后第一枪的起跑延迟', { min: 1, max: 720 }),
          num('idleThresholdMinutes', '你空闲多久才打扰（分钟）', '默认 20。你还在聊就先不冒头（所有动机都挡）；过点后具体动机可掷，「平常」档仍要等你安静满 1 小时。', { min: 0, max: 720 }),
          h(
            Field,
            { label: '安静时段', hint: 'HH:MM；两个相同 = 不设安静时段' },
            h(
              'div',
              { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('input', {
                className: 'shl-input',
                style: { minWidth: 0, width: '84px', flex: 'none' },
                value: P.quietStart ?? '',
                onChange: (e) => setP('quietStart', e.target.value),
              }),
              h('span', null, '~'),
              h('input', {
                className: 'shl-input',
                style: { minWidth: 0, width: '84px', flex: 'none' },
                value: P.quietEnd ?? '',
                onChange: (e) => setP('quietEnd', e.target.value),
              }),
            ),
          ),
        ),
        h(
          PanelGroup,
          {
            title: '素材与目标',
            note: '决定「拿什么来想」和「想几个方向」。记忆按时间加权：越久权重越低，两周减半；两个月之后改用更慢的步子（每半年再减半），保证再旧的事也留着一点机会、但不跟新事抢位置。最初的日子、约定、称呼这类骨架件有固定下限，不会被时间压没。',
          },
          num('materialWindowHours', '从最近聊天里取原话的范围（小时）', '默认 72；取的是没经过她记忆筛选的原话，跟下面的记忆库互不影响', { min: 1, max: 336 }),
          num('maxMaterials', '最多带多少条素材', '默认 36；太多会挤占提示词', { min: 6, max: 80 }),
          num('minMaterials', '素材少于多少就不硬找话', '有「心里惦记的事」时例外', { min: 0, max: 20 }),
          num('maxCandidates', '提示词最多给几个方向', '默认 6；按需要/归属去重', { min: 3, max: 10 }),
        ),
        h(
          PanelGroup,
          { title: '重试与上限', note: '失败了怎么办、提示词塞多满、找谁。' },
          num('retryMinutes', '失败后多久重试（分钟）', '默认 15', { min: 1, max: 360 }),
          num('maxAttempts', '最多重试几次', '连续失败后回到正常间隔', { min: 1, max: 10 }),
          num('promptMaxChars', '提示词硬上限（字符）', '超出会截中间、保留头尾指令', { min: 4000, max: 30000, step: 1000 }),
          h(
            Field,
            { label: '找哪个 QQ（留空 = 主人）', hint: '必须同时在该白名单里' },
            h('input', {
              value: P.ownerUin ?? '',
              placeholder: '留空',
              onChange: (e) => setP('ownerUin', e.target.value),
            }),
          ),
        ),
        h(
          'div',
          { className: 'shl-toolbar' },
          h('button', { className: 'shl-btn', disabled: busy, onClick: save }, busy ? '保存中…' : '保存到 config.json'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: load }, '重新读取'),
          h('span', { className: 'shl-note' }, file),
        ),
        error ? h('div', { className: 'shl-err' }, error) : null,
        ok ? h('div', { className: 'shl-ok' }, ok) : null,
        h(
          'div',
          { className: 'shl-note' },
          '这些参数是桥接启动时读进内存的，改完要重启桥接才生效（「桥接/角色」页签里有重启）。',
        ),
      );
    }

    function FishBody() {
      const [draft, setDraft] = useState(null);
      const [file, setFile] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');

      const load = async () => {
        try {
          const c = await api('/bridge/settings');
          if (c?.ok === false) throw new Error(c.error || '读取配置失败');
          setDraft(toDraft(c));
          setFile(c.file || '');
          setError('');
        } catch (e) {
          setError(String(e?.message ?? e));
        }
      };

      useEffect(() => {
        load();
      }, []);

      const F = draft?.fishGuard ?? {};
      const setF = (key, value) =>
        setDraft((prev) => (prev ? { ...prev, fishGuard: { ...prev.fishGuard, [key]: value } } : prev));

      const save = async () => {
        if (!draft) return;
        setBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/settings', {
            method: 'POST',
            body: JSON.stringify({ fishGuard: fishPayload(draft) }),
          });
          if (data.ok === false) throw new Error(data.error || '保存失败');
          setDraft(toDraft(data));
          setFile(data.file || file);
          setOk(`已写回 ${data.file || 'config.json'}${data.backup ? `（备份 ${String(data.backup).split('\\').pop()}）` : ''}。${data.restartHint || ''}`);
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const num = (key, label, hint, extra) =>
        h(
          Field,
          { label, hint },
          h(NumInput, {
            value: F[key],
            onChange: (v) => setF(key, v),
            ...(extra || {}),
          }),
        );
      const list = (key, label, hint) =>
        h(
          Field,
          { label, hint },
          h('input', {
            value: F[key] ?? '',
            onChange: (e) => setF(key, e.target.value),
          }),
        );

      if (!draft) {
        return h(
          'div',
          { className: 'shl-body' },
          error ? h('div', { className: 'shl-err' }, error) : h('div', { className: 'shl-empty' }, '读取配置中…'),
        );
      }

      return h(
        'div',
        { className: 'shl-body' },
        h(
          'div',
          { className: 'shl-note' },
          '同一批同类 bot 被拉进同一个群时，不要集体刷屏。规则看两件事：最近这个窗口里有几条「鱼」在说话、连续几条全是鱼。',
          '被直接 @、被引用、主人点名时默认放行（可关）。这里只做判定，冷却计时和硬拦发送由桥接负责。',
        ),
        h(
          PanelGroup,
          { title: '开关与窗口' },
          h(Toggle, {
            label: '启用防刷屏',
            checked: F.enabled,
            onChange: (v) => setF('enabled', v),
          }),
          h(Toggle, {
            label: '超限时直接拦住发送',
            hint: '关掉则只提示，不阻断',
            checked: F.blockSends,
            onChange: (v) => setF('blockSends', v),
          }),
          h(Toggle, {
            label: '被点名时放行',
            hint: '直接 @ / 引用 / 主人点名的消息不受限制',
            checked: F.bypassDirectAddress,
            onChange: (v) => setF('bypassDirectAddress', v),
          }),
          num('windowMinutes', '判定窗口（分钟）', '默认 10', { min: 1, max: 1440 }),
          num('cooldownMinutes', '拦下后冷却（分钟）', '默认 10；冷却期内继续不发言', { min: 1, max: 1440 }),
        ),
        h(
          PanelGroup,
          { title: '判定阈值', note: '三条规则任一命中就认为「在集体刷屏」。' },
          num('maxFish', '窗口内不同的鱼 ≥ 几条', '默认 5；不同发送者的数量', { min: 2, max: 20 }),
          num('maxConsecutiveFish', '连续几条全是鱼', '默认 5；中间有真人就断开', { min: 2, max: 30 }),
          num('singleFishMaxConsecutive', '只有一只鱼时连续几条', '默认 5；避免误判正常连发', { min: 2, max: 50 }),
          num('maxFishMessages', '鱼消息条数 ≥', '补充规则，默认 8', { min: 2, max: 100 }),
          num('maxFishRatio', '鱼消息占比 ≥', '0~1，默认 0.6', { min: 0, max: 1, step: 0.05 }),
          num('minSample', '样本至少几条才看占比', '默认 8；太少不判', { min: 2, max: 200 }),
          num('minFishSendersForRatio', '占比规则至少几只鱼', '默认 2', { min: 1, max: 20 }),
          num('groupNestMaxFish', '鱼窝群里阈值收紧到', '群名像鱼窝时用这个', { min: 2, max: 20 }),
        ),
        h(
          PanelGroup,
          {
            title: '名单与豁免',
            note: '逗号分隔。名单里的人是「鱼」还是「不是鱼」，直接影响上面的计数。',
          },
          list('groupNestIdsText', '鱼窝群号', '逗号分隔的群号'),
          list('fishIdsText', '强制算作鱼（QQ 号）', '逗号分隔'),
          list('exemptIdsText', '强制不算鱼（QQ 号）', '逗号分隔'),
          list('exemptNamesText', '豁免昵称', '逗号分隔'),
          list('namePrefixesText', '名字开头算鱼', '默认空'),
          list('nameContainsText', '名字包含算鱼', '默认「肥鱼」'),
          list('nameSuffixesText', '名字结尾算鱼', '默认「肥鱼 / fish / 鱼」'),
          list('groupNameSuffixesText', '群名结尾算鱼窝', '默认「肥鱼 / fish」'),
        ),
        h(
          'div',
          { className: 'shl-toolbar' },
          h('button', { className: 'shl-btn', disabled: busy, onClick: save }, busy ? '保存中…' : '保存到 config.json'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: load }, '重新读取'),
          h('span', { className: 'shl-note' }, file),
        ),
        error ? h('div', { className: 'shl-err' }, error) : null,
        ok ? h('div', { className: 'shl-ok' }, ok) : null,
      );
    }

    function BridgeBody() {
      const [status, setStatus] = useState(null);
      const [sessions, setSessions] = useState([]);
      const [sessionsCwd, setSessionsCwd] = useState('');
      const [logs, setLogs] = useState(null);
      const [logName, setLogName] = useState('bridge');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');
      const [snowluma, setSnowluma] = useState(null);
      const [consoleInfo, setConsoleInfo] = useState(null);
      const [gateway, setGateway] = useState(null);
      // null 表示「还没从服务端读到过」；用户手动清空后是 ''，轮询不会再把它填回去。
      const [gwHome, setGwHome] = useState(null);
      const [gwKind, setGwKind] = useState('');
      const [upd, setUpd] = useState(null);
      const [updBusy, setUpdBusy] = useState(false);
      const [nodeEnv, setNodeEnv] = useState(null);
      const [nodeBusy, setNodeBusy] = useState(false);

      const loadStatus = async (announce) => {
        const fails = [];
        const get = async (path) => {
          try {
            return { ok: true, data: await api(path) };
          } catch (e) {
            fails.push(`${path} ${String(e?.message ?? e)}`);
            return { ok: false, data: null };
          }
        };
        const [st, ss, sl, cs, gw, nd] = await Promise.all([
          get('/bridge/status'),
          get('/bridge/sessions'),
          get('/bridge/snowluma'),
          get('/bridge/console'),
          get('/bridge/gateway'),
          get('/bridge/node'),
        ]);
        if (st.ok) setStatus(st.data?.bridge ?? null);
        if (ss.ok) {
          setSessions(Array.isArray(ss.data?.sessions) ? ss.data.sessions : []);
          setSessionsCwd(ss.data?.cwd ?? '');
        }
        if (sl.ok) setSnowluma(sl.data?.snowluma ?? null);
        if (cs.ok) setConsoleInfo(cs.data ?? null);
        if (nd.ok && nd.data) setNodeEnv(nd.data);
        if (gw.ok && gw.data?.ok) {
          setGateway(gw.data);
          setGwHome((prev) => (prev == null ? (gw.data.home || '') : prev));
          setGwKind((prev) => prev || gw.data.kind || 'auto');
        }
        setError(fails.length ? `有 ${fails.length} 个接口没取到：${fails.join('；')}` : '');
        if (announce) setOk(announce);
      };

      const loadLogs = async (name) => {
        try {
          const data = await api(`/bridge/logs?file=${encodeURIComponent(name)}&lines=200`);
          setLogs(data);
        } catch (e) {
          setLogs({ ok: false, lines: [String(e?.message ?? e)] });
        }
      };

      useEffect(() => {
        loadStatus();
      }, []);

      useEffect(() => {
        // 版本检查单独跑一次：面板每 10 秒轮询状态，不必每次都问 GitHub（服务端还有 30 分钟缓存）。
        // 接口外层 ok 恒为 true，检查失败信息在 checkOk / checkError 里，这样「当前版本」始终能显示。
        (async () => {
          try {
            setUpd(await api('/bridge/update'));
          } catch (e) {
            setUpd((prev) => ({ ...(prev ?? {}), ok: false, checkOk: false, checkError: String(e?.message ?? e) }));
          }
        })();
      }, []);

      useEffect(() => {
        loadLogs(logName);
      }, [logName]);

      useEffect(() => {
        const timer = setInterval(() => loadStatus(), 10000);
        return () => clearInterval(timer);
      }, []);

      const action = async (path, label) => {
        setBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api(path, { method: 'POST', body: '{}' });
          if (data.ok === false) throw new Error(data.error || `${label}失败`);
          await loadStatus(`${label}完成。`);
          await loadLogs(logName);
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const startSnowLuma = async () => {
        setBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/snowluma/start', { method: 'POST', body: '{}' });
          if (data.ok === false) throw new Error(data.error || 'SnowLuma 启动失败');
          setSnowluma(data);
          setOk('SnowLuma 已拉起。');
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const saveGateway = async () => {
        setBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/gateway', {
            method: 'POST',
            body: JSON.stringify({ kind: gwKind, openqqHome: gwHome ?? '' }),
          });
          if (data.ok === false) throw new Error(data.error || '保存网关设置失败');
          setOk('网关设置已保存，重启桥接后生效。');
          await loadStatus();
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const installOpenQQ = async () => {
        setBusy(true);
        setError('');
        setOk('正在下载 OpenQQ（约 1.4MB）…');
        try {
          const data = await api('/bridge/gateway/install-openqq', {
            method: 'POST',
            body: JSON.stringify({ home: gwHome ?? '' }),
          });
          if (data.ok === false) throw new Error(data.error || '安装 OpenQQ 失败');
          setOk(data.already ? '这个目录里已经有 OpenQQ 了。' : `OpenQQ ${data.tag || ''} 已装到 ${data.home}`);
          await loadStatus();
        } catch (e) {
          setOk('');
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const startOpenQQ = async () => {
        setBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/gateway/start-openqq', { method: 'POST', body: '{}' });
          if (data.ok === false) throw new Error(data.error || '启动 OpenQQ 失败');
          setOk(data.already ? 'OpenQQ 的 WebUI 已经在跑了。' : 'OpenQQ 已启动，去 WebUI 扫码登录 QQ。');
          if (data.webuiUrl) openInTab(data.webuiUrl);
          await loadStatus();
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setBusy(false);
        }
      };

      const installNodeNow = async () => {
        setNodeBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/node/install', { method: 'POST', body: '{}' });
          if (data.ok === false) throw new Error(data.error || '安装 Node 失败');
          setOk(data.already ? `已经装好了：${data.version}（${data.exe}）` : `Node ${data.version} 已装到 ${data.home}`);
          await loadStatus();
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setNodeBusy(false);
        }
      };

      const checkUpd = async () => {
        setUpdBusy(true);
        setError('');
        try {
          setUpd(await api('/bridge/update?force=1'));
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setUpdBusy(false);
        }
      };

      const applyUpd = async () => {
        setUpdBusy(true);
        setError('');
        setOk('');
        try {
          const data = await api('/bridge/update', { method: 'POST', body: '{}' });
          if (data.ok === false) throw new Error(data.error || '更新失败');
          const cleaned = Array.isArray(data.pruned) && data.pruned.length ? `，清理 ${data.pruned.length} 个过期文件` : '';
          setOk(`已更新到 ${data.version}（写入 ${data.written.length} 个文件${cleaned}）。重启 DSH 后生效。`);
          setUpd(await api('/bridge/update?force=1'));
        } catch (e) {
          setError(String(e?.message ?? e));
        } finally {
          setUpdBusy(false);
        }
      };

      const running = status?.running === true;
      const snowRunning = snowluma?.running === true;
      const consoleOrigin = `http://${localHost()}:${consoleInfo?.port ?? 3100}`;
      const consoleHref = `${consoleOrigin}${consoleInfo?.path ?? '/'}`;
      // 界面上不露 token：地址栏只显示不带口令的入口，「打开控制台」按钮内部仍用带口令的地址。
      const consoleDisplay = `${consoleOrigin}/`;

      return h(
        'div',
        { className: 'shl-body' },
        h(
          'div',
          { className: 'shl-stats' },
          h(Stat, { value: status ? (running ? '运行中' : '已停止') : '—', label: '桥接', tone: status ? toneOf(running) : undefined }),
          h(Stat, { value: status?.pid || '—', label: '进程', tone: status ? toneOf(running && Boolean(status.pid)) : undefined }),
          h(Stat, { value: status?.port || '—', label: '端口', tone: status ? toneOf(Boolean(status.port)) : undefined }),
          h(Stat, { value: status ? (status.role || '—') : '—', label: '角色', tone: status ? toneOf(Boolean(status.role)) : undefined }),
          h(Stat, { value: status ? (status.dshReady ? '已连接' : '未连接') : '—', label: 'DSH', tone: status ? toneOf(status.dshReady) : undefined }),
          h(Stat, { value: snowluma ? (snowRunning ? '在线' : '离线') : '—', label: 'SnowLuma', tone: snowluma ? toneOf(snowRunning) : undefined }),
        ),
        h(
          'div',
          { className: 'shl-toolbar' },
          h('button', { className: 'shl-btn', disabled: busy || running, onClick: () => action('/bridge/start', '启动') }, '启动'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy || !running, onClick: () => action('/bridge/stop', '停止') }, '停止'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => action('/bridge/restart', '重启') }, '重启'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => loadStatus() }, busy ? '…' : '刷新'),
          h(
            'button',
            {
              className: 'shl-btn shl-btn2',
              disabled: !consoleInfo?.port,
              title: '打开桥接控制台（会自动带上当前口令）',
              onClick: () => openInTab(consoleHref),
            },
            '打开控制台',
          ),
          h('a', { className: 'shl-link', href: consoleDisplay, target: '_blank', rel: 'noopener' }, '地址'),
        ),
        consoleInfo?.port
          ? h('div', { className: 'shl-note shl-pick' }, `控制台：${consoleDisplay}（「打开控制台」会自动带上口令，地址里不显示）`)
          : null,
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '插件版本'),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, '当前版本'),
            h('b', null, upd?.current ?? '—'),
            h('span', null, '最新版本'),
            h('b', null, upd?.checkOk === false ? '检查失败' : (upd?.latest ?? '—')),
            h('span', null, '来源'),
            h('b', null, upd?.kind === 'release' ? 'GitHub Release' : upd?.kind === 'commit' ? 'main 提交' : '—'),
          ),
          upd?.behind
            ? h(
                'div',
                { className: 'shl-note shl-pick' },
                `有新版本 ${upd.latest} 可以更新。只覆盖插件代码，presets、bridge/config.json、bridge/state 和你自己的数据都会保留；更新完要重启 DSH。`,
              )
            : null,
          !upd?.behind && upd?.ok && upd?.ahead
            ? h('div', { className: 'shl-note' }, `本地版本 ${upd.current} 比仓库里的 ${upd.latest} 新（还没发布），不提示更新。`)
            : null,
          upd?.checkOk === false ? h('div', { className: 'shl-err' }, `检查更新失败：${upd.checkError || upd.error || '未知错误'}`) : null,
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { className: 'shl-btn shl-btn2', disabled: updBusy, onClick: checkUpd }, updBusy ? '…' : '检查更新'),
            upd?.behind ? h('button', { className: 'shl-btn', disabled: updBusy, onClick: applyUpd }, updBusy ? '更新中…' : `更新到 ${upd.latest}`) : null,
            upd?.url ? h('a', { className: 'shl-link', href: upd.url, target: '_blank', rel: 'noopener' }, '在 GitHub 查看') : null,
          ),
        ),
        error ? h('div', { className: 'shl-err' }, error) : null,
        ok ? h('div', { className: 'shl-ok' }, ok) : null,
        status && !running && status.hint ? h('div', { className: 'shl-note' }, status.hint) : null,
        status && status.error ? h('div', { className: 'shl-err' }, status.error) : null,
        status && !status.consoleTokenPresent
          ? h('div', { className: 'shl-note' }, `桥接根目录 ${status.root || ''} 的 config.json 里没有 consoleToken，状态接口会 401。`)
          : null,
        status
          ? h(
              'div',
              { className: 'shl-section' },
              h('h4', { className: 'shl-h4' }, '主人与白名单'),
              h(
                'div',
                { className: 'shl-kv' },
                h('span', null, '主人 QQ'),
                h('b', null, String(status.ownerQQ ?? '—')),
                h('span', null, '群'),
                h('b', null, (status.allowGroups ?? []).join('、') || '—'),
                h('span', null, '私聊'),
                h('b', null, (status.allowPrivate ?? []).join('、') || '—'),
                h('span', null, '角色'),
                h('b', null, status.role ?? '—'),
                h('span', null, '下次唤醒'),
                h('b', null, status.nextFireText ?? '—'),
              ),
            )
          : null,
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '网关'),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, '当前生效'),
            h('b', null, gateway?.active === 'openqq' ? 'OpenQQ' : gateway?.active === 'snowluma' ? 'SnowLuma' : '未连接'),
            h('span', null, '选择'),
            h('b', null, gateway?.kind === 'openqq' ? '只用 OpenQQ' : gateway?.kind === 'snowluma' ? '只用 SnowLuma' : '自动'),
          ),
          h('div', { className: 'shl-note' }, '两个网关都是 OneBot v11。自动时先看 SnowLuma 端口，没有再看 OpenQQ；换完要重启桥接才生效。'),
          h(
            'div',
            { className: 'shl-toolbar' },
            h(
              'select',
              { className: 'shl-btn shl-btn2', value: gwKind || 'auto', onChange: (e) => setGwKind(e.target.value) },
              h('option', { value: 'auto' }, '自动（SnowLuma 优先）'),
              h('option', { value: 'snowluma' }, '只用 SnowLuma'),
              h('option', { value: 'openqq' }, '只用 OpenQQ'),
            ),
            h('input', {
              className: 'shl-btn shl-btn2',
              value: gwHome ?? '',
              placeholder: 'OpenQQ 目录（默认 ~/OpenQQ）',
              onChange: (e) => setGwHome(e.target.value),
            }),
            h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: saveGateway }, '保存'),
          ),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, 'SnowLuma'),
            h('b', null, snowluma ? (snowRunning ? '在线' : '离线') : '—'),
            h('span', null, '端口'),
            h('b', null, snowluma?.port || '—'),
            snowluma?.webuiUrl ? h('span', null, 'WebUI') : null,
            snowluma?.webuiUrl
              ? h('b', null, h('a', { href: snowluma.webuiUrl, target: '_blank', rel: 'noopener' }, snowluma.webuiUrl))
              : null,
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { className: 'shl-btn', disabled: busy || snowRunning, onClick: startSnowLuma }, '启动 SnowLuma'),
            snowluma?.webuiUrl
              ? h('button', { className: 'shl-btn shl-btn2', onClick: () => openInTab(snowluma.webuiUrl) }, '打开 WebUI')
              : null,
          ),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, 'OpenQQ'),
            h('b', null, gateway?.openqq ? (gateway.openqq.installed ? '已安装' : '未安装') : '—'),
            h('span', null, '目录'),
            h('b', null, gateway?.openqq?.home || gwHome || '—'),
            h('span', null, '状态'),
            h('b', null, gateway?.openqq ? (gateway.openqq.running ? '在线' : '离线') : '—'),
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { className: 'shl-btn', disabled: busy, onClick: installOpenQQ }, gateway?.openqq?.installed ? '重新检查安装' : '安装 OpenQQ'),
            h('button', { className: 'shl-btn shl-btn2', disabled: busy || !gateway?.openqq?.installed, onClick: startOpenQQ }, '启动 OpenQQ'),
            gateway?.openqq?.webuiUrl
              ? h('button', { className: 'shl-btn shl-btn2', onClick: () => openInTab(gateway.openqq.webuiUrl) }, '打开 WebUI')
              : null,
          ),
          h('div', { className: 'shl-note' }, 'OpenQQ 装好后先在它的 WebUI 里扫码登录 QQ，再在网络配置里打开 OneBot v11 的 WebSocket（默认 3001）；桥接会读它的 config/openqq.json 拿端口和 token。'),
          gateway?.hint ? h('div', { className: 'shl-note' }, gateway.hint) : null,
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '运行环境'),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, 'DSH 自带'),
            h('b', null, nodeEnv?.dsh || '—'),
            h('span', null, '系统 Node'),
            h('b', null, nodeEnv?.system?.version || '没找到'),
            h('span', null, '插件内置'),
            h('b', null, nodeEnv?.installed?.version || '未安装'),
            h('span', null, '状态'),
            h('b', null, nodeEnv?.usable ? `可用（${nodeEnv.usable.version}）` : `需要 ${nodeEnv?.minMajor ?? 22}+`),
          ),
          h(
            'div',
            { className: 'shl-toolbar' },
            h(
              'button',
              { className: 'shl-btn', disabled: nodeBusy || Boolean(nodeEnv?.usable), onClick: installNodeNow },
              nodeEnv?.usable ? '已就绪' : '安装 Node',
            ),
          ),
          h(
            'div',
            { className: 'shl-note' },
            nodeEnv?.usable
              ? 'OpenQQ、桥接子进程都能用这个 Node；DSH 自己跑在它自带的 Node 上，不受影响。'
              : nodeEnv?.hint || '没找到 Node 22+。点「安装 Node」会从 nodejs.org 下载官方 Windows 版解压到插件目录（约 30MB），不用自己配环境。',
          ),
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '角色人格'),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, '当前角色'),
            h('b', null, status?.role || status?.roleMode || '—'),
            h('span', null, '人格卡'),
            h('b', null, status?.role ? `roles/${status.role}.md` : '—'),
          ),
          h('div', { className: 'shl-note' }, '换人格卡要用上面的「打开控制台」。'),
        ),
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '会话映射'),
          h(
            'div',
            { className: 'shl-note' },
            sessionsCwd
              ? `工作区：${sessionsCwd}（只有这个工作区里的 QQ 会话会列出来；记忆与情感也只往这里注入）`
              : '读不到桥接的工作区设置，下面是本地记录，可能含旧会话。',
          ),
          sessions.length === 0
            ? h('div', { className: 'shl-empty' }, '还没有会话。收到第一条消息时会建。')
            : h(
                'div',
                { className: 'shl-kv' },
                ...sessions.flatMap((row) => [
                  h(
                    'span',
                    { key: `${row.key}-k` },
                    `${row.kind === 'group' ? '群' : row.kind === 'private' ? '私聊' : '会话'} ${row.id || row.key}${row.name ? `（${row.name}）` : ''}`,
                  ),
                  h(
                    'b',
                    { key: `${row.key}-v` },
                    `${String(row.sessionId).slice(0, 8)}… ${row.dormant ? '休眠' : row.active ? '在用' : '未确认'}`,
                  ),
                ]),
              ),
        ),
        (status?.activity?.length ?? 0) > 0
          ? h(
              'div',
              { className: 'shl-section' },
              h('h4', { className: 'shl-h4' }, '最近在做什么'),
              h('div', { className: 'shl-pre' }, status.activity.join('\n')),
            )
          : null,
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '日志'),
          h(
            'div',
            { className: 'shl-chips' },
            Object.keys(LOG_LABELS).map((name) =>
              h(
                'button',
                { key: name, className: `shl-chip${logName === name ? ' on' : ''}`, onClick: () => setLogName(name) },
                LOG_LABELS[name],
              ),
            ),
          ),
          h('div', { className: 'shl-pre shl-pre-tall' }, (logs?.lines ?? ['（加载中）']).join('\n')),
        ),
      );
    }

    const inject = ['slots'];
    const NS = 'shoreline';

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: NS, order: 8, label: () => 'Shoreline' },
              MemoryPanel,
            ),
          ),
        'shoreline: settings section',
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.MemoryPanel = MemoryPanel;
    return module.exports;
  },
});
