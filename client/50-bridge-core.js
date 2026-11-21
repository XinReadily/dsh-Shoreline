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