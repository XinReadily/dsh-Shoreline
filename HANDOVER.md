# Shoreline 交接文档

> 写给下一个会话的 AI。读完这份就能接手，不需要翻旧聊天。
> 最后更新：2026-11-23，版本 0.13.1
> 仓库：<https://github.com/XinReadily/dsh-Shoreline>（公开，MIT）

---

## 一句话

Shoreline 是 DSH 的常驻能力层插件，替代早期的 SurfCore：
**记忆（按遗忘曲线运作）+ 情感状态 + 语音（听与说）+ QQ 桥接控制 + B 站游客态 + QQ 空间 + 自动更新**，全部收在一个设置面板里。

用户是「主人」（QQ `<ownerQQ>`），角色是「小汐」。他要的是**像人**，不是像客服。

---

## 0. 先搞清楚：这个插件不是给「当前会话」用的

如果你是在一个**微信侧的会话**里读到这份文档，那是控制台会话——用来开发、调试、看日志的。

**Shoreline 真正服务的对象是 QQ 里那个「小汐」会话**：

- 工作区 `C:\Users\<user>\.dsh\qq-chat-work`，会话由 `C:\Users\<user>\qq-bridge-own\src\bridge.js` 创建
- 记忆块、情感块通过 `systemPrompt.context()` 注入，**按组装上下文里的 `context.agent`（即该会话的工作区）过滤**：只有上面那个工作区能拿到，其他工作区什么都不注入（`index.js` 的 `inScope()`）
- `qq-tool-restrict.mjs` 的白名单、`qq-chat-v2` 预设、火山语音，全是为那条链路准备的

所以：

1. **当前会话里看到的效果只能当参考。** 代码是同一套，但会话不同、注入时机不同、可用工具也不同（控制台会话能调 `plugin_manager`，QQ 会话不能）。
2. **验收要去 QQ 那边看**：她记不记得旧事、叫不叫「主人」、说话带不带情绪、语音像不像她、主动开口的时机自不自然。
3. **改完要分清哪一层生效**：见「常用操作 → 改了什么怎么生效」。

---

## 1. 当前状态快照（2026-11-23）

| 项 | 值 |
|---|---|
| 插件版本 | `0.13.1` |
| 面板产物 | `client.js` 3815 行（由 `client/` 下 13 个片段拼接） |
| 测试 | 15 个 `test/*.test.mjs`，`node test/run.mjs` 全过 |
| 桥接 | 外部 `~/qq-bridge-own`，端口 3100，当时 pid 43868 |
| B 站数据 | `~/.dsh/bili-feed`：`calls.jsonl` 153 行、`history.json` 265 行、`config.json`、`covers/`、`media/` |
| 预设 | 本地真实版（`skip-worktree` 锁住），仓库里是示例版 |
| Git | 工作区干净，最近提交 `86401f7` |

**上一个会话完成的五个阶段**：

- P1 桥接内置（`bridge/` + 依赖 vendoring + 自动拉起）
- P2 网关适配（SnowLuma / OpenQQ + 一键安装）
- P3 会话/工作区映射（只列 QQ 工作区会话，B 站工具按会话自动放行）
- P4 QQ 空间内置（桥接端点 + 四个 MCP 工具 + 面板页签）
- P5 自动检测更新（GitHub release/commit 比对 + 一键更新）

---

## 2. 位置

