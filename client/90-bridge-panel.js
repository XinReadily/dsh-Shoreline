    function BridgeBody() {
      const [status, setStatus] = useState(null);
      const [sessions, setSessions] = useState({});
      const [logs, setLogs] = useState(null);
      const [logName, setLogName] = useState('bridge');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');
      const [snowluma, setSnowluma] = useState(null);
      const [consoleInfo, setConsoleInfo] = useState(null);

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
        const [st, ss, sl, cs] = await Promise.all([
          get('/bridge/status'),
          get('/bridge/sessions'),
          get('/bridge/snowluma'),
          get('/bridge/console'),
        ]);
        if (st.ok) setStatus(st.data?.bridge ?? null);
        if (ss.ok) setSessions(ss.data?.sessions ?? {});
        if (sl.ok) setSnowluma(sl.data?.snowluma ?? null);
        if (cs.ok) setConsoleInfo(cs.data ?? null);
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
          h('h4', { className: 'shl-h4' }, 'SnowLuma 网关'),
          h(
            'div',
            { className: 'shl-kv' },
            h('span', null, '状态'),
            h('b', null, snowluma ? (snowRunning ? '在线' : '离线') : '—'),
            h('span', null, '端口'),
            h('b', null, snowluma?.port || '—'),
            h('span', null, '启动器'),
            h('b', null, snowluma?.launcherPath || '—'),
            snowluma?.webuiUrl ? h('span', null, 'WebUI') : null,
            snowluma?.webuiUrl
              ? h(
                  'b',
                  null,
                  h(
                    'a',
                    { href: snowluma.webuiUrl, target: '_blank', rel: 'noopener' },
                    snowluma.webuiUrl,
                  ),
                )
              : null,
          ),
          snowluma && !snowRunning && snowluma.hint ? h('div', { className: 'shl-note' }, snowluma.hint) : null,
          h('div', { className: 'shl-note' }, '首次使用先在 WebUI 里扫码登录 QQ；登录成功，桥接才连得上。'),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('button', { className: 'shl-btn', disabled: busy || snowRunning, onClick: startSnowLuma }, '启动 SnowLuma'),
            snowluma?.webuiUrl
              ? h('button', { className: 'shl-btn shl-btn2', onClick: () => openInTab(snowluma.webuiUrl) }, '打开 WebUI')
              : null,
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
          h('h4', { className: 'shl-h4' }, 'DSH 会话映射'),
          Object.keys(sessions).length === 0
            ? h('div', { className: 'shl-empty' }, '还没有会话。收到第一条消息时会建。')
            : h(
                'div',
                { className: 'shl-kv' },
                ...Object.entries(sessions).flatMap(([key, id]) => [
                  h('span', { key: `${key}-k` }, key),
                  h('b', { key: `${key}-v` }, String(id)),
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
