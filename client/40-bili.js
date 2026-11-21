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
      const enabledWs = new Set(cfg.enabledWorkspaces || []);
      const enabledSess = new Set(cfg.enabledSessions || []);

      const toggleWorkspace = (id, on) => {
        const next = new Set(enabledWs);
        if (on) next.add(id);
        else next.delete(id);
        save({ enabledWorkspaces: [...next], enabledSessions: [...enabledSess] });
      };

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
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '工作区与会话'),
          h(
            'div',
            { className: 'shl-note' },
            '勾选工作区会放开它下面所有会话；也可只勾单个会话。这里只控制 B 站游客工具。',
          ),
          workspaces.length
            ? h(
                'div',
                { className: 'shl-bili-scroll' },
                workspaces.map((ws) =>
                  h(
                    'div',
                    { key: ws.id, className: 'shl-bili-ws' },
                    h(
                      'label',
                      { className: 'shl-switch' },
                      h('input', {
                        type: 'checkbox',
                        checked: enabledWs.has(ws.id),
                        onChange: (e) => toggleWorkspace(ws.id, e.target.checked),
                      }),
                      h('b', null, ws.title || String(ws.id).slice(0, 8)),
                      h('span', { className: 'shl-bili-path' }, ws.path || ''),
                    ),
                    (ws.sessions || []).map((s) =>
                      h(
                        'label',
                        { key: s.id, className: 'shl-switch shl-bili-sess' },
                        h('input', {
                          type: 'checkbox',
                          checked: enabledSess.has(s.id) || Boolean(s.key && enabledSess.has(s.key)),
                          onChange: (e) => toggleSession(s, e.target.checked),
                        }),
                        s.label || String(s.id).slice(0, 8),
                        h('code', null, String(s.id).slice(0, 12)),
                      ),
                    ),
                  ),
                ),
              )
            : h('div', { className: 'shl-empty' }, '没有读到 DSH 工作区数据。'),
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
