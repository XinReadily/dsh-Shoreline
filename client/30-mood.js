    const TABS = [
      { key: 'memory', label: '记忆', title: '记忆' },
      { key: 'mood', label: '情感/状态', title: '情感/状态' },
      { key: 'voice', label: '语音', title: '语音' },
      { key: 'bridge', label: '桥接/角色', title: '桥接/角色' },
      { key: 'qzone', label: 'QQ 空间', title: 'QQ 空间' },
      { key: 'bili', label: 'B站', title: 'B站' },
      { key: 'purpose', label: '目的引擎', title: '目的引擎' },
      { key: 'fish', label: '防刷屏', title: '防刷屏' },
    ];

    const TABS_SUB = {
      memory: '不是「记得 / 不记得」，而是每件事此刻还剩多少分。翻一次会更牢，搁着会变淡，但不会凭空消失。',
      mood: '不是「她是什么人」，而是「此刻什么状态」。五个维度各有日常值，被一句话推动，没人管就自己回落——记住的是此刻，不是发生过什么。',
      voice: '两件事分开看：听得见（把语音和视频里的话变成文字）、说得像（把文字变成她的声音）。合成在桥接进程里执行，这里只改参数和看状态。',
      bridge: '桥接是独立进程，人格卡由它读。这里只管看得见、点得动：状态、会话、SnowLuma、日志、启停。',
      qzone: '她自己决定要不要发：说说是她自己的话，不是转述聊天。发之前会先看一眼今天发过没有，一天最多两条。',
      bili: '游客态只读：热门、搜索、视频详情、弹幕、每周必看、抽帧、刷过的视频、分享到 QQ。不登录、不点赞、不评论。',
      purpose: '不是关键词触发器：从最近的 QQ 聊天、记忆库里值得提的旧事、人格卡里她是谁，攒出「目标假设」，带归属、置信度和风险，再决定是分享、索取、邀请还是倾诉。',
      fish: '同一批同类 bot 被拉进同一个群时，别一起刷屏。这里调判定阈值、冷却和豁免名单。',
    };

    // 五个维度统一保留一位小数：衰减和牵制都会产生零头，混着整数和小数看着不齐。
    function fmtMood(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return n.toFixed(1);
    }

    /** 显示条按 0~100 的绝对值取比例：初始 10 就是 10%，负值按 0 显示。 */
    function moodFillPercent(dim) {
      return Math.max(0, Math.min(100, Number(dim?.value) || 0));
    }

    function MoodRadar({ dims, size = 176 }) {
      const cx = size / 2;
      const cy = size / 2;
      const radius = size / 2 - 20;
      const n = Math.max(3, dims.length);
      const angleOf = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
      const at = (i, value) => {
        const a = angleOf(i);
        const r = (radius * Math.max(0, Math.min(100, value))) / 100;
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      };
      const rings = [20, 40, 60, 80, 100].map((pct) =>
        h('polygon', {
          key: `ring-${pct}`,
          points: dims.map((_, i) => at(i, pct).map((v) => v.toFixed(1)).join(',')).join(' '),
          fill: 'none',
          stroke: 'var(--dsw-alias-border-l2)',
          strokeWidth: pct === 100 ? 1.2 : 0.8,
          opacity: 0.7,
        }),
      );
      const axes = dims.map((_, i) => {
        const [x, y] = at(i, 100);
        return h('line', {
          key: `axis-${i}`,
          x1: cx,
          y1: cy,
          x2: x,
          y2: y,
          stroke: 'var(--dsw-alias-border-l1)',
          strokeWidth: 0.8,
        });
      });
      const shape = dims
        .map((d, i) => at(i, moodFillPercent(d)).map((v) => v.toFixed(1)).join(','))
        .join(' ');
      const dots = dims.map((d, i) => {
        const [x, y] = at(i, moodFillPercent(d));
        return h('circle', { key: `dot-${d.key}`, cx: x, cy: y, r: 3.2, fill: d.color });
      });
      const labels = dims.map((d, i) => {
        const [x, y] = at(i, 110);
        return h(
          'text',
          {
            key: `lab-${d.key}`,
            x,
            y,
            textAnchor: 'middle',
            dominantBaseline: 'middle',
            fontSize: 11,
            fill: 'var(--dsw-alias-label-secondary)',
          },
          `${d.label} ${fmtMood(d.value)}`,
        );
      });
      return h(
        'svg',
        { className: 'shl-radar', viewBox: `-20 -20 ${size + 40} ${size + 40}`, role: 'img' },
        ...rings,
        ...axes,
        h('polygon', {
          key: 'shape',
          points: shape,
          fill: 'rgba(47,111,237,.16)',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: 1.6,
        }),
        ...dots,
        ...labels,
      );
    }

    function MoodBody() {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [target, setTarget] = useState('');

      const load = useCallback(async () => {
        try {
          const query = target ? `?target=${encodeURIComponent(target)}` : '';
          const res = await fetch(`${API}/mood${query}`, { headers: { accept: 'application/json' } });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || '读取失败');
          setData(json);
          setError('');
        } catch (e) {
          setError(`读不到情感状态：${String(e?.message ?? e)}`);
        }
      }, [target]);

      useEffect(() => {
        load();
      }, [load]);

      const nudge = async (key, delta) => {
        if (busy) return;
        setBusy(true);
        try {
          const res = await fetch(`${API}/mood/shift`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ changes: { [key]: delta }, target, note: '面板手动调整' }),
          });
          const json = await res.json();
          if (!json.ok) throw new Error(json.error || '改不动');
          setData(json);
          setError('');
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
            : h('div', { className: 'shl-empty' }, '正在读取情感状态…'),
        );
      }

      const dims = Array.isArray(data.dimensions) ? data.dimensions : [];
      const history = Array.isArray(data.history) ? data.history : [];
      const targets = Array.isArray(data.targets) ? data.targets : [];
      const closenessColor = dims.find((d) => d.key === 'closeness')?.color ?? 'var(--dsw-alias-brand-primary)';
      const angerColor = dims.find((d) => d.key === 'anger')?.color ?? '#e0483e';
      // 历史里可能留着改名前的老键（sadness），显示成中文，别把英文键甩到脸上。
      const dimLabel = (key) => dims.find((d) => d.key === key)?.label ?? (key === 'sadness' ? '委屈' : key);

      return h(
        'div',
        { className: 'shl-body' },
        error ? h('div', { className: 'shl-err' }, error) : null,
        h(
          'div',
          { className: 'shl-mood-top' },
          h('div', { className: 'shl-mood-chart' }, h(MoodRadar, { dims })),
          h(
            'div',
            { className: 'shl-mood-bars' },
            dims.map((d) =>
              h(
                'div',
                { key: d.key, className: 'shl-mood-bar' },
                h('div', { className: 'shl-mood-barhead' },
                  h('b', null, d.label),
                  h('span', null, `${fmtMood(d.value)} / 100（初始 ${d.base}）`),
                  h('em', null, `半衰期 ${d.halfLifeHours >= 24 ? `${Math.round(d.halfLifeHours / 24)} 天` : `${d.halfLifeHours} 小时`}`),
                ),
                h('div', { className: 'shl-mood-track' },
                  h('i', { style: { width: `${moodFillPercent(d)}%`, background: d.color } }),
                ),
                h('div', { className: 'shl-mood-ops' },
                  h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => nudge(d.key, -2) }, '−2'),
                  h('button', { className: 'shl-btn shl-btn2', disabled: busy, onClick: () => nudge(d.key, 2) }, '+2'),
                ),
              ),
            ),
          ),
        ),
        data.multipliers
          ? h('p', { className: 'shl-note' }, `本回合倍率：${dims.map((d) => `${d.label} ×${Number(data.multipliers?.[d.key] ?? 1).toFixed(2)}`).join('  ')}`)
          : null,
        Array.isArray(targets) && targets.length
          ? h(
              'details',
              { className: 'shl-mood-targets' },
              h('summary', null, `分对象看亲密与怒气（${targets.length}）`),
              h(
                'div',
                { className: 'shl-mood-targetlist' },
                targets.map((t) =>
                  h(
                    'div',
                    { key: t.key, className: `shl-mood-target${t.current ? ' on' : ''}` },
                    h('div', { className: 'shl-mood-tname' }, t.label, t.current ? '（当前）' : ''),
                    h(
                      'div',
                      { className: 'shl-mood-targetrow' },
                      h('span', { className: 'shl-mood-tkey' }, '亲密'),
                      h(
                        'span',
                        { className: 'shl-mood-tbar' },
                        h('i', {
                          style: {
                            width: `${Math.max(0, Math.min(100, Number(t.value) || 0))}%`,
                            background: closenessColor,
                          },
                        }),
                      ),
                      h('span', { className: 'shl-mood-tval' }, fmtMood(t.value)),
                    ),
                    h(
                      'div',
                      { className: 'shl-mood-targetrow' },
                      h('span', { className: 'shl-mood-tkey' }, '怒气'),
                      h(
                        'span',
                        { className: 'shl-mood-tbar' },
                        h('i', {
                          style: {
                            width: `${Math.max(0, Math.min(100, Number(t.anger) || 0))}%`,
                            background: angerColor,
                          },
                        }),
                      ),
                      h('span', { className: 'shl-mood-tval' }, fmtMood(t.anger)),
                    ),
                  ),
                ),
              ),
              h('p', { className: 'shl-note' }, '私聊按人算（同一个人在群里也认得出），群聊按群算。亲密度和怒气各存一份：在群里被谁气到，不会算到主人头上（只有三成转成委屈）。没聊过的人不进这张表。'),
            )
          : null,
        h(
          'div',
          { className: 'shl-section' },
          h('h4', { className: 'shl-h4' }, '怎么运作的'),
          h(
            'div',
            { className: 'shl-how' },
            h('p', null, '五个维度的日常值都是 10：亲密、开心可以跌到负数（疏远/讨厌、伤心），疲倦、怒气、委屈只在 0–100 之间。偏离多少由她自己推（工具 mood_shift），不推就按半衰期回落。'),
            h(
              'ul',
              null,
              h('li', null, h('b', null, '疲倦'), ' 0–100，日常 10，6 小时半衰期——熬夜会累积，睡一觉回来。每聊一轮自动 +1.5，深夜（23:00–05:00）+3，不设每日上限：真的陪着说话是会累的，不是只有她自己喊累才算。'),
              h('li', null, h('b', null, '亲密'), ' -100~100，日常 10，5 天半衰期。按人分开存：私聊记在那个人身上（认 QQ 号），群聊记在群身上；不指定对象时算在主人身上，不会另开一个「默认」。正数是亲近，负数是疏远、讨厌。', h('br'), h('em', null, '对别人的涨落只算两成——不然群里聊几次，就跟主人一样亲了。')),
              h('li', null, h('b', null, '怒气'), ' 0–100，日常 10，2 小时——真人的气一会儿就散，不该记一整天。按人分开存：在群里被别人气到，不等于对主人也生气。'),
              h('li', null, h('b', null, '委屈'), ' 0–100，日常 10，5 小时——觉得被亏待、被敷衍、明明在意却被轻放，往内收那种；怒气是往外顶，不一样。被哄或者遇上好事会加快回落。'),
              h('li', null, h('b', null, '开心'), ' -100~100，日常 10，4 小时。正数是高兴、话多，负数是没劲、提不起劲。'),
            ),
            h('p', null, h('b', null, '推动之前，先乘它自己的倍率。'), ' 倍率由另外四个维度共同决定：先把每个维度归一化成 n（高于 10 的部分按 (值−10)/90，低于 10 的部分按 (值−10)/110），再代进下面五条式子，结果夹在 0.5~2.0 之间。'),
            h('p', null, h('b', null, '亲密'), ' × (1 − 0.45×n怒气 − 0.30×n委屈 + 0.25×n开心)', h('br'), '⇒ 怒气、委屈越高，越难推近；开心的时候更容易亲近。'),
            h('p', null, h('b', null, '开心'), ' × (1 − 0.35×n疲倦 − 0.30×n怒气 − 0.25×n委屈 + 0.20×n亲密)', h('br'), '⇒ 困的时候开心不起来；生着气笑不出来；跟主人越亲，被哄好得越快。'),
            h('p', null, h('b', null, '疲倦'), ' × (1 − 0.20×n开心 + 0.25×n怒气 + 0.20×n委屈)', h('br'), '⇒ 高兴时越聊越精神；憋着火、受着委屈时更容易累。'),
            h('p', null, h('b', null, '怒气'), ' × (1 + 0.45×n疲倦 + 0.35×n委屈 − 0.25×n开心 − 0.30×n亲密)', h('br'), '⇒ 越累越容易一点就着；委屈会转成火气；开心和亲近能消气。'),
            h('p', null, h('b', null, '委屈'), ' × (1 + 0.30×n疲倦 + 0.40×n怒气 − 0.20×n开心 − 0.20×n亲密)', h('br'), '⇒ 累的时候更容易觉得被亏待；生着气更容易委屈；高兴、亲近时不太会计较。'),
            h('p', null, h('b', null, '阈值联动：'), '某个维度已经偏到一定程度，这一回合会顺手带一下别的维度。'),
            h(
              'ul',
              null,
              h('li', null, '疲倦 ≥ 60 → 开心 −2、怒气 +1（累到没心情）'),
              h('li', null, '怒气 ≥ 60 → 亲密 −2、开心 −1'),
              h('li', null, '委屈 ≥ 60 → 亲密 −2、开心 −1'),
              h('li', null, '开心 ≥ 50 → 疲倦 −1、怒气 −1、委屈 −1'),
              h('li', null, '开心 ≤ −20 → 怒气 +1、委屈 +1、亲密 −1'),
              h('li', null, '亲密 ≥ 75 → 委屈 −1、怒气 −1、开心 +1'),
              h('li', null, '亲密 ≤ −30 → 怒气 +2'),
              h('li', null, '疲倦 ≤ 20 且开心 ≥ 40 → 亲密 +1'),
            ),
            h('p', null, '每回合每个条件最多一次，乘对应维度的倍率，一回合加起来不超过 ±6。频率上按「对话回合」结算：同一段对话里最多每 30 分钟一次；同一条件当天触发越多收益越小（第 k 次 × 0.85^k，最低 0.25，每天重置）。没有这道闸，一天几百个时间步会把 +1 累积成主驱动，所有负面情绪都会被自动磨平。'),
            h(
              'p',
              null,
              '还有一条不是牵制、是换算：对别人生的气不会留在主人头上——按 30% 转成对主人的委屈。气没消失，只是从「往外顶」变成「往里收」。',
            ),
            h(
              'p',
              null,
              '两条长期规则：',
              h('br'),
              '① 递减增益——半小时内连着往同一边推，第二次只算 80%、第三次 64%、第四次 51%，最低 30%。防的是一次争吵里连推五次，一把顶到 90 下不来。',
              h('br'),
              '② 委屈会磨关系——委屈在 30~60 之间时，每个联动窗口（30 分钟）扣一点亲密，越重扣得越多（单次约 0.6~1.6，乘倍率、吃每日递减），掉到 45 就停；委屈到 60 以上转由「委屈 ≥ 60 → 亲密 −2」那条联动接手，两段不叠加。',
            ),
            h('p', null, '注入时只写处境不写数字（「你现在有点困，跟他还挺近的」）；全都贴日常值时只留一行很短的提醒，几乎不占额度。'),
          ),
        ),
        history.length
          ? h(
              'div',
              { className: 'shl-section' },
              h('h4', { className: 'shl-h4' }, '最近几次推动'),
              h(
                'div',
                { className: 'shl-mood-scroll' },
                history
                  .slice()
                  .reverse()
                  .map((row, i) =>
                    h(
                      'div',
                      { key: `${row.at}-${i}`, className: 'shl-mood-row' },
                      h('span', null, fmtWhen(row.at)),
                      h('span', { className: 'shl-mood-changes' }, Object.entries(row.changes || {}).map(([k, v]) => `${dimLabel(k)} ${v > 0 ? '+' : ''}${v}`).join(' ')),
                      h('span', { className: 'shl-mood-note' }, row.note || ''),
                    ),
                  ),
              ),
            )
          : null,
      );
    }

    // B 站面板和其它页签一样是原生组件：颜色直接吃 DSH 的 CSS 变量，换主题自动跟随。
    // 数据仍然向 8788 那个本地服务取（它开了 CORS），不经过 iframe。