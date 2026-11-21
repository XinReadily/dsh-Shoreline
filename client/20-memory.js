    function Item({ item, onReview, onForget, onSave, busy }) {
      const score = Math.max(2, Math.min(100, Number(item.strength) || 0));
      const sleeping = item.state === 'dormant';
      // 流水是桥接自动攒的原话，没有「谁说的 / 转述 / 情感」这些要人填的东西，
      // 编辑时只留正文。
      const isFlow = item.source === 'flow';
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(null);
      const [saving, setSaving] = useState(false);

      const setField = (key, value) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

      const openEdit = () => {
        const kind = speakerKind(item.speaker);
        setDraft({
          text: item.text || '',
          type: item.type || 'daily',
          importance: item.importance ?? 60,
          emotional: item.emotional ?? 0,
          speaker: kind,
          groupName: kind === 'group' ? String(item.speaker).slice(6) : '',
          channel: item.channel || '',
          moodSelf: item.moodSelf || '',
          moodOther: item.moodOther || '',
          voice: item.voice === 'quote' ? 'quote' : 'narration',
        });
        setEditing(true);
      };

      const save = async () => {
        if (!draft || saving) return;
        const text = String(draft.text || '').trim();
        if (!text) return;
        setSaving(true);
        try {
          await onSave(item.id, {
            text,
            type: draft.type,
            importance: Number(draft.importance) || 0,
            emotional: Number(draft.emotional) || 0,
            speaker:
              draft.speaker === 'group'
                ? `group:${String(draft.groupName || '').trim() || '别人'}`
                : draft.speaker,
            channel: draft.channel,
            moodSelf: String(draft.moodSelf || '').trim(),
            moodOther: String(draft.moodOther || '').trim(),
            voice: draft.voice === 'quote' ? 'quote' : 'narration',
          });
          setEditing(false);
        } finally {
          setSaving(false);
        }
      };

      if (editing) {
        return h(
          'div',
          { className: 'shl-item shl-editing' },
          h(
            'div',
            { className: 'shl-main' },
            h('textarea', {
              className: 'shl-edit-text',
              rows: 4,
              value: draft.text,
              onChange: (e) => setField('text', e.target.value),
            }),
            isFlow
              ? h('div', { className: 'shl-note' }, '流水是桥接自动攒的原话，这里只改文字。')
              : h(
              'div',
              { className: 'shl-edit-row' },
              h(
                'label',
                null,
                '类型',
                h(
                  'select',
                  { value: draft.type, onChange: (e) => setField('type', e.target.value) },
                  Object.keys(TYPE_LABEL).map((key) => h('option', { key, value: key }, TYPE_LABEL[key])),
                ),
              ),
              h(
                'label',
                null,
                '重要度',
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 100,
                  value: draft.importance,
                  onChange: (e) => setField('importance', e.target.value),
                }),
              ),
              h(
                'label',
                null,
                '情绪',
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 10,
                  value: draft.emotional,
                  onChange: (e) => setField('emotional', e.target.value),
                }),
              ),
            ),
            isFlow ? null : h(
              'div',
              { className: 'shl-edit-row' },
              h(
                'label',
                null,
                '谁说的',
                h(
                  'select',
                  { value: draft.speaker, onChange: (e) => setField('speaker', e.target.value) },
                  SPEAKER_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
              ),
              draft.speaker === 'group'
                ? h(
                    'label',
                    null,
                    '群友名',
                    h('input', {
                      value: draft.groupName,
                      placeholder: '群名片或昵称',
                      onChange: (e) => setField('groupName', e.target.value),
                    }),
                  )
                : null,
              h(
                'label',
                null,
                '在哪说的',
                h(
                  'select',
                  { value: draft.channel, onChange: (e) => setField('channel', e.target.value) },
                  CHANNEL_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
              ),
            ),
            isFlow ? null : h(
              'div',
              { className: 'shl-edit-row' },
              h(
                'label',
                null,
                '我那时候的心情',
                h('input', {
                  value: draft.moodSelf,
                  placeholder: '几个字就行，没有就留空',
                  onChange: (e) => setField('moodSelf', e.target.value),
                }),
              ),
              h(
                'label',
                null,
                '对方那时候的心情',
                h('input', {
                  value: draft.moodOther,
                  placeholder: '几个字就行，没有就留空',
                  onChange: (e) => setField('moodOther', e.target.value),
                }),
              ),
              h(
                'label',
                null,
                '这是原话还是转述',
                h(
                  'select',
                  { value: draft.voice, onChange: (e) => setField('voice', e.target.value) },
                  h('option', { value: 'narration' }, '转述（我概括的）'),
                  h('option', { value: 'quote' }, '原话（一字不差）'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'shl-ops' },
              h('button', { className: 'shl-btn', disabled: saving, onClick: save }, saving ? '保存中…' : '保存'),
              h('button', { className: 'shl-btn shl-btn2', onClick: () => setEditing(false) }, '取消'),
            ),
          ),
        );
      }

      return h(
        'div',
        { className: `shl-item${sleeping ? ' shl-sleeping' : ''}` },
        h('div', { className: 'shl-meter' }, h('i', { style: { height: `${score}%`, background: strengthColor(score) } })),
        h(
          'div',
          { className: 'shl-main' },
          h('div', { className: 'shl-text' }, item.text),
          h(
            'div',
            { className: 'shl-meta' },
            h('span', { className: 'shl-badge' }, TYPE_LABEL[item.type] ?? item.type),
            item.source === 'flow' ? h('span', { className: 'shl-badge dim', title: '桥接记下的原话，按天压成一条；不进提示词，只靠搜索翻' }, '流水') : null,
            item.source === 'flow' && item.flowKey ? h('span', { className: 'shl-badge dim' }, flowKeyText(item.flowKey)) : null,
            item.who ? h('span', { className: 'shl-who' }, item.who) : null,
            item.moodSelf ? h('span', { className: 'shl-mood' }, `我当时：${item.moodSelf}`) : null,
            item.moodOther ? h('span', { className: 'shl-mood' }, `TA：${item.moodOther}`) : null,
            item.mergedCount ? h('span', { className: 'shl-badge dim' }, `并了 ${item.mergedCount} 条`) : null,
            item.evidence === 'inferred'
              ? h('span', { className: 'shl-badge dim', title: '她自己推测出来的，不是谁明确说的；注入时会标「推断」' }, '推断')
              : item.evidence === 'observed'
                ? h('span', { className: 'shl-badge dim', title: '她直接看到/听到的事实' }, '亲眼见')
                : item.evidence === 'external'
                  ? h('span', { className: 'shl-badge dim', title: '从 B 站、网页之类外部来源看到的' }, '外部')
                  : null,
            item.supersededBy
              ? h('span', { className: 'shl-badge dim', title: `已被 ${item.supersededBy} 取代：不再进提示词，原文留档可搜` }, '已被取代')
              : null,
            h(
              'span',
              { className: `shl-badge ${sleeping ? 'dim' : score >= 55 ? 'ok' : score >= 30 ? 'warn' : 'dim'}` },
              sleeping ? `沉睡了 · ${item.strength} 分` : `${item.strength} 分 · ${clarityText(score)}`,
            ),
            item.pinned ? h('span', { className: 'shl-badge ok' }, '不会忘') : null,
            h('span', null, item.lastReviewAt ? `最近想起 ${fmtWhen(item.lastReviewAt)}` : `记于 ${fmtWhen(item.createdAt)}`),
            h('span', null, `约能撑 ${item.span}`),
          ),
        ),
        h(
          'div',
          { className: 'shl-ops' },
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => onReview(item) }, sleeping ? '叫醒它' : '回想一下'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => onForget(item) }, '忘掉'),
          h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: openEdit }, '改'),
        ),
      );
    }

    function MemoryBody() {
      useStyleOnce();
      const [stats, setStats] = useState(null);
      const [list, setList] = useState({ total: 0, items: [] });
      const [query, setQuery] = useState('');
      const [type, setType] = useState('');
      const [state, setState] = useState('');
      const [mergedOnly, setMergedOnly] = useState(false);
      const [showFlow, setShowFlow] = useState(false);
      const [maxCharsDraft, setMaxCharsDraft] = useState('1600');
      const [prompt, setPrompt] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [ok, setOk] = useState('');

      const refresh = useCallback(async () => {
        try {
          const [s, l] = await Promise.all([
            api('/state'),
            api(`/memories?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&state=${encodeURIComponent(state)}&merged=${mergedOnly ? '1' : ''}&hideFlow=${showFlow ? '0' : '1'}&limit=80`),
          ]);
          setStats(s.stats);
          setList(l);
          const cur = Number(s?.stats?.settings?.maxChars);
          if (Number.isFinite(cur) && cur > 0) setMaxCharsDraft(String(cur));
          setError('');
        } catch (e) {
          setError(e.message);
        }
      }, [query, type, state, mergedOnly, showFlow]);

      useEffect(() => {
        refresh();
      }, [refresh]);

      const loadPrompt = useCallback(async () => {
        try {
          const data = await api('/prompt');
          setPrompt(data.text || '（当前没有可注入的内容）');
        } catch (e) {
          setPrompt(`读取失败：${e.message}`);
        }
      }, []);

      const act = useCallback(
        async (fn, message) => {
          setBusy(true);
          setOk('');
          setError('');
          try {
            const result = await fn();
            await refresh();
            await loadPrompt();
            setOk(typeof result === 'string' && result ? result : message);
            setTimeout(() => setOk(''), 2600);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        },
        [refresh, loadPrompt],
      );

      const onReview = useCallback(
        (item) => act(() => api('/review', { method: 'POST', body: JSON.stringify({ id: item.id, grade: 'recall' }) }), '回想了一次，记得更牢了。'),
        [act],
      );

      const onForget = useCallback(
        (item) => act(() => api('/forget', { method: 'POST', body: JSON.stringify({ id: item.id }) }), '已从记忆库里抹掉。'),
        [act],
      );

      const onSave = useCallback(
        async (id, patch) => {
          try {
            const data = await api('/update', {
              method: 'POST',
              body: JSON.stringify({ id, patch }),
            });
            if (data.ok === false) throw new Error(data.error || '保存失败');
            await refresh();
            await loadPrompt();
            setOk('改好了，分数和时间线没动。');
            setTimeout(() => setOk(''), 2600);
          } catch (e) {
            setError(String(e?.message ?? e));
          }
        },
        [refresh, loadPrompt],
      );

      // 「合并」不是一种记忆类型，是整理后的产物：从类型条里拿出来单独放一行，
      // 免得看起来像「日常 / 琐碎 / 合并」三选一。合并后仍是原类型，所以类型条照常能筛到它。
      // 「流水」同理：一天一条、内容很长，默认不显示，单独放一个开关在类型条最后。
      const typeChips = useMemo(() => {
        const byType = stats?.byType ?? {};
        const keys = Object.keys(byType).filter((k) => byType[k] > 0 && k !== 'digest' && k !== 'flow');
        return keys.map((key) =>
          h(
            'button',
            {
              key,
              className: `shl-chip${type === key ? ' on' : ''}`,
              onClick: () => setType(type === key ? '' : key),
            },
            TYPE_LABEL[key] ?? key,
            h('em', null, byType[key]),
          ),
        );
      }, [stats, type]);

      const flowCount = stats?.byType?.flow ?? 0;
      const flowChip = h(
        'button',
        {
          className: `shl-chip shl-chip-sub${showFlow ? ' on' : ''}`,
          title: '桥接把说出口的话按天压成一条的流水。内容很长、默认不显示、也从不进提示词，勾上才列出来。',
          onClick: () => setShowFlow(!showFlow),
        },
        '流水',
        flowCount ? h('em', null, flowCount) : null,
      );

      const mergedCount = stats?.mergedGroups ?? 0;
      const mergedChip = mergedCount
        ? h(
            'button',
            {
              className: `shl-chip shl-chip-sub${mergedOnly ? ' on' : ''}`,
              title: '由零散对话并出来的条目。合并后仍是原类型（日常 / 琐碎），所以类型条里也能筛到它；这里只按「是不是整理出来的」筛。',
              onClick: () => setMergedOnly(!mergedOnly),
            },
            '只看合并后的',
            h('em', null, mergedCount),
          )
        : null;

      const stateChip = (key, label) =>
        h(
          'button',
          {
            key,
            className: `shl-chip${state === key ? ' on' : ''}`,
            onClick: () => setState(state === key ? '' : key),
          },
          label,
        );

      return h(
        'div',
        { className: 'shl-body' },
          h(
            'details',
            { className: 'shl-how' },
            h('summary', null, '这套记忆是怎么运作的'),
            h('p', null, '一条记忆不是「记得 / 不记得」两档，而是 0–100 的一个分数，随时间和被想起的次数连续变化。'),
            h('h5', null, '怎么记'),
            h(
              'ol',
              null,
              h('li', null, '按类型定一个初始「能撑多久」：身份与关系最久，日常一个月还剩七成，琐碎小事一周就到三成半。'),
              h('li', null, '分数随时间按幂律往下掉。掉得慢、尾巴长，不是断崖式归零。'),
              h('li', null, '被想起一次分数会回升，回升多少取决于「当时还剩多少」——快忘的时候被想起加得最多，刚说完又提几乎不加。'),
            ),
            h('h5', null, '带上情绪'),
            h(
              'p',
              null,
              '记的时候可以顺带写「我那时候的心情」和「对方那时候的心情」，两个分开。情绪是回忆的钩子：回想一件事，先浮上来的往往是当时的感受。没有就留空，不硬凑。',
            ),
            h('h5', null, '两个来源'),
            h(
              'ul',
              null,
              h('li', null, h('b', null, '她记的'), '：她自己判断后写下来的，是提炼过的意思，带类型和情绪。'),
              h(
                'li',
                null,
                h('b', null, '流水'),
                '：桥接把每条真的说出口的话记个尾巴，按天压成一条。保存的是原话，稳定性固定 1.5 天，',
                h('b', null, '从不进提示词'),
                '，只在搜索时被翻出来——对应「忘得很快，但被提到时还留一点印象」。列表里带「流水」标记。',
              ),
            ),
            h('h5', null, '变淡之后'),
            h(
              'ul',
              null,
              h('li', null, h('b', null, '沉睡'), '：低于 6 分。还在库里、还能搜到，点「叫醒它」就拉回来，不会真删。'),
              h(
                'li',
                null,
                h('b', null, '合并'),
                '：下面几条同时满足才会被并——',
                h('b', null, '至少 3 天'),
                '没再被提起、当前分数已在 ',
                h('b', null, '45 分以下'),
                '、当初的重要度 ',
                h('b', null, '≤65'),
                '、类型是「日常」或「琐碎」、没有被钉住，而且同一天、同一处（群聊 / 私聊 / B站分开算）至少 ',
                h('b', null, '2 条'),
                '。只并同类型、同一天的记录；合并后还是原来的类型（日常并出来仍是日常），只是多一个「合并过」标记，所以它既能在类型里筛到，也能被「只看合并后的」筛出来。一次最多并 15 条，多出来的留到下次。原话都保留，只是合成一条，不再单独占位置。手动点「合并旧话」可以立刻跑一次。每条记录标着「原话 / 转述」，合并时只有标成原话的才写成「主人：……」这样的引语，其余只写正文——不靠猜。',
              ),
            ),
            h('h5', null, '进到提示词里的'),
            h(
              'p',
              null,
              '每次开口前按「强度 × 新鲜度 × 类型权重」挑几条塞进去，最多 1600 字，塞不下的不硬塞。流水永远不进——它只在被提到时才该出现。被塞进提示词也不算复习。',
            ),
            h('p', null, '没进提示词的都还在库里，靠上面的搜索翻。搜到一条会算一次「想起」，那条会记得更久一点。'),
          ),
          h(
            'div',
            { className: 'shl-stats' },
            h(Stat, { value: stats?.total ?? '—', label: '一共记住' }),
            h(Stat, { value: stats?.active ?? '—', label: '还清楚' }),
            h(Stat, { value: stats?.fading ?? '—', label: '正在变模糊' }),
            h(Stat, { value: stats?.dormant ?? '—', label: '已沉睡' }),
            h(Stat, { value: stats ? `${stats.avgStrength}` : '—', label: '平均强度' }),
          ),
          h('div', { className: 'shl-chips' }, typeChips, flowChip),
          h(
            'div',
            { className: 'shl-toolbar' },
            h('input', {
              className: 'shl-input',
              placeholder: '输入关键词搜索记忆...',
              value: query,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') refresh();
              },
            }),
            stateChip('dormant', '只看已沉睡'),
            stateChip('superseded', '只看已取代'),
            mergedChip,
            h('button', { className: 'shl-btn', disabled: busy, onClick: refresh }, busy ? '…' : '搜'),
            h(
              'button',
              {
                className: 'shl-btn shl-btn2',
                disabled: busy,
                title: '把满足条件的零散对话按天并成一段：至少 3 天没提起、分数已低于 45、重要度 ≤65、类型是日常或琐碎、同一天同一渠道同类型、至少 2 条。合并后仍是原类型。流水记录不参与。',
                onClick: () =>
                  act(async () => {
                    const data = await api('/consolidate', { method: 'POST', body: JSON.stringify({}) });
                    if (data.ok === false) throw new Error(data.error || '整理失败');
                    if (!data.groups) return '这会儿没有需要合并的零散对话。';
                    return `并了 ${data.groups} 组，共 ${data.covered} 条零散对话，原来的那些已经并进去、不在列表里了。`;
                  }, ''),
              },
              '合并旧话',
            ),
            h(
              'span',
              { className: 'shl-cap' },
              h('span', { className: 'shl-cap-l' }, '设置提示词的字数上限'),
              h('input', {
                className: 'shl-cap-i',
                type: 'number',
                min: 400,
                max: 8000,
                step: 100,
                value: maxCharsDraft,
                onChange: (e) => setMaxCharsDraft(e.target.value),
              }),
              h('span', { className: 'shl-cap-l' }, '字'),
              h(
                'button',
                {
                  className: 'shl-btn shl-btn2',
                  disabled: busy,
                  onClick: () =>
                    act(async () => {
                      const n = Number(maxCharsDraft);
                      if (!Number.isFinite(n) || n < 400 || n > 8000) throw new Error('范围是 400–8000 字');
                      await api('/settings', { method: 'POST', body: JSON.stringify({ maxChars: n }) });
                      await refresh();
                      return `上限改成 ${n} 字了。`;
                    }, ''),
                },
                '保存',
              ),
              h(
                'button',
                {
                  className: 'shl-btn shl-btn2',
                  disabled: busy,
                  title: '恢复成默认的 1600 字',
                  onClick: () => act(async () => {
                    await api('/settings', { method: 'POST', body: JSON.stringify({ maxChars: 1600 }) });
                    setMaxCharsDraft('1600');
                    await refresh();
                    return '已恢复到默认的 1600 字。';
                  }, ''),
                },
                '重置',
              ),
            ),
          ),
          error ? h('div', { className: 'shl-err' }, error) : null,
          ok ? h('div', { className: 'shl-ok' }, ok) : null,
          h(
            'div',
            { className: 'shl-list' },
            (list.items ?? []).length === 0
              ? h('div', { className: 'shl-empty' }, '这个条件下没有记忆。')
              : list.items.map((item) =>
                  h(Item, { key: item.id, item, onReview, onForget, onSave, busy }),
                ),
          ),
          h(
            'details',
            { className: 'shl-prompt', onToggle: (e) => { if (e.target.open && !prompt) loadPrompt(); } },
            h('summary', null, '看看现在往提示词里塞了什么'),
            h('div', { className: 'shl-pre' }, prompt || '（展开后加载）'),
            h('div', { className: 'shl-note' }, `库里 ${list.total} 条符合条件，注入块最多 ${stats?.settings?.maxChars ?? 1600} 字；超出部分不会硬塞，按强度和新鲜度取舍。`),
          ),
      );
    }
