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
                  if (missing.length) {
                    return `✗ 还不能用：找不到 ${missing.join('、')}。没有 CC 字幕的视频会转不了，其余功能不受影响。`;
                  }
                  return asrSt.ffmpegOk === false
                    ? `✓ 已就绪：${asrSt.model || 'small'} 模型。没找到 ffmpeg，会跳过抽音轨、直接让 whisper 解码原文件（慢一点）。`
                    : `✓ 已就绪：${asrSt.model || 'small'} 模型，没有字幕时会自动转写。`;
                })(),
              )
            : h('div', { className: 'shl-note' }, '正在检查转写环境…'),
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
                : '当前找不到。留空 = 用 D:\\dsh-data\\whisper\\python\\python.exe。',
            },
            h('input', {
              className: 'shl-input',
              value: asrSt?.python || asr?.python || '',
              placeholder: 'D:\\dsh-data\\whisper\\python\\python.exe',
              onChange: (e) => patchAsr('python', e.target.value),
            }),
          ),
          h(
            Field,
            {
              label: '转写脚本',
              hint: asrSt?.scriptOk
                ? '真正跑 whisper 的那个 Python 脚本。'
                : '当前找不到。留空 = 用 D:\\dsh-data\\whisper\\transcribe.py。',
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
