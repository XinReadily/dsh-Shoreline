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
        const [st, ss, sl, cs, gw] = await Promise.all([
          get('/bridge/status'),
          get('/bridge/sessions'),
          get('/bridge/snowluma'),
          get('/bridge/console'),
          get('/bridge/gateway'),
        ]);
        if (st.ok) setStatus(st.data?.bridge ?? null);
        if (ss.ok) {
          setSessions(Array.isArray(ss.data?.sessions) ? ss.data.sessions : []);
          setSessionsCwd(ss.data?.cwd ?? '');
        }
        if (sl.ok) setSnowluma(sl.data?.snowluma ?? null);
        if (cs.ok) setConsoleInfo(cs.data ?? null);
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
