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
