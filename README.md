# Shoreline

DSH（DeepSeek Harness）的常驻能力层：按遗忘曲线运作的记忆、会衰减的情感状态、接入 QQ 的桥接与控制面板、B 站游客态、以及一个统一的八个页签的控制台。

它面向的是「想让 DSH 里的角色长期待在一个 QQ 里」的人：记忆会淡，情感会累，角色会自己找时机开口，而不是每轮都靠人重新交代一遍。

## 功能

- **记忆**：类型化记录（身份 / 事实 / 观点 / 日常 / 琐碎 / 流水 …），幂律遗忘曲线，按分数与字符预算挑选注入；支持「取代旧说法」「证据与有效时间」「按类型合并」。
- **情感**：五个维度（亲密 / 开心 / 疲倦 / 怒气 / 委屈），半衰期衰减、倍率联动、阈值联动；聊天每轮会自然累积疲倦，手动调节不受递减影响。
- **桥接与控制台**：内置桥接源码与依赖，面板里能看进程状态、启停桥接、打开桥接控制台、读日志；人格卡、仿真提示词、目的引擎（主动找时机开口）都在这里配。
- **网关适配**：同时支持 SnowLuma 与 OpenQQ（两者都是 OneBot v11）。`auto` 先探测 SnowLuma，没有就找 OpenQQ；面板里可以一键下载安装 OpenQQ 并拉起 WebUI 扫码登录。
- **QQ 空间**：内置，走协议端的空间接口（发说说 / 改昵称签名 / 换头像），由角色自己决定要不要发，带每天条数上限与演练模式。
- **B 站游客态**：视频信息、封面与抽帧、弹幕、CC 字幕与本地转写（显式 IPv4，避免 IPv6 半连问题）。不登录、不存 cookie。
- **语音**：Edge 与火山引擎 v3 两路。Edge 环境可一键安装（嵌入式 Python + edge-tts，约 26 MB）；火山复刻需要自备 AppID / API Key，不配就默认 Edge。
- **自动更新**：面板里检查 GitHub 上的新版本并一键更新，只覆盖插件代码，保留你自己的配置与真实提示词。
- **开箱即用**：桥接依赖（`bridge/deps/`）、Node 检测与安装、Edge 语音环境、B 站转写环境（faster-whisper + small 模型，约 500 MB）都可以在面板里一键装好。

## 前置条件

- DSH（当前使用 0.x 桌面版，Windows 优先）
- Node.js 22 及以上（面板「运行环境」会检测，缺了可一键下载官方 Windows 版）
- 一个 OneBot v11 协议端：
  - **SnowLuma**：需要你自己装好并登录 QQ（本项目只检测和引导，不代为分发）
  - **OpenQQ**：面板可一键下载安装，装完拉起 WebUI 扫码登录
- Windows 10/11。语音与转写的一键安装依赖 Windows 嵌入式 Python；Linux/macOS 需要自己准备 Python 环境。

## 安装

1. 把仓库放到 `~/.dsh/plugins/shoreline`（`git clone` 或直接下载解压）。

2. 在 profile 的 `package.json`（通常是 `~/.dsh/profiles/desktop/package.json`）里加依赖与 bundle：

   ```json
   {
     "dependencies": {
       "shoreline": "link:C:/Users/<user>/.dsh/plugins/shoreline"
     },
     "dsh": {
       "profile": {
         "bundles": ["shoreline"]
       }
     }
   }
   ```

   并在 `node_modules` 下给 `shoreline` 建一个指向插件目录的 Junction（Windows 上 `mklink /J`）。

3. 重启 DSH。设置页里会出现「Shoreline」分组。

## 第一次使用

按顺序走一遍，大约五分钟：

1. **网关**：打开「桥接/角色」→「网关」。选 `auto`，点「检查」。没有 SnowLuma 就点「安装 OpenQQ」，装好后点「启动 OpenQQ」，在弹出的 WebUI 里扫码登录。
2. **人格**：桥接控制台里选内置人格（傲娇助手 / 小鲸鱼），或者自己在 `~/qq-bridge-own/roles/` 写一份 `名字.md`。
3. **会话**：在 QQ 里给小号或自己发一条消息，让桥接建出会话；回到面板「桥接/角色」的「会话映射」，确认能看到「私聊 xxx / 群 xxx」。
4. **语音**（可选）：「语音」页点「一键安装 Edge 环境」，装完就能说话；想用火山复刻就填 AppID / API Key。
5. **B 站转写**（可选）：「B站」页点「一键安装转写环境」，下模型约 500 MB。
6. **记忆与情感**：默认只往 `~/.dsh/qq-chat-work` 这个工作区注入，这是桥接给 QQ 会话用的目录。别的会话不受影响。

## 面板页签

| 页签 | 作用 |
| --- | --- |
| 记忆 | 浏览、搜索、合并、取代、清理记忆；看每条的记忆强度与状态 |
| 情感/状态 | 五维雷达与数值、倍率公式、阈值联动说明、手动调节 |
| 语音 | 引擎开关、Edge / 火山 v3 参数、Edge 环境一键安装 |
| 桥接/角色 | 桥接进程状态与启停、网关、会话映射、人格卡、插件版本与更新 |
| QQ 空间 | 发说说、改资料、换头像、可见范围与每日上限、最近操作 |
| B 站 | 开关、抽帧档位、媒体目录、视频声音转写、识别到的 QQ 会话 |
| 目的引擎 | 主动开口的节奏、活跃度、情绪门槛、预算与素材 |
| 防刷屏 | 鱼的守护：防连发、冷却、误触保护 |

