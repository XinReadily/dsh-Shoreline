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
