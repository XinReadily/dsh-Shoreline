# Shoreline 交接文档

> 写给下一个会话的 AI。读完这份就能接手，不需要翻旧聊天。
> 最后更新：2026-11-20，版本 0.8.3

---

## 一句话

Shoreline 是 DSH 的常驻能力层插件，用来替代 SurfCore：
**记忆（按遗忘曲线运作）+ 情感状态 + 语音（听与说）+ QQ 桥接控制 + B 站游客态 + QQ 聊天 agent 预设**，全部收在一个设置面板里。

用户是「主人」（QQ <ownerQQ>），角色是「小汐」。他要的是**像人**，不是像客服。

---

## 先搞清楚：这个插件不是给「当前会话」用的

如果你是在一个**微信侧的会话**里读到这份文档，那是控制台会话——用来开发、调试、看日志的。
**Shoreline 真正服务的对象是 QQ 里那个「小汐」会话**：
- 工作区 `C:\Users<user>\.dsh\qq-chat-work`，会话由 `C:\Users<user>\qq-bridge-own\src\bridge.js` 创建
- 记忆块、情感块通过 `systemPrompt.context()` 注入，**按组装上下文里的 `context.agent`（也就是该会话的工作区）过滤**：只有上面那个工作区能拿到，其他工作区什么都不注入（`index.js` 的 `inScope()`）
- `qq-tool-restrict.mjs` 的白名单、`qq-chat-v2` 预设、火山语音，全是为那条链路准备的

所以：

1. **当前会话里看到的效果只能当参考。** 代码是同一套，但会话不同、注入时机不同、可用工具也不同（控制台会话能调 `plugin_manager`，QQ 会话不能）。
2. **验收要去 QQ 那边看**：她记不记得旧事、叫不叫「主人」、说话带不带情绪、语音像不像她、主动开口的时机自不自然。
3. **改完要分清哪一层生效**：改 `client\*.js` → 构建 + 刷新页面；改 host 侧代码 → 重启 DSH；改 `bridge.js` / `config.json` → 重启桥接；改 preset → 重生成 patch + 重启 DSH。

---

## 位置

| 东西 | 路径 |
|---|---|
| 插件源码 | `C:\Users<user>\.dsh\plugins\shoreline`（link 安装进 profile `desktop`） |
| 面板源码 | `client\*.js`（12 个片段），`node scripts\build-client.mjs` 拼成 `client.js` |
| 测试 | `test\*.test.mjs` + `test\run.mjs`（`pnpm test`） |
| 记忆数据 | `C:\Users<user>\.dsh\shoreline\memory\memories.json` + `inbox.jsonl` + `events.jsonl` |
| 情感数据 | `C:\Users<user>\.dsh\shoreline\mood\state.json` |
| 语音配置 | `C:\Users<user>\.dsh\shoreline\voice.json` |
| QQ 桥接 | `C:\Users<user>\qq-bridge-own`（独立 node 进程，自己的 `config.json` / `state/`） |
| 媒体与模型 | `D:\dsh-data\bili-feed`（抽帧）、`D:\dsh-data\whisper`（Python + faster-whisper + 模型） |
| 临时脚本 | `C:\Users<user>\.dsh\im\_*.mjs`（探针/迁移脚本，不属插件） |
| QQ 空间 | 外部插件 `C:\Users<user>\.dsh\plugins\dsh-qzone-post`（link 进 profile），配置 `C:\Users<user>\.dsh\qzone-self-config.json`，状态 `C:\Users<user>\.dsh\qzone-self\state.json`；工具 `qzone_state` / `qzone_publish` / `qzone_profile` / `qzone_avatar`，已加入 `qq-tool-restrict.mjs` 的 SAFE_EXACT；默认好友可见、2 小时冷却、每天 2 条 |

---

## 面板：七个页签

记忆 / 情感·状态 / 语音 / 桥接·角色 / B站 / 目的引擎 / 防刷屏