## 数据与配置

| 位置 | 内容 |
| --- | --- |
| `~/.dsh/shoreline/` | 记忆 `memory/`、情感 `mood/`、语音 `voice.json`、一键装的 Python 与 whisper 环境 |
| `~/.dsh/bili-feed/` | B 站：配置、调用日志、刷过视频、封面、抽帧媒体 |
| `~/qq-bridge-own/` | 外部桥接（若你有旧安装）；配置、状态、日志、人格卡都在这里 |
| 插件内 `bridge/` | 内置桥接；找不到外部安装时用它，状态写在 `bridge/state/` |

常用环境变量：

- `BILI_FEED_DATA`：B 站数据根（默认 `~/.dsh/bili-feed`）
- `QQ_SESSIONS_FILE`：桥接会话表路径（默认 `~/qq-bridge-own/state/sessions.json`）
- `QQ_CHAT_WORKSPACE`：记忆/情感注入的 QQ 工作区（默认 `~/.dsh/qq-chat-work`）
- `SHORELINE_REPO`：自动更新检查的仓库（默认 `XinReadily/dsh-Shoreline`）
- `SHORELINE_INSECURE_TLS=1`：本机代理证书链不完整时放行
- `SHORELINE_WHISPER_DIR`：转写环境的备用目录

## 更新

面板「桥接/角色」→「插件版本」→「检查更新」，有新版本就点「更新」。它只覆盖代码，`presets/`、`bridge/config.json`、`bridge/state/`、`node_modules/` 都会跳过，覆盖前还会备份到 `.update-backup-<时间戳>/`。

也可以手动：`git pull` → `node scripts/build-client.mjs`（如果 `client/` 有改动）→ 重启 DSH。

## 开发

```bash
node test/run.mjs                     # 全部测试（test/*.test.mjs）
node scripts/build-client.mjs         # 由 client/*.js 生成 client.js
node scripts/build-client.mjs --check # 只校验是否一致
node scripts/vendor-bridge.mjs        # 同步内置桥接与依赖
node scripts/vendor-bridge.mjs --check
```

目录结构：

```
client/          面板源码片段（拼接顺序 = 文件名顺序，产物 client.js 不要手改）
lib/memory/      记忆引擎与存储
lib/mood/        情感引擎
lib/bridge/      桥接服务、面板 API、OpenQQ 安装
lib/bili/        B 站 MCP、抽帧、转写
lib/voice/       语音服务与 tts.py
lib/*.js         Node / Python / whisper 环境安装器
bridge/          内置桥接（由 scripts/vendor-bridge.mjs 生成）
presets/         QQ 仿真提示词 patch（仓库里是示例版，本地可用真实版并 skip-worktree）
test/            测试
```

改面板只改 `client/`，改完必须重新构建，否则运行的是旧代码。

## 常见问题

**面板显示 0 条刷过视频 / 0 个会话？**
先确认桥接在跑、`~/qq-bridge-own/state/sessions.json` 存在；B 站面板服务是独立进程（8788 端口），DSH 重启时会复用已在跑的旧进程，必要时结束它再重启 DSH。

**SnowLuma 和 OpenQQ 能同时开吗？**
不能，两者默认都占 3001。切换网关前先停掉另一个。

**记忆/情感没有注入？**
默认只注入 `~/.dsh/qq-chat-work`。确认 QQ 会话确实在这个工作区，或用 `QQ_CHAT_WORKSPACE` 覆盖。

**改了提示词，桥接控制台显示「未同步」？**
现在面板给的是源文件与 DSH 实际读取的 preset patch 的比对结果；保存会自动重建 patch，重启 DSH 后生效。

**Edge 语音报错？**
点「一键安装 Edge 环境」；或者自己填 Python 与 `tts.py` 路径。纯 Node 直连 Edge TTS 已不可行（微软的 token 算法在客户端做了防逆向）。

**权限/敏感信息拦截？**
桥接会拦下包含本机路径、令牌、会话密钥的回复并通知管理员，不会发到群里。

## 隐私

- 记忆、情感、日志、媒体全部在本机，不上传到任何服务器。
- B 站部分是游客态，不登录、不保存 cookie。
- QQ 空间走本机协议端，不读取也不保存你的 QQ 密码。
- `config.json` 里的 `consoleToken`、`agentToken` 属于敏感信息，别贴给别人，也别提交进仓库。

## License

MIT。内置桥接基于 [qq-bridge](https://github.com/Derpyu520/qq-bridge) 的增强版；协议端支持 [SnowLuma](https://github.com/h-D-ACE/dsh-qq) 与 [OpenQQ](https://github.com/feijx3/OpenQQ)；语音环境使用 [edge-tts](https://github.com/rany2/edge-tts)，转写使用 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)。