| 东西 | 路径 |
|---|---|
| 插件源码 | `C:\Users\<user>\.dsh\plugins\shoreline`（link 安装进 profile `desktop`） |
| 面板源码 | `client/*.js`（13 个片段），`node scripts/build-client.mjs` 拼成 `client.js` |
| 测试 | `test/*.test.mjs` + `test/run.mjs`（`node test/run.mjs`） |
| 记忆数据 | `~/.dsh/shoreline/memory/memories.json` + `inbox.jsonl` + `events.jsonl` |
| 情感数据 | `~/.dsh/shoreline/mood/state.json`（`version: 2`） |
| 语音配置 | `~/.dsh/shoreline/voice.json` |
| Python 环境 | `~/.dsh/shoreline/python`（Edge 语音一键安装；`python.exe` + `Lib/site-packages`） |
| 转写环境 | `~/.dsh/shoreline/whisper`（Python 共用 + `models/faster-whisper-small`） |
| Node（插件装的） | `~/.dsh/shoreline/node/<version>/node.exe` |
| QQ 桥接 | 优先用已装好的 `~/qq-bridge-own`；没有时用插件内置 `bridge/` |
| 内置桥接 | 插件内 `bridge/`（`scripts/vendor-bridge.mjs` 同步）；运行时生成 `bridge/config.json` 与 `bridge/state/`（已 gitignore） |
| B 站数据 | `~/.dsh/bili-feed`（`store.mjs` 的默认值，读写入口自动建目录） |
| 临时脚本 | `~/.dsh/im/_*.mjs`（探针/迁移脚本，不属插件） |

---

## 3. 架构与数据流

```
QQ 客户端
  ↕ (协议)
OneBot v11 网关：SnowLuma（需自备）或 OpenQQ（面板可一键装）
  ↕ (WebSocket 正向 / HTTP action)
桥接 bridge.js（独立 Node 进程，端口 3100）
  ├─ 收到 QQ 消息 → 写入 DSH 会话（workspace = ~/.dsh/qq-chat-work）
  ├─ 唤醒 DSH agent（reserved2 模式，带会话令牌、时间锚点、上次结束点）
  ├─ 提供控制台 HTTP API（x-console-token）与 agent API（x-agent-token）
  └─ 目的引擎 / replyCheck / proactiveCheck 三个主动开口入口
  ↕ (DSH host API)
DSH（DeepSeek Harness）
  └─ Shoreline 插件
       ├─ 记忆注入（context()，只对 QQ 工作区）
       ├─ 情感注入（同上）
       ├─ 工具：memory_* / mood_shift / bili_* / qzone_* / qq_*
       └─ 面板（八个页签，走 /dsh-shoreline/api/*）
```

关键点：**桥接不是插件的一部分运行，而是独立进程**；插件通过 HTTP 控制它、读它的状态。内置桥接只是让「没有旧安装」的机器也能跑起来。

---

## 4. 面板：八个页签

记忆 / 情感·状态 / 语音 / 桥接·角色 / QQ 空间 / B站 / 目的引擎 / 防刷屏

- 挂载点 `settings.section`
- 片段：`client/00-boot.js` … `client/99-root.js`（13 个，按文件名排序拼接）
- **改了片段必须跑 `node scripts/build-client.mjs`**，否则页面还是旧的；`--check` 只比对不写
- 面板 API 前缀：`/dsh-shoreline/api`（桥接相关在 `/dsh-shoreline/api/bridge`）

---

## 5. 记忆

**引擎** `lib/memory/engine.js`

- 幂律衰减，`DECAY_FACTOR = 19/81`（让 Δt = S 时留存正好 90%），`DECAY_POWER = 0.5`
- `TYPES` 的 S0（天）：identity 400 / first 300 / promise 180 / fact 0（不衰减）/ opinion 90 / digest 60 / video 45 / emotion 45 / slang 20 / daily 7 / flow 1.5 / ephemeral 0.25（标签「琐碎」）
- 复习增益 ∝ (1 − 当前留存)：快忘时被想起涨得多
- 状态**不硬存**，`full()` 按当前分数现推：`< 6` 是 dormant

**注入** `renderBlock()`

- 走 `ctx.systemPrompt.context()`，**不是 section**（section 进 system prompt，每轮一变会毁掉整段缓存前缀）
- `maxChars` 默认 1600，面板可调 400–8000
- **facts 无条件先拼**，剩余额度再给「还记得的事」「正在变模糊」
- 流水（`source === 'flow'`）永不进注入
- 只有 `voice === 'quote'` 才标「谁说的」；转述不标
- **时间标注**：块头「今天：M月D日」，每条「11月8日（5天前）」；结尾提醒「以日期后面的 N 天前为准」

**合并** `planConsolidation()`