挂载点 `settings.section`。面板是「片段 + 拼接」：源码在 `client\00-boot.js` … `client\99-root.js`（12 个，按文件名排序拼接），产物 `client.js` 约 2800 行。
**改了片段必须跑 `node scripts\build-client.mjs`**，否则页面还是旧的；`--check` 只比对不写。

---

## 记忆

**引擎** `lib/memory/engine.js`
- 幂律衰减，`DECAY_FACTOR = 19/81`（让 Δt = S 时留存正好 90%），`DECAY_POWER = 0.5`
- `TYPES` 的 S0（天）：identity 400 / first 300 / promise 180 / fact 0（不衰减）/ opinion 90 / digest 60 / video 45 / emotion 45 / slang 20 / daily 7 / flow 1.5 / ephemeral 0.25（标签「琐碎」）
- 复习增益 ∝ (1 − 当前留存)：快忘时被想起涨得多，刚提过再提几乎不加
- 状态**不硬存**，`full()` 里按当前分数现推：`< 6` 是 dormant

**注入** `renderBlock()`
- 走 `ctx.systemPrompt.context()`，**不是 section**（section 进 system prompt，每轮一变会毁掉整段缓存前缀）
- `maxChars` 默认 1600，面板可调 400–8000
- **facts 无条件先拼**，剩余额度再给「还记得的事」「正在变模糊」
- 流水（`source === 'flow'`）永不进注入
- 只有 `voice === 'quote'` 才标「谁说的」；转述不标
- **时间标注**：块头写「今天：11月13日」，每条写「11月8日（5天前）」；结尾提醒「以日期后面的 N 天前为准」。`dayLabel()` 算今天/昨天/N 天前/1 周前/2 周前/N 周前。

**合并** `planConsolidation()`
- 只收 `daily` / `ephemeral`，按「**类型 + 天 + 渠道**」分桶（同一天里的日常和琐碎不会并到一起）
- 条件：≥3 天没提、分数 < 45、importance ≤ 65、未钉住、同桶 ≥2 条、一次最多 15 条
- 产物**保留原类型**（日常并出来仍是日常）并加 `merged: true`，原记录直接删除，强度继承原组平均
- 老 `digest` 产物保留，`type === 'digest'` 仍算「合并过的」，`merged=1` 筛选能同时筛到两种
- 流水不参与

**取代**（只用于会变的事）
- `SUPERSEDABLE_TYPES = ['fact','identity','opinion','promise']`
- `memory_remember` 传 `supersedes: [旧 id...]`：新记录写入，旧记录置 `state='superseded'`、`supersededBy=新 id`
- 被取代的记录**退出注入块**，但正文留在库里，`memory_search` 仍能翻到并标「（旧说法，已被新记录取代）」；列表默认隐藏，`state=superseded` 只看它
- 不存在的 id 不编造关系；`settleState` / `applyReview` 遇到 superseded 直接返回（否则复习会把旧说法复活）

**证据与有效时间**
- 每条记录带 `evidence`：`explicit`（当事人明确说，默认）/ `observed`（直接看到听到）/ `inferred`（她自己推测）/ `external`（B 站、网页等外部来源）
- 带 `validFrom`（从什么时候成立）与 `validTo`（到什么时候失效，默认 null）；时间统一存 ISO（UTC），外部填 `+08:00` 也能比大小
- 被取代时旧记录 `validTo` = 新记录的 `validFrom`，即「旧说法在新说法成立那一刻失效」
- `inferred` 在注入块里标「〔推断〕」，面板显示「推断 / 亲眼见 / 外部」标签；旧数据没有这几个字段，按 `explicit` + `createdAt` 兼容

**使用证据**
- 搜索命中或复习一次算一次激活：24h 内只算一次，最多 3 次
- 激活只给注入排序加 `min(3, 次数) × 0.03`（最多 +0.09），**不改衰减曲线**
- 意图：经常被提起的事这轮更容易被选进来，但不会因此记得更久

