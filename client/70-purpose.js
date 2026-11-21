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
