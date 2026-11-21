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