**流水** `service.ingestFlow()`
- 桥接把每条 QQ 消息写进 `~/.dsh/shoreline/memory/inbox.jsonl`
- 插件每 10 分钟消化一次，按「天 + 会话 key」分成 `flow-YYYY-MM-DD-<key>`，一天一条
- 行格式 `HH:MM 名字（回 引用原文）：正文`
- 不进注入、不参与合并、S0 = 1.5 天；面板默认不显示（勾「流水」才看）

**工具**：`memory_search` / `memory_remember` / `memory_fact` / `memory_stats` / `memory_review`

---

## 情感

**引擎** `lib/mood/engine.js`，五维，日常值统一 **10**：

| 维度 | base | 范围 | 半衰期 | 按对象 |
|---|---|---|---|---|
| fatigue 疲倦 | 10 | 0–100 | 6h | 否 |
| closeness 亲密 | 10 | **−100–100** | 5 天 | **是** |
| anger 怒气 | 10 | 0–100 | 2h | **是** |
| grievance 委屈 | 10 | 0–100 | 5h | 否 |
| joy 开心 | 10 | **−100–100** | 4h | 否 |

负值语义：亲密为负是疏远/讨厌，开心为负是伤心。旧状态在 `version !== 2` 时由 `migrateLegacy()` 迁一次；`service.init()` 必须保留 `version` 字段，否则每次读都会重迁、把值压扁。

**倍率**（推动前先乘它自己的倍率，clamp 0.5–2.0）
- `m_I = 1 − 0.45n_A − 0.30n_G + 0.25n_H`
- `m_H = 1 − 0.35n_F − 0.30n_A − 0.25n_G + 0.20n_I`
- `m_F = 1 − 0.20n_H + 0.25n_A + 0.20n_G`
- `m_A = 1 + 0.45n_F + 0.35n_G − 0.25n_H − 0.30n_I`
- `m_G = 1 + 0.30n_F + 0.40n_A − 0.20n_H − 0.20n_I`

归一化：正段 `(x−10)/90`，负段 `(x−10)/110`。

**阈值联动**（每 30 分钟最多一轮，吃每日递减 0.85^k、最低 0.25，单回合总和 clamp ±6）
- 疲倦 ≥60 → 开心 −2、怒气 +1（怒气作用于**所有对象**）
- 怒气 ≥60 → 亲密 −2、开心 −1（只作用于**同一对象**）
- 委屈 ≥60 → 亲密 −2、开心 −1（亲密作用于所有对象）
- 开心 ≥50 → 疲倦 −1、怒气 −1、委屈 −1（怒气作用于所有对象）
- 开心 ≤−20 → 怒气 +1、委屈 +1、亲密 −1（怒气/亲密作用于所有对象）
- 亲密 ≥75 → 委屈 −1、怒气 −1、开心 +1（只作用于同一对象）
- 亲密 ≤−30 → 怒气 +2（同一对象）
- 疲倦 ≤20 且开心 ≥40 → 亲密 +1（所有对象）

**委屈磨关系**（并入联动，不再是按小时独立磨）
- 委屈 30–60 之间：每个联动窗口对同一对象扣亲密，单次约 `0.6 + 1.0×强度`（≈0.6–1.6），乘倍率、吃递减，封底 45
- 到 60 以上由「委屈 ≥60 → 亲密 −2」接手，两段不叠加

**疲倦 tick**（她自己的累不再全靠 mood_shift）
- 桥接每轮回复后调 `POST /dsh-shoreline/api/mood/tick`（带 `x-shoreline-tick: 1`），每轮 +1.5，23:00–05:00 +3（2026-11-20 起按原 +2/+4 的 75% 计，桥接侧 `FATIGUE_TICK_RATIO = 0.75`），不封顶（只到 100）
- `lib/http.js` 为这条路径开了白名单，否则会被 401 挡
- 注入阈值：疲倦 30 提一句、55 说得更重（原来是 40/65，几乎触发不了）
- 目的引擎累瘫硬闸从 85 降到 **75**