- 只收 `daily` / `ephemeral`，按「**类型 + 天 + 渠道**」分桶
- 条件：≥3 天没提、分数 < 45、importance ≤ 65、未钉住、同桶 ≥2 条、一次最多 15 条
- 产物**保留原类型**（日常并出来仍是日常）并加 `merged: true`，原记录删除，强度继承原组平均
- 老 `digest` 产物保留，`merged=1` 筛选能同时筛到两种

**取代**（只用于会变的事）

- `SUPERSEDABLE_TYPES = ['fact','identity','opinion','promise']`
- `memory_remember` 传 `supersedes: [旧 id...]`：新记录写入，旧记录置 `state='superseded'`、`supersededBy=新 id`
- 被取代的记录**退出注入块**，正文留库，`memory_search` 仍能翻到并标「（旧说法，已被新记录取代）」
- `settleState` / `applyReview` 遇 superseded 直接返回（否则复习会把旧说法复活）

**证据与有效时间**

- `evidence`：`explicit`（默认）/ `observed` / `inferred` / `external`
- `validFrom` / `validTo`，统一 ISO（UTC）；被取代时旧记录 `validTo` = 新记录 `validFrom`
- `inferred` 在注入块标「〔推断〕」，面板显示「推断 / 亲眼见 / 外部」

**使用证据**

- 搜索命中或复习一次算一次激活：24h 内只算一次，最多 3 次
- 只给注入排序加 `min(3, 次数) × 0.03`（最多 +0.09），**不改衰减曲线**

**流水** `service.ingestFlow()`

- 桥接把每条 QQ 消息写进 `~/.dsh/shoreline/memory/inbox.jsonl`
- 插件每 10 分钟消化一次，按「天 + 会话 key」分成 `flow-YYYY-MM-DD-<key>`，一天一条
- 行格式 `HH:MM 名字（回 引用原文）：正文`；不进注入、不参与合并、S0 = 1.5 天；面板默认不显示

**工具**：`memory_search` / `memory_remember` / `memory_fact` / `memory_stats` / `memory_review`

---

## 6. 情感

**引擎** `lib/mood/engine.js`，五维，日常值统一 **10**：

| 维度 | base | 范围 | 半衰期 | 按对象 |
|---|---|---|---|---|
| fatigue 疲倦 | 10 | 0–100 | 6h | 否 |
| closeness 亲密 | 10 | **−100–100** | **5 天** | **是** |
| anger 怒气 | 10 | 0–100 | 2h | **是** |
| grievance 委屈 | 10 | 0–100 | 5h | 否 |
| joy 开心 | 10 | **−100–100** | 4h | 否 |

负值：亲密为负是疏远/讨厌，开心为负是伤心。旧状态在 `version !== 2` 时由 `migrateLegacy()` 迁一次；`service.init()` 必须保留 `version` 字段，否则每次读都会重迁、把值压扁（踩过）。

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

**委屈磨关系**（并入联动）

- 委屈 30–60 之间：每个联动窗口对同一对象扣亲密，单次约 0.6–1.6，乘倍率、吃递减，封底 45
- 60 以上由「委屈 ≥60 → 亲密 −2」接手，两段不叠加

**疲倦 tick**

- 桥接每轮回复后调 `POST /dsh-shoreline/api/mood/tick`（带 `x-shoreline-tick: 1`），每轮 +1.5，23:00–05:00 +3（`FATIGUE_TICK_RATIO = 0.75`），不封顶（只到 100）
- `lib/http.js` 为这条路径开了白名单，否则会被 401 挡
- 注入阈值：疲倦 30 提一句、55 说得更重；目的引擎累瘫闸 75

**其他**

- 对非主人：亲密涨落 ×0.2；对别人生的气按 30% 转成对主人的委屈
- 递减增益：半小时内连着推 80% / 64% / 51%，最低 30%；**面板手动调不受递减**（`manual=true`）
- 注入同样走 `context()`，只写处境不写数字

**工具**：`mood_shift`（`changes` / `target` / `note`）

---

## 7. 语音

**说**（TTS）

