# Shoreline

DSH（DeepSeek Harness）的常驻能力层：按遗忘曲线运作的记忆、会衰减的情感状态、QQ 桥接控制台、B 站游客态，以及一个统一的控制面板。

## 功能

- **记忆**：类型化记录（身份 / 事实 / 观点 / 日常 / 琐碎 / 流水 …），幂律遗忘曲线，按分数与字符预算挑选注入；支持「取代旧说法」「证据与有效时间」「按类型合并」。
- **情感**：五个维度（亲密 / 开心 / 疲倦 / 怒气 / 委屈），半衰期衰减、倍率联动、阈值联动，手动调节不受递减影响。
- **桥接面板**：管理独立进程 `qq-bridge-own` 的启动与日志、人格与预设提示词、二代仿真配置、语音（Edge / 火山 v3）。
- **B 站游客态**：视频信息、封面与抽帧、弹幕、字幕与转写（显式 IPv4，避免 IPv6 半连问题）。
- **QQ 空间**：配合 `dsh-qzone-post` 插件，由角色自己发说说（可选）。

## 安装

1. 把本目录放到 `~/.dsh/plugins/shoreline`。
2. 在 profile 的 `package.json`（如 `~/.dsh/profiles/desktop/package.json`）里加入依赖与 bundle：

   ```json
   {
     "dependencies": { "shoreline": "link:C:/Users/<user>/.dsh/plugins/shoreline" },
     "dsh": { "profile": { "bundles": ["shoreline"] } }
   }
   ```

3. 重启 DSH。面板会出现在设置页的「Shoreline」分组。

## 配置

- 数据目录：`~/.dsh/shoreline/`（`memory/`、`mood/`、`voice.json`）。
- 桥接目录：默认 `~/qq-bridge-own`，可用插件选项 `bridgeRoot` 覆盖；桥接本身是独立进程。
- 记忆 / 情感注入只对 QQ 聊天工作区生效（默认 `~/.dsh/qq-chat-work`），其他工作区不注入。
- 初次启动会从 `seed/memories.json` 导入示例种子；清空记录后才会再次导入。

## 开发

```bash
node test/run.mjs          # 全部测试（test/*.test.mjs）
```

面板源码在 `client/*.js`（拼接顺序即文件名顺序），改完必须重新构建：

```bash
node scripts/build-client.mjs         # 生成 client.js
node scripts/build-client.mjs --check # 只校验是否一致
```

`client.js` 是生成产物，不要直接手改。

## License

MIT