**其他**
- 对非主人：亲密涨落只算 0.2；对别人生的气按 30% 转成对主人的委屈
- 递减增益：半小时内连着往同一边推 80% / 64% / 51%，最低 30%；**面板手动调不受递减**（`manual=true`）
- 注入同样走 `context()`，只写处境不写数字；贴日常值时只剩一行提醒

**工具**：`mood_shift`（`changes` / `target` / `note`），已进 QQ 工具白名单

---

## 语音

**说**（TTS）
- 两条路：Edge（兜底、无密钥）、火山声音复刻（她的音色）
- 火山 v3：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`
  - `X-Api-Resource-Id: seed-icl-2.0`（字符版，配额 10；写 `volc.megatts.voiceclone` 会报并发超限，那是并发版配额 0）
  - body 里 `req_params.audio_params.speech_rate = -10`（默认值，慢一点更自然）
  - `instruction` = 她传的 `style`；**没传就空着走裸合成**，不替她决定语气
- 老 v1 `POST /api/v1/tts` + `cluster: volcano_icl` 仍保留当兜底
- `text` 和 `style` 里的 `[笑]` 这类方括号标记会在 say 端点被剥掉

**听**（ASR）
- **QQ 语音**：不落盘、不解码，走 SnowLuma 的 OneBot action `fetch_ptt_text`（`qq_voice_text` 工具），跟着 `getMessageDetail` 开关走
- **B 站视频**：先查 CC 字幕，没有才下载音轨 → ffmpeg 抽 16k wav → faster-whisper small（`D:\dsh-data\whisper\transcribe.py`），临时文件用完删

**坑**
- `voice.json` 不能带 BOM（PowerShell `Set-Content -Encoding UTF8` 会带），否则 JSON.parse 失败静默回落 Edge
- Windows Python 默认 GBK，`transcribe.py` 里必须强制 stdout 为 UTF-8

---

## 桥接（qq-bridge-own）

- 独立进程，`C:\Users<user>\qq-bridge-own\src\bridge.js`（约 15,000 行）
- 控制台 3100，`config.json` 里的 `consoleToken`
- Shoreline 负责：状态、会话映射、日志尾部、启停、SnowLuma 启动、目的引擎参数、防刷屏参数
- **改 `config.json` 的 purpose / fishGuard 要重启桥接**；改 `voice.json` 不用（每次现读）

**唤醒提示**
- 时间锚点每轮现算：`【现在是 Y/M/D HH:mm（上午/下午/晚上）】…现在几点只看这一行`（原来只有日期，导致把早上当现在）
- 消息时间 `humanWhen()` 每条带天：`今天 HH:mm` / `昨天 HH:mm` / `M月D日 HH:mm`
- 收尾过的会话在 24h 内会注入「【上次结束点】上次收在：…；下次可以这样接：…」

**回复检查（replyCheck）**
- 已有人回：先看消息，有延伸空间就「可以再补 1 条」（带自己的事或具体小问题），别只回「嗯嗯」；对方明确收尾或来回三四次就别续
- 没人回：不硬补，但要先 `qq_wait_for_messages` 沉睡前观察

**目的引擎**
- 只投递给主人私聊
- 六种动机（`moodMotive`）：angry / waiting / deep / company / longing / whim
- 「平常」档开口概率 `plainChance`（默认 0.5，面板可调）；主人 1 小时内说过话时这一档直接跳过、不重置计时
- 两档硬闸：回避（怒气+委屈 ≥100，3 小时后重试）、累瘫（疲倦 ≥75，4 小时后）
- `activity` 0–100 是最后一道乘法（0.4–1.6 倍）
- 失败不占名额：发送工具失败记 `delivery-failed`（不是 `silent`），按 `retryMs`（15 分钟）重试，`attempts` 到 3 次才放弃；修过一个「先删后查导致永远记成 silent」的顺序 bug
- 网关未连接时先自检跳过（`gateway-offline`），10 分钟后再试，不消耗名额
- 素材：最近 QQ 聊天（`materialWindowHours`，默认 72）+ 记忆库全量（时间衰减）+ 人格卡；关于别人的记忆权重 ×0.3

**三个主动开口的口子**（未统一，待优化）

| 入口 | 触发 | 受 activity 影响 |
|---|---|---|
| 目的引擎 | 每天 ≤6 次 | 受 |
| replyCheck | 发完消息 30 秒后 | 不受（已有道别豁免） |
| proactiveCheck | 每轮后 45–90 分钟 | 不受 |

**收尾工具 `qq_close_conversation`**
- `POST /api/socialV2/close`，参数 `summary` / `nextOpening` / `reason` / `throughSeq`
- 不改变任何唤醒状态；三道限制：① 最后一句是提问/求助且她没接过话 → 拒绝；② 这段已收过尾、对方还没再开口 → 拒绝；③ 名额与唤醒条件都不动

---

## QQ 聊天预设

- `presets/qq-chat.patch.yml` 与 `qq-chat-v2.patch.yml`，从 SurfCore 搬来
- `package.json` 的 `dsh.bundle.patch` 是**数组**，三个文件都要挂
- 预设以 patch 形态装配（DSH 0.1.7 起 `~/.dsh/.agent-presets/<id>/` 已不再被读取）：改完源文件要跑
  `node scripts\build-agent-preset-patches.mjs` 重生成 patch，再重启 DSH
- 控制台的「同步状态」看的是 patch 文件内容是否与源一致，不是那个废弃目录
- `qq-tool-restrict.mjs` 是执行期白名单：**新工具必须手动加进 `SAFE_EXACT`**，否则 QQ 里调用会被拒

---

## 常用操作

**改了什么怎么生效**
- 改 `client\*.js` / CSS → `node scripts\build-client.mjs` → 刷新页面
- 改 host 侧代码（`index.js` / `lib/`）→ 重启 DSH
- 改 `bridge.js` / `config.json` → 重启桥接
- 改预设源文件 → `node scripts\build-agent-preset-patches.mjs` → 重启 DSH

**重启桥接**
```
$c = Get-NetTCPConnection -LocalPort 3100 -State Listen | Select-Object -First 1
taskkill /PID $c.OwningProcess /T /F
Start-Process -FilePath 'C:\Users<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' `
  -ArgumentList 'src\bridge.js' -WorkingDirectory 'C:\Users<user>\qq-bridge-own' -WindowStyle Hidden
```

