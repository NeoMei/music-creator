# Music Creator

Suno 歌曲创作到发布的完整工作流：生成歌曲 → 下载 WAV 无损音频 → 发布到抖音音乐开放平台（汽水音乐）。

## 功能

- 🎵 **歌曲生成**：使用 Suno Advanced 模式自定义歌词、风格、人声性别
- 🎧 **WAV 下载**：自动触发后台生成无损音频并下载
- 🚀 **一键发布**：自动填写抖音音乐开放平台表单并提交

## 安装

### 系统依赖

| 依赖 | 必需 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org/) ≥ 18 | ✅ | OpenCLI 运行时 |
| [@jackwener/opencli](https://github.com/jackwener/opencli) | ✅ | `npm install -g @jackwener/opencli` |
| `ocli` wrapper | ✅ | opencli + CloakBrowser 反检测桥接，SKILL.md 所有命令用它 |
| CloakBrowser | ✅ | 反检测浏览器（CDP 9222），首次 `ocli` 调用自动拉起 |
| [playwright-core](https://www.npmjs.com/package/playwright-core) | ✅（发布） | `scripts/publish-douyin.cjs` 驱动抖音表单；`npm i -g playwright-core`，或靠 aily-browser skill 的 node_modules 兜底 |
| [jq](https://stedolan.github.io/jq/) | 🟡 | 可选 |

### 账号准备

在 **CloakBrowser** 里登录（不是桌面 Chrome——cookie v11 加密，无法跨 profile 复制）：

- **Suno** (suno.com) — **Premier 订阅**才能生成 WAV
- **抖音音乐开放平台** (music.douyin.com) — **创作者账号**才能发布

### 安装 Adapters

```bash
git clone https://github.com/NeoMei/music-creator.git
cd music-creator
./install.sh
```

`./install.sh` 会检查上述全部依赖，并**只装 douyin-music fallback adapter**。它**不会覆盖官方 suno adapter**——官方版是 CloakBrowser/curl 补丁版，覆盖会让 WAV 下载失效。仓库 `adapters/suno/` 下的自定义适配器是 legacy，仅作参考。

> ⚠️ 不要再手动 `cp -r adapters/suno ~/.opencli/clis/`，会破坏官方 adapter。

### 环境变量

```bash
# Suno 生成需要 3-7 分钟，默认超时不够
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600
```

加到 `~/.bashrc` 或 `~/.zshrc` 持久化。

### 验证

```bash
ocli suno list --limit 5   # 能列出 Suno Library = 全链路通
```

## 快速开始

### 1. 生成歌曲

```bash
OPENCLI_BROWSER_COMMAND_TIMEOUT=600 ocli suno generate \
  --tags 'Chinese folk ballad, warm acoustic guitar, storytelling female vocal' \
  --lyrics '[Verse]\n两棵树在风雨里\n长成了彼此的形状' \
  --title '两棵树'
```

**中文风格需要先翻译成英文**，否则会报 `TRANSLATE_REQUIRED` 错误。

### 2. 下载 WAV

```bash
# 使用 clip-id（上一步返回的）
ocli suno download <clip-id> --formats wav --confirm-paid --op ~/Music/
```

### 3. 发布到抖音音乐

```bash
node ~/.openclaw/workspace/skills/music-creator/scripts/publish-douyin.cjs \
  --audio ~/Music/两棵树_<clip-id>.wav \
  --cover ~/Music/两棵树_<clip-id>_cover.jpeg \
  --title '两棵树' \
  --artist 'NeoMei' \
  --lyrics "$(cat ~/Music/两棵树_<clip-id>_lyrics.txt)" \
  --ai-tools Suno \
  --music-type 原创
```

## 完整工作流

```
suno generate → suno download --formats wav --confirm-paid → publish-douyin.cjs
```

详细参数说明见 [SKILL.md](SKILL.md)。

## 音频格式

| 格式 | 可用性 | 音质 | 文件大小 | 适用场景 |
|------|--------|------|----------|----------|
| **M4A** | ✅ 始终可用 | ⭐⭐⭐ 很好 | ~5MB | 推荐日常使用 |
| **MP3** | ✅ 始终可用 | ⭐⭐ 好 | ~3MB | 兼容性最好 |
| **WAV** | 🟡 需先生成 | ⭐⭐⭐⭐⭐ 无损 | ~40MB | 发布到音乐平台 |

抖音音乐开放平台要求 **WAV 格式**。

## 常见问题

### 1. `TRANSLATE_REQUIRED` 错误

`--styles` 包含中文。需要先翻译成英文：

```bash
# ❌ 错误
--styles '中国民谣，温暖木吉他'

# ✅ 正确
--styles 'Chinese folk ballad, warm acoustic guitar'
```

### 2. `AuthRequiredError` 错误

CloakBrowser 中未登录 Suno 或抖音音乐。在 CloakBrowser 中手动访问并登录一次：
- `suno.com`
- `music.douyin.com`

登录状态会持久化到 CloakBrowser profile，重启后仍保持。

### 3. WAV 下载失败 / 403

WAV 尚未生成或需要使用付费订阅确认。使用：

```bash
ocli suno download <clip-id> --formats wav --confirm-paid --timeout 600
```

`--confirm-paid` 是下载 WAV 的必要参数。不要手动修改 User-Agent 或 Referer。

### 4. 发布失败

抖音音乐页面改版。检查：
1. 重新登录 `music.douyin.com`
2. URL 是否为 `https://music.douyin.com/console/complete-publish`
3. 添加 `--trace retain-on-failure` 查看调试信息

### 5. 生成超时

```bash
export OPENCLI_BROWSER_COMMAND_TIMEOUT=600  # 10 分钟
```

## 项目结构

```
music-creator/
├── SKILL.md                          # Skill 定义（AI agent 使用）
├── README.md                         # 本文件
├── install.sh                        # 一键安装脚本
└── adapters/
    ├── suno/                         # 旧版自定义适配器（已弃用，保留作参考）
    │   ├── create-advanced.js
    │   ├── generate-wav.js
    │   ├── download.js
    │   └── list.js
    └── douyin-music/
        └── publish.js                # 发布到抖音音乐
```

## 依赖

见上方[安装](#安装)章节的依赖表。摘要：Node.js ≥ 18、`@jackwener/opencli`、`ocli` wrapper、CloakBrowser、`playwright-core`（发布用）。

## License

MIT