- 两条路：Edge（无密钥）、火山声音复刻（她的音色）
- 面板「语音」：顶部状态只显示当前引擎；区块 1 = 总开关 + Edge/火山切换 + Edge 音色；区块 2 = 火山 v1 参数；区块 3 = 火山 v3 参数
- **总开关** `tts.enabled`：关掉后 say 端点直接 403
- 火山 v3：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`
  - `X-Api-Resource-Id: seed-icl-2.0`（字符版配额 10；`volc.megatts.voiceclone` 是并发版，配额 0）
  - `speech_rate = -10`（默认，慢一点更自然）
  - `instruction` = 她传的 `style`；**没传就空着走裸合成**
- 老 v1 `POST /api/v1/tts` + `cluster: volcano_icl` 仍保留
- `text` / `style` 里的 `[笑]` 这类方括号在 say 端点会被剥掉

**听**（ASR）

- **QQ 语音**：不落盘，走 OneBot action `fetch_ptt_text`（`qq_voice_text` 工具）
- **B 站视频**：先查 CC 字幕，没有才下载音轨 → 有 ffmpeg 抽 16k wav，没有就直接把原文件交给 whisper → faster-whisper small
- **一键装转写环境**：面板「B站 → 视频声音转写 → 一键安装转写环境」（`lib/whisper-env.js`）
  - 复用语音那份嵌入式 Python，装 16 个包（`zhconv` 没有 wheel，自动回退下源码包摊平）
  - 从 `hf-mirror.com`（回退 huggingface.co）下 small 模型四个文件（`model.bin` 约 461 MB）
  - 大文件下载带「空闲 60 秒超时 + 重试 3 次」：hf-mirror 出现过连上却不吐字节
  - 纯音乐/没人声的视频 VAD 会滤空，返回空文本时带 `note` 说明

**坑**

- `voice.json` 不能带 BOM，否则 JSON.parse 失败静默回落 Edge
- Windows Python 默认 GBK，`transcribe.py` 里必须强制 stdout 为 UTF-8
- **Edge 必须本机有 Python + edge-tts**：面板「语音 → Edge 环境」可一键装（`lib/python-env.js`）
  - 从华为云下 Windows 嵌入式 Python 3.11.9，从清华/阿里 PyPI 镜像下 edge-tts 与依赖 wheel
  - 解压到 `~/.dsh/shoreline/python`，补 `_pth` 的 `Lib\site-packages`，放 `tts.py`，写回 `voice.json`
  - 实测 15 个包 / 26 MB / 13 秒
- 桥接选 Python 的顺序：`tts.edge.python` → `SHORELINE_PYTHON` → 插件装的那份 → 老的 `D:\dsh-data\whisper`
- 纯 Node 直连 Edge TTS 已不可行（微软 `Sec-MS-GEC` v2 token 做了防逆向），`bridge/src/edge-tts.js` 仅留作记录

---

## 8. 桥接

- 独立进程，`~/qq-bridge-own/src/bridge.js`（约 15,000 行）
- 控制台 3100，`config.json` 里的 `consoleToken`
- Shoreline 负责：状态、会话映射、日志尾部、启停、网关、目的引擎参数、防刷屏参数
- **改 `config.json` 的 purpose / fishGuard 要重启桥接**；改 `voice.json` 不用（每次现读）

### 8.1 会话映射（P3）

- `GET /api/socialV2/sessions`（需要 `x-console-token`）：`{ ok, cwd, sessions: [{ key, sessionId, kind, id, name, policy, active, dormant }] }`
- `cwd` 是 `sessionCwd`（默认 `~/.dsh/qq-chat-work`），`key` 形如 `private:<ownerQQ>` / `group:<groupId>`
- 插件 `BridgeService.readSessions()` 先调接口，失败回退读 `state/sessions.json`（`source` 区分 `bridge` / `file`）
- 面板「会话映射」只列该工作区会话，显示「私聊 xxx / 群 xxx」+ sessionId 前 8 位 + 在用/休眠/未确认
- **B 站自动识别**：`qq-tool-restrict.mjs` 的 `biliSessionAllowed()` 先查桥接会话表，能对上 key 就放行

### 8.2 唤醒提示

- 时间锚点每轮现算：`【现在是 Y/M/D HH:mm（上午/下午/晚上）】…现在几点只看这一行`
- 消息时间 `humanWhen()` 每条带天：`今天 HH:mm` / `昨天 HH:mm` / `M月D日 HH:mm`
- 收尾过的会话 24h 内注入「【上次结束点】上次收在：…；下次可以这样接：…」

### 8.3 回复检查（replyCheck）

- 已有人回：有延伸空间就「可以再补 1 条」，别只回「嗯嗯」；对方明确收尾或来回三四次就别续
- 没人回：不硬补，但要先 `qq_wait_for_messages` 沉睡前观察

### 8.4 目的引擎

- 只投递给主人私聊
- 六动机：angry / waiting / deep / company / longing / whim
- 「平常」档开口概率 `plainChance`（默认 0.5，面板可调）；主人 1 小时内说过话时这一档跳过、不重置计时
- 硬闸：回避（怒气+委屈 ≥100，3h 后重试）、累瘫（疲倦 ≥75，4h 后）
- `activity` 0–100 是最后一道乘法（0.4–1.6 倍）
- 失败不占名额：发送工具失败记 `delivery-failed`（不是 `silent`），按 `retryMs`（15 分钟）重试，`attempts` 到 3 次才放弃
- 网关未连接时先自检跳过（`gateway-offline`），10 分钟后重试
- 素材：最近 QQ 聊天（`materialWindowHours` 默认 72）+ 记忆库 + 人格卡

### 8.5 三个主动开口的口子

| 入口 | 触发 | 受 activity 影响 |
|---|---|---|
| 目的引擎 | 每天 ≤6 次 | 受 |
| replyCheck | 发完消息 30 秒后 | 不受 |
| proactiveCheck | 每轮后 45–90 分钟 | 不受 |

### 8.6 收尾工具 `qq_close_conversation`

- `POST /api/socialV2/close`，参数 `summary` / `nextOpening` / `reason` / `throughSeq`
- 不改变任何唤醒状态；三道限制：最后一句是提问且她没接过话 → 拒绝；这段已收过尾 → 拒绝；名额与唤醒条件都不动

### 8.7 内置桥接（P1）

- 源码在 `bridge/`（`node scripts/vendor-bridge.mjs` 同步，`--check` 只比对）
- 同步内容 99 个文件 / 约 2.3 MB：`src/**/*.{js,mjs}`（含 `gateway-conn.js`）、`scripts/build-agent-preset-patches.mjs`（`bridge.js` 顶层 import，缺了起不来）、`dsh/agent-presets/`、`plugins/qq-agent-presets/`、`public/*.html`、元数据
- **依赖**：`bridge/deps/`（94 包 / 3692 文件 / 17.6 MB），`ensureDeps()` 用 junction 链成 `bridge/node_modules`
- 根目录解析顺序：`options.bridgeRoot` → 已装的 `~/qq-bridge-own`（存在 `src/bridge.js`）→ 插件自带 `bridge/`
- 首次运行 `ensureConfig()` 用 `config.example.json` 生成 `bridge/config.json`：随机 32 位 `consoleToken`、`sessionCwd` 默认 `~/.dsh/qq-chat-work`、`socialV2.agentPreset` 默认 `qq-chat-v2`
- `bridge/config.json` 与 `bridge/state/` 已 gitignore
- 自动拉起：插件启动 3 秒后检查 3100，没在跑就 spawn `src/bridge.js`
- **同一时间只能跑一个桥接**：都占 3100，两个一起开会抢同一个网关 WS 连接、重复回复
- 内置实例的数据独立：白名单、ownerQQ、网关地址、会话 token 都要重新填

### 8.8 网关（P2）

- SnowLuma 团队已转私有，不再提供下载；OpenQQ 是可替代方案（`https://github.com/feijx3/OpenQQ`，AGPL-3.0）
- 两者都是 OneBot v11，`src/gateway-conn.js` 统一发现，`config.json` 有 `gateway` 段：
  - `gateway.kind`：`auto`（默认）/ `snowluma` / `openqq`
  - `gateway.openqqHome`：留空则找 `%USERPROFILE%\OpenQQ`、`C:\OpenQQ`、`D:\OpenQQ`、`E:\OpenQQ`，或 `OPENQQ_HOME`
- OpenQQ 配置 `config/openqq.json`：一个 `accessToken` 同时用于正向 WS 与 HTTP；默认 `ws.port=3001`、`webPort=17860`、HTTP 默认关
- 启动时 `resolveGateway()` 只做端口探测；命中 OpenQQ 就把端点/令牌写进 `cfg.snowluma`，下游不用改
- 法律边界：SnowLuma 原生组件禁止并入安装包/自动部署（EULA §5.4、LICENSE §5）→ 只检测 + 引导；OpenQQ 可一键装，登录要用户扫码
- 面板「网关」区块：显示当前生效、下拉切换、OpenQQ 目录、两个状态行与按钮
- 插件 API：`GET /gateway`、`POST /gateway`（写前备份，`requiresRestart: true`）、`POST /gateway/install-openqq`、`POST /gateway/start-openqq`
- **注意**：网关切换要重启桥接；SnowLuma 与 OpenQQ 默认都用 3001，不能同时开

### 8.9 QQ 空间（P4）

- `POST /api/socialV2/qzone`，body `{ key, tool: 'state'|'publish'|'profile'|'avatar'|'settings', ... }`
- 工具 `qzone_state` / `qzone_publish` / `qzone_profile` / `qzone_avatar`，已进 `SAFE_EXACT`
- 走协议端 OneBot：`get_qzone_msg_list` / `send_qzone_msg` / `set_qq_profile` / `set_qq_avatar`
- 设置存在 `config.json` 的 `socialV2.qzone`：`enabled` / `allowPublish` / `allowProfile` / `allowAvatar` / `dailyLimit`（默认 2，**按自然日零点重置**）/ `minuteLimit` / `cooldownMinutes` / `maxChars` / `defaultVisibility` / `dryRun`
- 发布记录落 `state/qzone-quota.json`，重启不清零
- 面板页签：总览 / 发说说（带演练）/ 资料 / 头像 / 设置 / 最近说说 / 最近操作 / 协议端地址

---

## 9. B 站

- 数据根统一在 `~/.dsh/bili-feed`（`lib/bili/store.mjs` 默认值；`BILI_FEED_DATA` 可覆盖）
- 面板服务是**独立进程**（8788 端口），由 `index.js` 的 `ensurePanel` 拉起；它检测到端口有响应就复用 → **改完 `panel-server.mjs` 必须手动结束旧进程再重启 DSH**，否则跑的是旧代码（踩过）
- 会话列表读 `~/qq-bridge-own/state/sessions.json`（`QQ_SESSIONS_FILE` 可覆盖）
- 抽帧/媒体默认 `<数据根>/media`；`config.json` 的 `mediaDir` 留空表示跟随数据根
- B 站 HTTP 全部走 `lib/bili/http.mjs` 的 `safeFetch`（显式 IPv4），因为 undici 在 IPv6 半连时会挂死
- 转写：`lib/bili/transcript.mjs`；路径解析顺序 面板值 → 插件装的 → 老目录

---

## 10. QQ 聊天预设

- `presets/qq-chat.patch.yml` 与 `presets/qq-chat-v2.patch.yml` 随插件分发（真实版），别人装插件就自带仿真提示词
- `package.json` 的 `dsh.bundle.patch` 是**数组**，三个都要挂（cordis + 两个 preset）
- 桥接侧也有一份同源副本（`~/qq-bridge-own/plugins/qq-agent-presets`），**不要注册进 profile**，否则重复插入
- DSH 0.1.7 起 `~/.dsh/.agent-presets/<id>/` 已不读；改完源文件要跑 `node scripts/build-agent-preset-patches.mjs` 重生成 patch 再重启 DSH
- `qq-tool-restrict.mjs` 是执行期白名单：**新工具必须手动加进 `SAFE_EXACT`**
- 本地真实版用 `git update-index --skip-worktree` 锁住；仓库里放的是示例版（无真实 QQ 号/群号）

---

## 11. 自动检测更新（P5）

- `lib/update.js`；面板「插件版本」卡片；接口 `GET /dsh-shoreline/api/bridge/update?force=1`、`POST .../update`
- 检查：GitHub `releases/latest` → 没有就比 `commits/main` 的 sha 与 `package.json` 版本
- 30 分钟内存缓存；`.update-cache.json` 记最近 commit sha（已 gitignore）
- 远端版本更高 → 提示更新；同版本但 main 变了 → 也算；远端更低 → `ahead:true`，不提示降级
- 一键更新：`codeload.github.com/<repo>/tar.gz/<ref>` → 内存 gunzip + 解 tar → 只覆盖代码
- **永远跳过** `presets/`、`bridge/config.json`、`bridge/state/`、`node_modules/`、`.git/`、`state/`、`*.bak-*`
- 覆盖前备份到 `.update-backup-<时间戳>/`；本次包里没有的代码文件会被**清理**（`pruneStale`，只动 `client/ lib/ test/ scripts/ public/` 下的 `.js/.mjs/.cjs/.json/.css/.html`）
- 默认仓库 `XinReadily/dsh-Shoreline`，`SHORELINE_REPO` 可覆盖
- 本机 TLS：hosts 把 GitHub 指到 127.0.0.1 本地代理、证书自签。更新模块先 `dns.lookup`，解析到 `127.*`/`::1` 才只对这次请求关校验；也可 `SHORELINE_INSECURE_TLS=1`
- 更新完必须重启 DSH

---

## 12. 运行环境（Node / Python）

- `lib/node-tool.js`：`nodeInfo()` 报三份 Node（DSH 自带、系统 PATH、插件装的）；`installNode()` 从 `nodejs.org/dist` 挑 v22/v24 LTS 的 win-x64.zip，解压到 `~/.dsh/shoreline/node`
- `BridgeService.resolveNode()` 优先级：构造参数 → `SHORELINE_NODE` → 插件装的 → `NODE_CANDIDATES`（DSH runtime、Program Files）
- 面板「桥接/角色 → 运行环境」显示三份版本 + 「安装 Node」
- Edge 语音环境：`lib/python-env.js` → `~/.dsh/shoreline/python`
- 转写环境：`lib/whisper-env.js` → `~/.dsh/shoreline/whisper`（共用上面那份 Python）

---

## 13. Git 与发布流程

- 仓库：`https://github.com/XinReadily/dsh-Shoreline`（公开，MIT）
- 本地 `user.name = 欣欣利`，`user.email = 359435344+XinReadily@users.noreply.github.com`（GitHub 官方 noreply，绑定账号）
- 本机 `git push` 必须带 `GIT_SSL_NO_VERIFY=true`（本地代理证书链不完整），仓库本地已设 `http.sslVerify false`
- 凭据由 Windows Git Credential Manager 记住

**提交前必做**（避免把真实预设推到公开仓库）：

```powershell
# 1. 备份真实版
mkdir -Force C:\Users\<user>\.dsh\im\_real_presets_backupN
copy presets\qq-chat.patch.yml,presets\qq-chat-v2.patch.yml -> 备份; copy qq-tool-restrict.mjs -> 备份
# 2. 还原仓库里的示例版
git checkout -- presets/
# 3. 提交
git add -A; git commit -m "..."; git push
# 4. 恢复真实版并锁回
copy 备份 -> presets\; copy 备份 qq-tool-restrict.mjs -> .\
git update-index --skip-worktree presets/qq-chat.patch.yml presets/qq-chat-v2.patch.yml
```

**每次提交前检查**：`git grep --cached -E "<用户名>|<ownerQQ>|<groupId>"` 必须零命中（把占位换成你本机的真实值再扫）。

**改代码后的标准动作**：

```powershell
node --check <改过的文件>
node scripts/build-client.mjs      # 改了 client/ 片段
node test/run.mjs                  # 必须全过
node scripts/vendor-bridge.mjs     # 改了 bridge.js 或 bridge/src
```

---

## 14. 常用操作

**改了什么怎么生效**

- 改 `client/*.js` / CSS → `node scripts/build-client.mjs` → 刷新页面
- 改 host 侧（`index.js` / `lib/`）→ 重启 DSH
- 改 `bridge.js` / `config.json` → 重启桥接
- 改预设源文件 → 跑 `build-agent-preset-patches.mjs` → 重启 DSH

**重启桥接**

```powershell
$c = Get-NetTCPConnection -LocalPort 3100 -State Listen | Select-Object -First 1
taskkill /PID $c.OwningProcess /T /F
Start-Process -FilePath 'C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' `
  -ArgumentList 'src\bridge.js' -WorkingDirectory 'C:\Users\<user>\qq-bridge-own' -WindowStyle Hidden
```

注意：`POST /api/restart` 之后**没有守护窗口**，必须手动拉起。

**验证**

- `node test/run.mjs`：15 个测试文件
  （mood-engine / mood-strain / mood-tick / mood-service-migrate / memory-consolidate / memory-time / memory-supersede / memory-activation / memory-evidence / workspace-scope / bridge-embedded / gateway / update / python-env / whisper-env）
- `node test/host-sim.mjs`：假 ctx 跑 apply（工具数、section、路由数）
- `node scripts/build-client.mjs --check`、`node scripts/vendor-bridge.mjs --check`

**桥接接口鉴权**：控制台用 `x-console-token`（`config.json` 的 `bridge.consoleToken`），agent API 用 `x-agent-token`（`state/social-v2.json` 里会话的 `agentToken`）

**面板 URL**：`http://127.0.0.1:8788/`（B 站面板服务）；桥接控制台 `http://127.0.0.1:3100/?token=<consoleToken>`

---

## 15. 已知粗糙点（按优先级）

1. **改了片段忘了构建**：`client/*.js` 不是运行时入口，必须 `build-client.mjs`
2. **`context()` 会累积**：每轮一份快照进历史，47 份约 6.2 万字。DSH 没有按 name 替换机制；上下文越长模型越容易「续写注入块」（出过复述含令牌被拦截的事故）
3. **三个开口口子各行其是**，activity 只管得到目的引擎
4. `memory/service.js`、`mood/service.js`、`voice/service.js` 各写了一遍「原子写 + JSON 读 + mtime 缓存」
5. 目的引擎字段定义写三遍（`PANEL_SPEC` / `DEFAULT_PURPOSE_CONFIG` / 前端 `purposePayload`）
6. `channel` 有 82% 为空（历史数据补不上），「群聊/私聊分区」一直没做
7. B 站面板是独立进程：改完不结束旧进程，重启 DSH 也还是旧代码
8. 更新时 `presets/` 被跳过（有意为之）——别人用插件时拿到的是仓库里的示例预设，需要自己写或用桥接自带的两个人格卡

**已解决、别再当 bug**：
- 一键更新只写不删（已加 `pruneStale`）
- QQ 空间配额重启清零（已落 `state/qzone-quota.json`，按自然日）
- 面板「当前版本 —」（已加 `checkOk` 区分检查失败与无数据）

---

## 16. 沟通注意

- 他说**先做**就做，别反复确认；他讨厌空谈和「评估工时」
- 报结论要带实测数据，别只说「应该可以」
- 改错了立刻回滚并说明，不要辩解
- 每次改完要告诉他**需不需要重启**（DSH / 桥接 / 只刷新页面）
- 不要在微信控制台会话里往记忆卡写「只属于 QQ 会话」的备忘（他明确说过）

---

## 17. 接手清单

新会话开始时，建议按这个顺序确认：

1. 读这份文档 + `README.md`
2. `cd C:\Users\<user>\.dsh\plugins\shoreline && node test/run.mjs` —— 确认基线是绿的
3. `git log --oneline -5`、`git status` —— 确认没有未提交的半成品
4. `Get-NetTCPConnection -LocalPort 3100` —— 桥接是否在跑
5. 问他要做什么，然后按上面的「改了什么怎么生效」执行

如果他说「面板不更新」「B 站 0 条」「语音没声」，先看第 15 节对应条目，再动手。