**验证**
- `node --check <file>`
- `node test\run.mjs` 或 `pnpm test`（10 个测试文件：mood-engine、memory-consolidate、memory-time、memory-supersede、memory-activation、memory-evidence、mood-strain、mood-tick、mood-service-migrate、workspace-scope）
- `node test\host-sim.mjs`（假 ctx 跑 apply：工具数、section、路由数）
- `node C:\Users<user>\.dsh\im\_render_tabs_probe.mjs`（假 React 渲染七个页签）

---

## 已知粗糙点（按优先级）

1. **改了片段忘了构建**：`client\*.js` 不是运行时入口，必须 `build-client.mjs` 生成 `client.js`，否则页面还是旧的。
2. **`channel` 有 82% 为空**（历史数据补不上），所以「群聊/私聊分区」一直没做。
3. **`context()` 会累积**：每轮一份快照进历史，实测 47 份约 6.2 万字。DSH 没有按 name 替换的机制；上下文越长模型越容易「续写注入块」（出过复述含令牌被拦截的事故）。
4. **三个开口口子各行其是**，activity 只管得到目的引擎。
5. `memory/service.js`、`mood/service.js`、`voice/service.js` 各写了一遍「原子写 + JSON 读 + mtime 缓存」。
6. 目的引擎字段定义写三遍（`PANEL_SPEC` / `DEFAULT_PURPOSE_CONFIG` / 前端 `purposePayload`）。

---

## 沟通注意

- 他说**先做**就做，别反复确认；他讨厌空谈和「评估工时」。
- 报结论要带实测数据，别只说「应该可以」。
- 改错了立刻回滚并说明，不要辩解。
- 每次改完要告诉他**需不需要重启**（DSH / 桥接 / 只刷新页面）。
