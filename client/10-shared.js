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
